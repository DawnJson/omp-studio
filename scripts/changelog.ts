// 发版时把 CHANGELOG.md 的"未发布"改成版本号。读取（取某个版本的说明）在 src/shared/changelog.ts。
import { nextHeading, UNRELEASED_HEADING } from "../src/shared/changelog.ts";

/** 把 `## [未发布]` 改成 `## [<版本>] - <日期>`，并在上面留一个新的空"未发布"。没有内容可发时抛错。 */
export function promoteUnreleased(text: string, version: string, date: string): string {
  const start = text.indexOf(`${UNRELEASED_HEADING}\n`);
  if (start === -1) throw new Error(`CHANGELOG.md 里没有 "${UNRELEASED_HEADING}" 一节`);
  if (text.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md 里已经有 ${version} 一节`);
  const body = text.slice(start + UNRELEASED_HEADING.length + 1, nextHeading(text, start + UNRELEASED_HEADING.length));
  if (!/^- /m.test(body)) throw new Error(`"${UNRELEASED_HEADING}" 下面没有任何条目，没有可以发的内容`);
  return `${text.slice(0, start)}${UNRELEASED_HEADING}\n\n## [${version}] - ${date}\n${text.slice(start + UNRELEASED_HEADING.length + 1)}`;
}
