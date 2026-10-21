// `/changelog` 的输出（omp 18.12.5 rpc-ui）：整段 markdown，每个版本一节 `## [18.12.3] - 2026-10-14`，节下是 `### Added` 等小标题。
// omp 按时间正序输出（实测 18.12.5 的输出是 18.12.3、18.12.4、18.12.5，只有最近几版）：这里按版本从新到旧排，界面最上面就是最新的。
// 拆成按版本的节，界面按节折叠（只展开最新一节）；认不出节标题时整段当作一节，不丢内容。
import { compareVersions } from "../omp-version.ts";

export interface ChangelogSection {
  /** 版本号，如 `18.12.3`；`Unreleased` 或认不出的标题原样；没有任何节标题时为 null。 */
  version: string | null;
  /** 节标题行 `## …` 后面的日期等，没有为 null。 */
  date: string | null;
  /** 节的 markdown 正文（不含 `## ` 标题行）。 */
  body: string;
}

const HEADING = /^##\s+\[?([^\]\s]+)\]?(?:\s*[-–—]\s*(.+?))?\s*$/;

export function splitChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: { version: string | null; date: string | null; lines: string[] } | null = null;
  const close = () => {
    if (current !== null)
      sections.push({ version: current.version, date: current.date, body: current.lines.join("\n").trim() });
  };
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);
    if (heading !== null) {
      close();
      current = { version: heading[1] ?? null, date: heading[2] ?? null, lines: [] };
    } else current?.lines.push(line);
  }
  close();
  if (sections.length === 0) {
    const body = text.trim();
    return body === "" ? [] : [{ version: null, date: null, body }];
  }
  return sections.sort(newestFirst);
}

const NUMERIC_VERSION = /^\d/;

/** 版本号从新到旧；`Unreleased` 之类不是数字版本的排最前，彼此保持原有顺序（Array.sort 稳定）。 */
function newestFirst(a: ChangelogSection, b: ChangelogSection): number {
  const aNumeric = a.version !== null && NUMERIC_VERSION.test(a.version);
  const bNumeric = b.version !== null && NUMERIC_VERSION.test(b.version);
  if (aNumeric && bNumeric) return compareVersions(b.version ?? "", a.version ?? "");
  if (aNumeric !== bNumeric) return aNumeric ? 1 : -1;
  return 0;
}
