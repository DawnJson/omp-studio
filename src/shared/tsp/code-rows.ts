// code 节点的行布局（规范 TspCodeProps.start / nums / marks）：每行的行号、标记色条，以及不连续处的 `…` 间隔行。

/** 一行代码（index 是 text 里的第几行）或行号跳跃处的 `…` 间隔行。 */
export type CodeRow =
  { kind: "line"; index: number; num: number; mark: string | undefined } | { kind: "gap"; num: number };

/** nums 有效（长度等于行数、严格递增的整数）就用它，否则从 start 往上数。 */
export function codeLineNumbers(lineCount: number, start: number, nums: unknown): readonly number[] {
  if (
    Array.isArray(nums) &&
    nums.length === lineCount &&
    nums.every(
      (n: unknown, index) =>
        typeof n === "number" && Number.isInteger(n) && (index === 0 || n > (nums[index - 1] as number)),
    )
  ) {
    return nums as number[];
  }
  return Array.from({ length: lineCount }, (_, index) => start + index);
}

/** 标记的色条：有 tone 用 tone；没有 tone 也没有 heat / wash 默认 accent；只有 heat / wash 不画色条。 */
function markBar(mark: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!mark) return undefined;
  if (typeof mark.tone === "string") return mark.tone;
  return mark.heat === undefined && mark.wash === undefined ? "accent" : undefined;
}

/** 头 lineCount 行的布局：行号不是上一行 + 1 的行前插一条间隔行；mark.line 按同一套行号匹配。 */
export function codeRows(
  numbers: readonly number[],
  lineCount: number,
  marks: readonly Readonly<Record<string, unknown>>[],
): CodeRow[] {
  const rows: CodeRow[] = [];
  for (let index = 0; index < lineCount; index++) {
    const num = numbers[index]!;
    if (index > 0 && num !== numbers[index - 1]! + 1) rows.push({ kind: "gap", num });
    rows.push({ kind: "line", index, num, mark: markBar(marks.find((m) => m.line === num)) });
  }
  return rows;
}
