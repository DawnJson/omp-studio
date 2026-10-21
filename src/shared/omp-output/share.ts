// `omp share <会话文件> [--gist]` 的输出解析（纯函数）。omp 18.12.5 实测（本地 127.0.0.1 假 share 服务器，没有连真实服务器）：
//   成功：退出码 0，标准输出一行 `Share URL: <serverUrl>/<id>#<key>`；
//   失败：退出码 1，标准输出为空，标准错误是 Bun 的源码片段加堆栈，其中一行 `error: Share upload to <url> failed: <原因>`。
// omp 文档（session-operations-export-share-fork-resume.md "Share"）说 UI 还会报告 gist 链接和截断说明；gist 那种输出**没有实测**，
// 所以：`Gist URL:` 行按标签认，认不出时 url 为 null、界面显示 omp 原文，不猜。
import type { ShareResult } from "../ipc.ts";

const URL_LINE = /^\s*(share url|gist url)\s*:\s*(\S+)\s*$/i;
const HTTP_URL = /^https?:\/\/\S+$/i;

/** 只接受 http(s) 链接：这个值会交给 shell.openExternal。 */
function httpUrl(value: string): string | null {
  return HTTP_URL.test(value) ? value : null;
}

export function parseShareOutput(stdout: string): ShareResult {
  let url: string | null = null;
  let gistUrl: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const match = URL_LINE.exec(line);
    if (match === null) continue;
    const found = httpUrl(match[2]!);
    if (found === null) continue;
    if (match[1]!.toLowerCase() === "share url") url ??= found;
    else gistUrl ??= found;
  }
  return { url, gistUrl, text: stdout };
}

/** 失败时给界面的那一句：优先 stderr 里的 `error:` 行（去掉前缀），否则 stderr 最后一个非空行。 */
export function shareErrorMessage(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const errorLine = lines.find((line) => /^error:/i.test(line));
  const picked = errorLine ?? lines.at(-1) ?? "";
  return picked.replace(/^error:\s*/i, "").slice(0, 400);
}
