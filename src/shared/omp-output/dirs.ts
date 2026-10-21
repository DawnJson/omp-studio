// `/dirs`、`/add-dir <路径>`、`/remove-dir <路径>` 的输出（TSP 里是状态 toast，rpc 里是 `command_output`，文本相同）。
// 格式不是 omp 的契约：用 omp 18.12.5 实测原文写单测（test/omp-output-dirs.test.ts）；解析不了时返回 `unparsed`，界面显示原文。
//
// 实测（omp 18.12.5，rpc-ui，Windows，临时 PI_CODING_AGENT_DIR）：
// - `/dirs` → `Workspace directories:\n  <cwd> (working directory)\n  <额外目录>…`（每行两格缩进；只有第一行带后缀）。
// - 成功：`Added <p>.\n<列表>` / `Removed <p>.\n<列表>`；`/add-dir` 不带参数（TSP toast）：`Usage: /add-dir <path>\n<列表>`；
//   `/remove-dir` 不带参数：`Usage: /remove-dir <path>`（没有列表）。
// - 拒绝（没有列表）：`Directory does not exist: <p>`、`Already in the workspace: <p>`、`Not a workspace directory: <p>`。
// - 参数是命令名之后的整行（去首尾空白）：路径里的空格、中文、单引号原样可用；双引号 / 单引号包住路径不会被剥掉，
//   而是当成路径的一部分（相对 cwd 解析后 "Directory does not exist"）。所以拼命令时绝不能加引号。
// - 目录只属于这一个会话（不写配置文件），进程重启就没了：界面要以 `/dirs` 的最新输出为准。

/** 解析结果里的"这次动作发生了什么"。 */
export type DirsNotice = { kind: "added" | "removed"; path: string } | { kind: "usage"; text: string };

export type DirsRejection = "missing" | "already" | "not-member" | "usage";

export type DirsOutput =
  /** 带目录列表的输出（`/dirs`，以及成功的 add / remove）：`dirs` 是额外目录（不含 cwd），按 omp 给的顺序。 */
  | { kind: "dirs"; cwd: string; dirs: string[]; notice: DirsNotice | null }
  /** omp 拒绝了这次操作（没有列表）。`message` 是 omp 原文。 */
  | { kind: "rejected"; reason: DirsRejection; path: string; message: string }
  /** 认不出来：调用方把原文给用户看。 */
  | { kind: "unparsed"; text: string };

const HEADER = "Workspace directories:";
const CWD_SUFFIX = " (working directory)";
const REJECTIONS: ReadonlyArray<readonly [string, DirsRejection]> = [
  ["Directory does not exist: ", "missing"],
  ["Already in the workspace: ", "already"],
  ["Not a workspace directory: ", "not-member"],
  ["Usage: ", "usage"],
];

export function parseDirsOutput(raw: string): DirsOutput {
  const text = raw.replace(/\r\n/g, "\n").trim();
  for (const [prefix, reason] of REJECTIONS) {
    if (text.startsWith(prefix) && !text.includes("\n"))
      return { kind: "rejected", reason, path: text.slice(prefix.length), message: text };
  }
  const lines = text.split("\n");
  const headerAt = lines.indexOf(HEADER);
  if (headerAt < 0) return { kind: "unparsed", text: raw };

  const entries = lines.slice(headerAt + 1);
  if (entries.length === 0 || !entries.every((entry) => entry.startsWith("  ") && entry.trim() !== ""))
    return { kind: "unparsed", text: raw };
  const [first, ...rest] = entries.map((entry) => entry.slice(2));
  if (first === undefined || !first.endsWith(CWD_SUFFIX)) return { kind: "unparsed", text: raw };
  const cwd = first.slice(0, -CWD_SUFFIX.length);

  const before = lines.slice(0, headerAt).join("\n");
  let notice: DirsNotice | null = null;
  if (before !== "") {
    const added = /^Added ([\s\S]+)\.$/.exec(before);
    const removed = /^Removed ([\s\S]+)\.$/.exec(before);
    if (added?.[1] !== undefined) notice = { kind: "added", path: added[1] };
    else if (removed?.[1] !== undefined) notice = { kind: "removed", path: removed[1] };
    else if (before.startsWith("Usage: ")) notice = { kind: "usage", text: before };
    else return { kind: "unparsed", text: raw };
  }
  return { kind: "dirs", cwd, dirs: rest, notice };
}
