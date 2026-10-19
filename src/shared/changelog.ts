// CHANGELOG.md 的读取：发版脚本、更新目录和应用里的"最近更新"共用。
// 约定见 CHANGELOG.md 开头：二级标题 `## [未发布]` 或 `## [<版本>] - <日期>`，三级标题 `### 新增 / 变更 / 修复`，每条一个 `- `。
export const UNRELEASED_HEADING = "## [未发布]";

/** 取出 `## [<版本>]` 这一节的正文（不含标题），去掉首尾空行。没有这一节（比如测试更新用的临时版本）返回 null。 */
export function releaseNotes(text: string, version: string): string | null {
  const heading = text.indexOf(`## [${version}]`);
  if (heading === -1) return null;
  const bodyStart = text.indexOf("\n", heading) + 1;
  return text.slice(bodyStart, nextHeading(text, bodyStart)).trim();
}

/** from 之后下一个二级标题的位置；没有就是文末。 */
export function nextHeading(text: string, from: number): number {
  const index = text.indexOf("\n## ", from);
  return index === -1 ? text.length : index + 1;
}

/** 已发布的版本号，按文件里的顺序（新的在前）；不含"未发布"。 */
export function releasedVersions(text: string): string[] {
  return [...text.matchAll(/^## \[([^\]]+)\]/gm)]
    .map((match) => match[1] ?? "")
    .filter((version) => `## [${version}]` !== UNRELEASED_HEADING);
}

export interface ReleaseCounts {
  added: number;
  changed: number;
  fixed: number;
  /** 全部条目，含不属于这三类的。 */
  total: number;
}

/** 数一节说明里的条目：`### 新增 / 变更 / 修复` 下面的 `- ` 行。 */
export function countEntries(notes: string): ReleaseCounts {
  const counts: ReleaseCounts = { added: 0, changed: 0, fixed: 0, total: 0 };
  let group: keyof Omit<ReleaseCounts, "total"> | null = null;
  for (const line of notes.split("\n")) {
    const heading = /^### (.+)$/.exec(line.trim());
    if (heading) {
      const name = heading[1]?.trim();
      group = name === "新增" ? "added" : name === "变更" ? "changed" : name === "修复" ? "fixed" : null;
    } else if (line.startsWith("- ")) {
      counts.total++;
      if (group !== null) counts[group]++;
    }
  }
  return counts;
}
