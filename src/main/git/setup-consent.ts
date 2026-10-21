// worktree setup 脚本的"用户确认过"记录：userData/setup-consent.json，按项目路径 + 脚本内容 sha256 记。
// 脚本内容变了（哈希变）就没有记录，要重新问。这是 omp-studio 自己的偏好，和 omp 配置无关。
// 主进程在运行脚本前查它（createWorktree 的 approveSetup），渲染进程的确认只是申请写入。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renameWithRetry } from "../tasks/atomic-write.ts";
import { pathKey } from "../tasks/task-registry.ts";

type Records = Record<string, string[]>;

export class SetupConsent {
  readonly #file: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async #read(): Promise<Records> {
    let text: string;
    try {
      text = await readFile(this.#file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
    const json: unknown = JSON.parse(text);
    const records: Records = {};
    if (typeof json !== "object" || json === null) return records;
    for (const [key, value] of Object.entries(json))
      if (Array.isArray(value)) records[key] = value.filter((item): item is string => typeof item === "string");
    return records;
  }

  async isApproved(projectPath: string, sha256: string): Promise<boolean> {
    return ((await this.#read())[pathKey(projectPath)] ?? []).includes(sha256);
  }

  /** 记下这个项目的这份脚本内容已确认（写入串行，原子替换）。 */
  approve(projectPath: string, sha256: string): Promise<void> {
    const run = async () => {
      const records = await this.#read();
      const key = pathKey(projectPath);
      const known = records[key] ?? [];
      if (known.includes(sha256)) return;
      records[key] = [...known, sha256];
      await mkdir(path.dirname(this.#file), { recursive: true });
      const temp = `${this.#file}.tmp`;
      await writeFile(temp, JSON.stringify(records, null, 2), "utf8");
      await renameWithRetry(temp, this.#file);
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }
}
