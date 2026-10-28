// `omp config list --json` 按目录的缓存：每次都是一次完整的 omp 启动（几百 MB 内存、上百毫秒 CPU），
// 而审批胶囊（输入框挂载、切项目）、草稿默认模型、轮次结束的通知开关、分享确认框、模型选择对话框都要读它。
// 结果只取决于 omp 版本和 omp 读的设置文件（configListInputs）：指纹没变就用上次的；同一目录同时来的读共用一次（存的是 promise），失败的不留。
// 经 studio 写配置的前后 clear()，写之后的读另起一次。
// 只在内存里：一个目录的结果约 100 KB（omp 18.13.3 实测），不进启动缓存文件；最多留 maxEntries 个目录（每个 worktree 是一个目录），超出时丢最久没用的。

import path from "node:path";

const maxEntries = 8;

/**
 * omp 为 `dir` 合成设置时读的文件（omp://settings.md，omp 18.13.3）：agent 目录的 config.yml 或 config.yaml，
 * 两者都没有时迁移 settings.json；项目的 `.omp/settings.json` 再叠 `.omp/config.yml`。
 */
export function configListInputs(agentDir: string, dir: string): string[] {
  return [
    path.join(agentDir, "config.yml"),
    path.join(agentDir, "config.yaml"),
    path.join(agentDir, "settings.json"),
    path.join(dir, ".omp", "config.yml"),
    path.join(dir, ".omp", "settings.json"),
  ];
}

export interface ConfigListCacheDeps {
  /** 这个目录的 list 结果依赖的输入的指纹。 */
  stamp(dir: string): Promise<string>;
  /** 真跑一次 `omp config list --json`。 */
  run(dir: string): Promise<unknown>;
  key(dir: string): string;
}

interface Entry {
  stamp: string;
  value: Promise<unknown>;
}

export class ConfigListCache {
  readonly #deps: ConfigListCacheDeps;
  readonly #entries = new Map<string, Entry>();

  constructor(deps: ConfigListCacheDeps) {
    this.#deps = deps;
  }

  async list(dir: string): Promise<unknown> {
    const key = this.#deps.key(dir);
    // 先取指纹再跑：跑的期间配置被改，记下的是旧指纹，下次读对不上就会重跑。
    const stamp = await this.#deps.stamp(dir);
    const cached = this.#entries.get(key);
    // Map 的顺序就是最近使用的顺序：用到的挪到最后。
    this.#entries.delete(key);
    if (cached?.stamp === stamp) {
      this.#entries.set(key, cached);
      return cached.value;
    }
    const entry: Entry = { stamp, value: this.#deps.run(dir) };
    this.#entries.set(key, entry);
    for (const old of this.#entries.keys()) {
      if (this.#entries.size <= maxEntries) break;
      this.#entries.delete(old);
    }
    entry.value.catch(() => {
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
    });
    return entry.value;
  }

  clear(): void {
    this.#entries.clear();
  }
}
