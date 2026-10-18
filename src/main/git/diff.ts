// unified diff 的解析和单个 hunk 的补丁重建。纯函数，不碰磁盘。
// 文件内容不一定是 UTF-8，所以先按 latin1 切（字节和字符一一对应），拼回补丁时原样还原成字节；
// 只有给界面看的 text 才把每一行按 UTF-8 解码。
import type { GitDiffHunk, GitDiffLine, GitFileDiff } from "../../shared/git.ts";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** 切开的原始 diff：header 是第一个 @@ 之前的全部行；每个 hunk 含它的 @@ 行，每行以 \n 结尾。都是 latin1 字符串。 */
export interface RawDiff {
  header: string;
  hunks: string[];
}

const utf8 = (latin1: string) => Buffer.from(latin1, "latin1").toString("utf8");

/** 切开 `git diff` 的单文件输出；二进制文件（header 里是 "Binary files … differ"）返回 null。 */
export function splitRawDiff(raw: Buffer): RawDiff | null {
  const lines = raw.toString("latin1").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let header = "";
  const hunks: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    if (HUNK_RE.test(line)) {
      if (current !== null) hunks.push(current);
      current = `${line}\n`;
    } else if (current === null) {
      if (line.startsWith("Binary files ") || line === "GIT binary patch") return null;
      header += `${line}\n`;
    } else {
      current += `${line}\n`;
    }
  }
  if (current !== null) hunks.push(current);
  return { header, hunks };
}

function parseHunk(raw: string): GitDiffHunk {
  const lines = raw.split("\n");
  lines.pop(); // 末尾的空串（最后一行以 \n 结尾）
  const headerLine = lines.shift() ?? "";
  const match = HUNK_RE.exec(headerLine);
  if (!match) throw new Error("not a hunk");
  const oldStart = Number(match[1]);
  const newStart = Number(match[3]);
  const out: GitDiffLine[] = [];
  let oldNo = oldStart;
  let newNo = newStart;
  for (const line of lines) {
    const mark = line[0];
    const text = utf8(line.slice(1));
    if (mark === "+") out.push({ kind: "add", oldNo: null, newNo: newNo++, text });
    else if (mark === "-") out.push({ kind: "del", oldNo: oldNo++, newNo: null, text });
    else if (mark === "\\") {
      const last = out[out.length - 1];
      if (last) last.noEol = true;
    } else out.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text });
  }
  return {
    header: utf8(headerLine),
    oldStart,
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart,
    newLines: match[4] === undefined ? 1 : Number(match[4]),
    lines: out,
  };
}

export function toFileDiff(raw: RawDiff | null): GitFileDiff {
  if (raw === null) return { kind: "binary" };
  const hunks = raw.hunks.map(parseHunk);
  let added = 0;
  let removed = 0;
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      if (line.kind === "add") added++;
      else if (line.kind === "del") removed++;
    }
  return { kind: "text", hunks, added, removed };
}

/** 单个 hunk 的可 `git apply` 的补丁：原 header + 这个 hunk。 */
export function buildHunkPatch(raw: RawDiff, index: number): Buffer {
  const hunk = raw.hunks[index];
  if (hunk === undefined) throw new Error(`hunk ${index} does not exist`);
  return Buffer.from(raw.header + hunk, "latin1");
}

/** 文件头部 8000 字节里有 NUL 就当二进制（git 自己用的判据）。 */
export function looksBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

/** 未跟踪文件：整个文件是一个全新增的 hunk。调用方先排除二进制和过大文件。 */
export function diffOfNewFile(content: Buffer): GitFileDiff {
  const text = content.toString("utf8");
  if (text === "") return { kind: "text", hunks: [], added: 0, removed: 0 };
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (endsWithNewline) lines.pop();
  const out: GitDiffLine[] = lines.map((line, i) => ({ kind: "add", oldNo: null, newNo: i + 1, text: line }));
  if (!endsWithNewline) {
    const last = out[out.length - 1];
    if (last) last.noEol = true;
  }
  const hunk: GitDiffHunk = {
    header: `@@ -0,0 +1${out.length === 1 ? "" : `,${out.length}`} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: out.length,
    lines: out,
  };
  return { kind: "text", hunks: [hunk], added: out.length, removed: 0 };
}
