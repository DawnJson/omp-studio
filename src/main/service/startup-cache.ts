// 输入框工具行的启动缓存（StartupSnapshot）：模型胶囊、审批胶囊、上下文圆环、"(sub)" 要的数据都得问 omp，
// 冷启动一两秒才齐。每次现读成功就记一笔，存到 userData/startup-cache.json；渲染进程启动时先用上次的值把工具行画完整。
// 只做显示用：写入、判断照常走现读，这里的值不参与任何决定。文件坏了或版本不对就当没有。
// 同一个文件里还记着 `omp --version` 的结果（按可执行文件的路径、大小、修改时间），启动时 omp 文件没变就不再跑一次（omp/discover.ts）；
// 它不在 StartupSnapshot 里，不发给渲染进程。
import { readFileSync } from "node:fs";
import type {
  ApprovalMode,
  DefaultModelInfo,
  ModelDefaults,
  ModelKey,
  ModelOption,
  StartupSnapshot,
} from "../../shared/ipc.ts";
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

export class StartupCache implements OmpVersionCache {
  readonly #deps: StartupCacheDeps;
  #data: StartupSnapshot | null = null;
  /** 可执行文件路径 → 上次 `omp --version` 读到的版本和当时的文件大小、修改时间。 */
  #ompVersions: Record<string, OmpVersionEntry> = {};
  #writing: Promise<void> = Promise.resolve();

  constructor(deps: StartupCacheDeps) {
    this.#deps = deps;
  }

  snapshot(): StartupSnapshot {
    return this.#load();
  }

  /** 上次读到的模型目录里的这一项（任务进程还没起来时，胶囊先用它的名字和窗口）。 */
  model(key: ModelKey): ModelOption | null {
    return (
      this.#load().models?.find((model) => model.key.provider === key.provider && model.key.modelId === key.modelId) ??
      null
    );
  }

  setDefaultModel(value: DefaultModelInfo | null): void {
    this.#update("defaultModel", value);
  }

  setModels(value: ModelOption[]): void {
    this.#update("models", value);
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
          ...data
        } = parsed as StartupSnapshot & {
          version: number;
          ompVersions?: Record<string, OmpVersionEntry>;
        };
        this.#data = data;
        this.#ompVersions = ompVersions ?? {};
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

  #save(): void {
    // 串行写，写的是轮到时的最新内容；一次失败只记 WARN（下次现读成功会再写）。
    this.#writing = this.#writing
      .then(() =>
        this.#deps.write(
          this.#deps.file,
          JSON.stringify({ version: formatVersion, ...this.#data, ompVersions: this.#ompVersions }),
        ),
      )
      .catch((error: unknown) => this.#deps.warn("writing the startup cache failed", error));
  }

  /** 等在途的写入结束（测试用）。 */
  flushed(): Promise<void> {
    return this.#writing;
  }
}
