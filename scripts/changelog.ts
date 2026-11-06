// 发版时把 CHANGELOG.md / CHANGELOG.en.md 的"未发布"改成版本号，拼 GitHub Release 的正文。读取（取某个版本的说明）在 src/shared/changelog.ts。
import { nextHeading, releaseNotes } from "../src/shared/changelog.ts";

/**
 * 把 unreleased（`## [未发布]` 或 `## [Unreleased]`）改成 `## [<版本>] - <日期>`，并在上面留一个新的空"未发布"。没有内容可发时抛错。
 * 工作区里的文件可能是 CRLF（Windows 上 git 的 autocrlf、按 CRLF 写回的编辑器或脚本）：按 LF 处理，返回时用原来的换行。
 */
export function promoteUnreleased(original: string, version: string, date: string, unreleased: string): string {
  const crlf = original.includes("\r\n");
  const text = crlf ? original.replaceAll("\r\n", "\n") : original;
  const start = text.indexOf(`${unreleased}\n`);
  if (start === -1) throw new Error(`更新日志里没有 "${unreleased}" 一节`);
  if (text.includes(`## [${version}]`)) throw new Error(`更新日志里已经有 ${version} 一节`);
  const body = text.slice(start + unreleased.length + 1, nextHeading(text, start + unreleased.length));
  if (!/^- /m.test(body)) throw new Error(`"${unreleased}" 下面没有任何条目，没有可以发的内容`);
  const promoted = `${text.slice(0, start)}${unreleased}\n\n## [${version}] - ${date}\n${text.slice(start + unreleased.length + 1)}`;
  return crlf ? promoted.replaceAll("\n", "\r\n") : promoted;
}

/** GitHub Release 的正文：英文在前、中文在后，中间一条分隔线。任一边没有这一版时抛错（不发半份说明）。 */
export function releaseBody(en: string, zh: string, version: string): string {
  const english = releaseNotes(en, version);
  if (english === null) throw new Error(`CHANGELOG.en.md 里没有 ${version} 一节`);
  const chinese = releaseNotes(zh, version);
  if (chinese === null) throw new Error(`CHANGELOG.md 里没有 ${version} 一节`);
  return `${english}\n\n---\n\n${chinese}\n`.replaceAll("\r\n", "\n");
}
