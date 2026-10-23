// 输入历史的落盘（userData/input-history.json）：按项目分开，每个项目最多 MAX_HISTORY 条，只存文字（附件、图片、粘贴占位符都不存）。
// 不 import electron：文件路径由调用方给（可能带空格和中文），单元测试直接实例化。
import { readFile } from "node:fs/promises";
import { MAX_HISTORY, pushEntry } from "../../shared/input-history.ts";
import { writeFileAtomic } from "./atomic-write.ts";

/** 最多记多少个项目；超过时丢最久没发过消息的那个（对象的插入顺序 = 最近发过消息的在最后）。 */
const MAX_PROJECTS = 200;

export class InputHistoryStore {
  readonly #file: string;
  #cache: Map<string, string[]> | null = null;
  #writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async #load(): Promise<Map<string, string[]>> {
    if (this.#cache) return this.#cache;
    try {
      const raw: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      const entries = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Object.entries(raw) : [];
      this.#cache = new Map(
        entries.flatMap(([projectId, list]) =>
          Array.isArray(list) && list.every((item) => typeof item === "string")
            ? [[projectId, (list as string[]).slice(-MAX_HISTORY)] as [string, string[]]]
            : [],
        ),
      );
    } catch (error) {
      // 只有文件不存在才是"还没有历史"；其它错误（EBUSY、JSON 损坏…）抛给调用方，免得下一次保存把原文件覆盖成空的。
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      this.#cache = new Map();
    }
    return this.#cache;
  }

  /** 这个项目发过的文字，从旧到新。 */
  async get(projectId: string): Promise<string[]> {
    return [...((await this.#load()).get(projectId) ?? [])];
  }

  /** 记一条（空的、太长的、和上一条相同的不记）。 */
  async record(projectId: string, text: string): Promise<void> {
    const projects = await this.#load();
    const before = projects.get(projectId) ?? [];
    const after = pushEntry(before, text);
    if (after.length === before.length && after.at(-1) === before.at(-1)) return;
    projects.delete(projectId);
    projects.set(projectId, after);
    while (projects.size > MAX_PROJECTS) projects.delete(projects.keys().next().value as string);
    const snapshot = JSON.stringify(Object.fromEntries(projects));
    // 串行写：一次失败不连累后面的写入；这次的错误返回给调用方。
    const run = this.#writing.then(() => writeFileAtomic(this.#file, snapshot, "input-history"));
    this.#writing = run.catch(() => {});
    await run;
  }
}
