// 读 omp 的用户键位文件（只读，不写、不迁移）：`<agent 目录>/keybindings.yml`，其次 `.yaml`，再其次旧的 `.json`
// （omp 的 `R_s`：yml > yaml > json；omp 自己加载 json 时会把它迁移成 yml，studio 不碰）。格式和默认键见 omp://keybindings.md。
// 解析不了的文件按"没有覆盖"处理（omp 自己也是记一条警告、用默认键位），不让转发键整个失效。
// 命名 profile（`OMP_PROFILE`）会先读默认 profile 的文件再叠加：和会话索引、models.yml 一样，studio 目前只认默认 profile。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveOmpKeybindings, type OmpKeybinding } from "../../shared/tsp/omp-keybindings.ts";
import { log } from "../log/log.ts";

const fileNames = ["keybindings.yml", "keybindings.yaml", "keybindings.json"] as const;

/** 用户文件解析后的值；没有文件、读不了或解析不了时 null。 */
export async function readUserKeybindings(agentDir: string): Promise<unknown> {
  for (const name of fileNames) {
    const file = path.join(agentDir, name);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      log.warn("reading the omp keybindings file failed", { name, message: String(error) });
      return null;
    }
    try {
      // yaml 是 JSON 的超集：`.json`（omp 按 JSONC 读）也用它解析。
      return parse(text) as unknown;
    } catch (error) {
      log.warn("parsing the omp keybindings file failed", { name, message: String(error) });
      return null;
    }
  }
  return null;
}

export async function readOmpKeybindings(agentDir: string): Promise<OmpKeybinding[]> {
  return resolveOmpKeybindings(await readUserKeybindings(agentDir));
}
