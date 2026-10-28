// 输入框工具行的启动缓存（StartupSnapshot）：模型胶囊、审批胶囊、上下文圆环、"(sub)" 要的数据都得问 omp，
// 冷启动一两秒才齐。每次现读成功就记一笔，存到 userData/startup-cache.json；渲染进程启动时先用上次的值把工具行画完整。
// 模型目录和 omp 自选默认模型另记着读到时 omp 输入的指纹（input-stamp.ts）：指纹没变时直接拿来用，不起服务进程（default-model.ts）；
// 其余各项只做显示用，写入、判断照常走现读。文件坏了或版本不对就当没有。
// 同一个文件里还记着 `omp --version` 的结果（按可执行文件的路径、大小、修改时间），启动时 omp 文件没变就不再跑一次（omp/discover.ts），
// 以及按目录的斜杠命令列表（slash-commands.ts）；这些不在 StartupSnapshot 里，不发给渲染进程。
import { readFileSync } from "node:fs";
import type { ApprovalMode, DefaultModelInfo, ModelDefaults, ModelOption, StartupSnapshot } from "../../shared/ipc.ts";
import type { AvailableSlashCommand } from "../../shared/omp-wire/rpc-wire.generated.ts";
import type { OmpBinary, OmpVersionCache } from "../omp/discover.ts";

/** 文件格式版本；StartupSnapshot 的形状变了就加一，旧文件整个作废。 */
const formatVersion = 2;

export interface StartupCacheDeps {
  file: string;
  /** 原子写（先写临时文件再改名）。 */
  write: (file: string, text: string) => Promise<void>;
  warn: (message: string, error: unknown) => void;
}

interface OmpVersionEntry {
  size: number;
  mtimeMs: number;
  version: string;
}

interface SlashCommandsEntry {
  stamp: string;
  commands: AvailableSlashCommand[];
}

type CatalogKey = "models" | "defaultModel";

/** 斜杠命令列表最多记多少个目录（每个 worktree 是一个目录）：超出时丢最久没记的。 */
const maxSlashDirs = 16;

export class StartupCache implements OmpVersionCache {
  readonly #deps: StartupCacheDeps;
  #data: StartupSnapshot | null = null;
  /** 可执行文件路径 → 上次 `omp --version` 读到的版本和当时的文件大小、修改时间。 */
  #ompVersions: Record<string, OmpVersionEntry> = {};
  /** 目录键 → 上次取到的斜杠命令列表和当时的输入指纹；对象的键顺序就是记下的先后。 */
  #slashCommands: Record<string, SlashCommandsEntry> = {};
  /** 模型目录、默认模型读到时的输入指纹；没有 = 没读过或已作废。 */
  #catalogStamps: Partial<Record<CatalogKey, string>> = {};
  /** forgetCatalog 一次加一：作废之前开始的现读，结果晚到也不再记（只在内存里，读不会跨重启）。 */
  #catalogGeneration = 0;
  #writing: Promise<void> = Promise.resolve();

  constructor(deps: StartupCacheDeps) {
    this.#deps = deps;
  }

  snapshot(): StartupSnapshot {
    return this.#load();
  }

  /** 上次读到的模型目录（任务进程和服务进程的目录还没读到时，胶囊先用它的名字、窗口和思考档位）。 */
  models(): ModelOption[] {
    return this.#load().models ?? [];
  }

  /** 读到时的指纹和 `stamp` 相同、目录非空，就是现在的模型目录；否则 null（要现读）。 */
  freshModels(stamp: string): ModelOption[] | null {
    const models = this.models();
    return this.#catalogStamps.models === stamp && models.length > 0 ? models : null;
  }

  /** 读到时的指纹和 `stamp` 相同，就是现在 omp 自选的默认模型（null = 一个可用模型都没有）；否则 undefined（要现读）。 */
  freshDefaultModel(stamp: string): DefaultModelInfo | null | undefined {
    const value = this.#load().defaultModel;
    return this.#catalogStamps.defaultModel === stamp ? value : undefined;
  }

  /** 现读开始前取：作为 setDefaultModel / setModels 的 `generation`，读的期间被作废过就不记。 */
  catalogGeneration(): number {
    return this.#catalogGeneration;
  }

  setDefaultModel(value: DefaultModelInfo | null, stamp: string, generation: number): void {
    this.#setCatalog("defaultModel", value, stamp, generation);
  }

  /** 读到的目录和记着的不一样（登录了新 provider、凭据过期……）：默认模型也可能变了，一起作废。 */
  setModels(value: ModelOption[], stamp: string, generation: number): void {
    if (generation !== this.#catalogGeneration) return;
    if (JSON.stringify(this.models()) !== JSON.stringify(value)) delete this.#catalogStamps.defaultModel;
    this.#setCatalog("models", value, stamp, generation);
  }

  /** 登录、退出、改 key、改 provider 之后：模型目录和默认模型都作废（值还留着给胶囊显示），下次读时现读；正在读的结果也不记。 */
  forgetCatalog(): void {
    this.#load();
    this.#catalogGeneration++;
    if (Object.keys(this.#catalogStamps).length === 0) return;
    this.#catalogStamps = {};
    this.#save();
  }

  /** 目录键 `key` 上次取到的斜杠命令列表；记下时的指纹和 `stamp` 不同（或没记过）是 null。 */
  slashCommands(key: string, stamp: string): AvailableSlashCommand[] | null {
    this.#load();
    const entry = this.#slashCommands[key];
    return entry?.stamp === stamp ? entry.commands : null;
  }

  setSlashCommands(key: string, stamp: string, commands: AvailableSlashCommand[]): void {
    this.#load();
    const entry = this.#slashCommands[key];
    if (entry?.stamp === stamp && JSON.stringify(entry.commands) === JSON.stringify(commands)) return;
    delete this.#slashCommands[key];
    this.#slashCommands[key] = { stamp, commands };
    const keys = Object.keys(this.#slashCommands);
    for (const old of keys.slice(0, Math.max(0, keys.length - maxSlashDirs))) delete this.#slashCommands[old];
    this.#save();
  }

  /** projectId 为 null（不在项目里）记在 "global" 下。 */
  setModelDefaults(projectId: string | null, value: ModelDefaults): void {
    this.#update("modelDefaults", { ...this.#load().modelDefaults, [projectId ?? "global"]: value });
  }

  setSubscription(provider: string, value: boolean): void {
    this.#update("subscriptions", { ...this.#load().subscriptions, [provider]: value });
  }

  setApprovalMode(value: ApprovalMode): void {
    this.#update("approvalMode", value);
  }

  ompVersion(binary: OmpBinary): string | null {
    this.#load();
    const entry = this.#ompVersions[binary.path];
    return entry !== undefined && entry.size === binary.size && entry.mtimeMs === binary.mtimeMs ? entry.version : null;
  }

  setOmpVersion(binary: OmpBinary, version: string): void {
    if (this.ompVersion(binary) === version) return;
    this.#ompVersions[binary.path] = { size: binary.size, mtimeMs: binary.mtimeMs, version };
    this.#save();
  }

  #load(): StartupSnapshot {
    if (this.#data) return this.#data;
    this.#data = {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#deps.file, "utf8"));
      if (typeof parsed === "object" && parsed !== null && "version" in parsed && parsed.version === formatVersion) {
        const {
          version: _,
          ompVersions,
          slashCommands,
          catalogStamps,
          ...data
        } = parsed as StartupSnapshot & {
          version: number;
          ompVersions?: Record<string, OmpVersionEntry>;
          slashCommands?: Record<string, SlashCommandsEntry>;
          catalogStamps?: Partial<Record<CatalogKey, string>>;
        };
        this.#data = data;
        this.#ompVersions = ompVersions ?? {};
        this.#slashCommands = slashCommands ?? {};
        this.#catalogStamps = catalogStamps ?? {};
      }
    } catch {
      // 没有文件（第一次启动）或坏了：当没有。
    }
    return this.#data;
  }

  #update<K extends keyof StartupSnapshot>(key: K, value: StartupSnapshot[K]): void {
    const data = this.#load();
    if (JSON.stringify(data[key]) === JSON.stringify(value)) return;
    data[key] = value;
    this.#save();
  }

  #setCatalog<K extends CatalogKey>(key: K, value: StartupSnapshot[K], stamp: string, generation: number): void {
    if (generation !== this.#catalogGeneration) return;
    const data = this.#load();
    if (this.#catalogStamps[key] === stamp && JSON.stringify(data[key]) === JSON.stringify(value)) return;
    data[key] = value;
    this.#catalogStamps[key] = stamp;
    this.#save();
  }

  #save(): void {
    // 串行写，写的是轮到时的最新内容；一次失败只记 WARN（下次现读成功会再写）。
    this.#writing = this.#writing
      .then(() =>
        this.#deps.write(
          this.#deps.file,
          JSON.stringify({
            version: formatVersion,
            ...this.#data,
            ompVersions: this.#ompVersions,
            slashCommands: this.#slashCommands,
            catalogStamps: this.#catalogStamps,
          }),
        ),
      )
      .catch((error: unknown) => this.#deps.warn("writing the startup cache failed", error));
  }

  /** 等在途的写入结束（测试用）。 */
  flushed(): Promise<void> {
    return this.#writing;
  }
}
