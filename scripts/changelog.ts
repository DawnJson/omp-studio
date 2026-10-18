// CHANGELOG.md 的两处机器读写：发版时把"未发布"改成版本号，生成更新目录时取出某个版本的说明。
// 约定见 CHANGELOG.md 开头：二级标题 `## [未发布]` 或 `## [<版本>] - <日期>`。
const UNRELEASED = "## [未发布]";

/** 把 `## [未发布]` 改成 `## [<版本>] - <日期>`，并在上面留一个新的空"未发布"。没有内容可发时抛错。 */
export function promoteUnreleased(text: string, version: string, date: string): string {
  const start = text.indexOf(`${UNRELEASED}\n`);
  if (start === -1) throw new Error(`CHANGELOG.md 里没有 "${UNRELEASED}" 一节`);
  if (text.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md 里已经有 ${version} 一节`);
  const body = text.slice(start + UNRELEASED.length + 1, nextHeading(text, start + UNRELEASED.length));
  if (!/^- /m.test(body)) throw new Error(`"${UNRELEASED}" 下面没有任何条目，没有可以发的内容`);
  return `${text.slice(0, start)}${UNRELEASED}\n\n## [${version}] - ${date}\n${text.slice(start + UNRELEASED.length + 1)}`;
}

/** 取出 `## [<版本>]` 这一节的正文（不含标题），去掉首尾空行。没有这一节（比如测试更新用的临时版本）返回 null。 */
export function releaseNotes(text: string, version: string): string | null {
  const heading = text.indexOf(`## [${version}]`);
  if (heading === -1) return null;
  const bodyStart = text.indexOf("\n", heading) + 1;
  return text.slice(bodyStart, nextHeading(text, bodyStart)).trim();
}

/** from 之后下一个二级标题的位置；没有就是文末。 */
function nextHeading(text: string, from: number): number {
  const index = text.indexOf("\n## ", from);
  return index === -1 ? text.length : index + 1;
}
