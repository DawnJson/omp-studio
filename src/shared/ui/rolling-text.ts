// 文字变化时只动变的那部分（ui/RollingText.tsx，spec §2.6「文字变化」）：新旧文字掐掉相同的头尾，
// 中间如果只有数字变了（非数字部分一样），数字逐位滚：从右往左每位晚 ROLL_STAGGER_MS 起步，数变大 / 变小方向相反；
// 否则中间整段换掉（旧的淡出、新的进来）。头尾不会切在一串数字中间，免得 "9" → "19" 被拆成 "" → "1"。

const ROLL_STAGGER_MS = 35;

export type RollMotion = "inc" | "dec" | "swap";

export interface RollChange {
  from: string;
  to: string;
  motion: RollMotion;
  delayMs: number;
}

/** 字符串是不动的部分。 */
export type RollPart = string | RollChange;

const isDigit = (char: string | undefined): boolean => char !== undefined && char >= "0" && char <= "9";

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  // 退到数字串的边界：边界两边都可能是数字时，整串数字都算变了的部分。
  while (n > 0 && isDigit(a[n - 1]) && (isDigit(a[n]) || isDigit(b[n]))) n -= 1;
  return n;
}

function commonSuffix(a: string, b: string, prefix: number): number {
  let n = 0;
  while (n < a.length - prefix && n < b.length - prefix && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  while (n > 0 && isDigit(a[a.length - n]) && (isDigit(a[a.length - n - 1]) || isDigit(b[b.length - n - 1]))) n -= 1;
  return n;
}

/** 只有数字变了时逐位滚；结构不同（非数字部分变了、数字串个数不同）返回 null。 */
function rollDigits(from: string, to: string): RollPart[] | null {
  const a = from.split(/(\d+)/);
  const b = to.split(/(\d+)/);
  if (a.length !== b.length || a.length < 3 || a.some((piece, index) => index % 2 === 0 && piece !== b[index]))
    return null;
  const first = a.findIndex((piece, index) => index % 2 === 1 && piece !== b[index]);
  const motion: RollMotion = Number(b[first]) > Number(a[first]) ? "inc" : "dec";
  const parts: RollPart[] = [];
  for (let index = 0; index < a.length; index += 1) {
    const old = a[index] ?? "";
    const next = b[index] ?? "";
    if (index % 2 === 0 || old === next) {
      parts.push(next);
      continue;
    }
    const width = Math.max(old.length, next.length);
    const paddedOld = old.padStart(width, " ");
    const paddedNext = next.padStart(width, " ");
    for (let position = 0; position < width; position += 1) {
      const o = paddedOld[position]!.trim();
      const n = paddedNext[position]!.trim();
      if (o === n) parts.push(n);
      else parts.push({ from: o, to: n, motion, delayMs: (width - 1 - position) * ROLL_STAGGER_MS });
    }
  }
  return parts;
}

/** 相邻的不动部分并成一段，去掉空串。 */
function merge(parts: readonly RollPart[]): RollPart[] {
  const out: RollPart[] = [];
  for (const part of parts) {
    if (part === "") continue;
    const last = out.at(-1);
    if (typeof part === "string" && typeof last === "string") out[out.length - 1] = last + part;
    else out.push(part);
  }
  return out;
}

export function rollParts(from: string, to: string): RollPart[] {
  if (from === to) return merge([to]);
  const prefix = commonPrefix(from, to);
  const suffix = commonSuffix(from, to, prefix);
  const oldMiddle = from.slice(prefix, from.length - suffix);
  const newMiddle = to.slice(prefix, to.length - suffix);
  const middle = rollDigits(oldMiddle, newMiddle) ?? [
    { from: oldMiddle, to: newMiddle, motion: "swap" as const, delayMs: 0 },
  ];
  return merge([to.slice(0, prefix), ...middle, to.slice(to.length - suffix)]);
}
