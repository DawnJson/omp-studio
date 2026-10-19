// 新任务页的标志，照 omp 终端版启动时的样子画（omp 18.12.2 实测）：块字符拼的 π，逐格从粉到紫再到蓝的渐变，
// 左腿最下一格是 ▒；右边是半块字符的像素字 "omp"，下面一行暗色版本号。这里把 "omp" 后面接上同一套像素字的 "studio"。
// 一格终端字符宽 1、高 2 个像素单位；半块字符一个像素就是 1×1。颜色是 omp 的原值（与主题无关）。
import { Fragment } from "react";

/** π 的 5 行 12 列（每行一格 = 2 个像素高）：null = 空，"#" 实块，"%" ▒。颜色逐格取自 omp 的输出。 */
const pi: readonly (readonly ([string, "#" | "%"] | null)[])[] = [
  [
    ["#f84fcc", "#"],
    ["#ef51d0", "#"],
    ["#e652d3", "#"],
    ["#dc54d7", "#"],
    ["#d356db", "#"],
    ["#ca58de", "#"],
    ["#c159e2", "#"],
    ["#b85be5", "#"],
    ["#af5de9", "#"],
    ["#a55fed", "#"],
    ["#9c60f0", "#"],
    ["#9362f4", "#"],
  ],
  [null, null, null, ["#c359e1", "#"], ["#ba5be5", "#"], null, null, ["#9e60ef", "#"], ["#9562f3", "#"]],
  [null, null, null, ["#aa5eeb", "#"], ["#a15fef", "#"], null, null, ["#7f72f2", "#"], ["#727ef0", "#"]],
  [null, null, null, ["#9065f4", "%"], ["#8270f2", "%"], null, null, ["#5a91ee", "#"], ["#4d9cec", "#"]],
  [null, null, null, null, null, null, null, ["#35afea", "#"], ["#28bae8", "#"]],
];

/**
 * 像素字：每个字是若干行，"X" = 一个像素。第 0 行对齐 π 的第 0 个像素行；x 高 4 行（2–5），
 * 升部在 0–1（t、d、i），降部在 6–7（p）。o、m、p 与 omp 的字形一致，其余按同一笔画补齐。
 */
const glyphs: Record<string, readonly string[]> = {
  o: ["", "", ".XX.", "X..X", "X..X", ".XX."],
  m: ["", "", "XX.X.", "X.X.X", "X.X.X", "X.X.X"],
  p: ["", "", "XXX.", "X..X", "X..X", "XXX.", "X...", "X..."],
  s: ["", "", ".XXX", "XX..", "..XX", "XXX."],
  t: ["", ".X.", "XXX", ".X.", ".X.", ".XX"],
  u: ["", "", "X..X", "X..X", "X..X", ".XXX"],
  d: ["...X", "...X", ".XXX", "X..X", "X..X", ".XXX"],
  i: ["X", "", "X", "X", "X", "X"],
};

const piWidth = 12;
/** π 和字之间空 7 格，和 omp 一样。 */
const textX = piWidth + 7;
const letterGap = 1;
const wordGap = 3;

interface Pixel {
  x: number;
  y: number;
}

function layoutWord(word: string, startX: number): { pixels: Pixel[]; endX: number } {
  const pixels: Pixel[] = [];
  let x = startX;
  for (const [index, char] of [...word].entries()) {
    const rows = glyphs[char] ?? [];
    const width = Math.max(...rows.map((row) => row.length));
    rows.forEach((row, y) => {
      for (let column = 0; column < row.length; column++) if (row[column] === "X") pixels.push({ x: x + column, y });
    });
    x += width + (index < word.length - 1 ? letterGap : 0);
  }
  return { pixels, endX: x };
}

const omp = layoutWord("omp", textX);
const studio = layoutWord("studio", omp.endX + wordGap);
const viewWidth = studio.endX;
const viewHeight = 10;

function pathOf(pixels: readonly Pixel[]): string {
  return pixels.map(({ x, y }) => `M${x} ${y}h1v1h-1z`).join("");
}

export function PixelLogo({ version, unit = 6 }: { version?: string | null; unit?: number }) {
  return (
    <svg
      className="pixel-logo"
      width={viewWidth * unit}
      height={viewHeight * unit}
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="omp studio"
      data-testid="pixel-logo"
    >
      {pi.map((row, rowIndex) =>
        row.map((cell, column) => {
          if (cell === null) return null;
          const [color, kind] = cell;
          const y = rowIndex * 2;
          return kind === "#" ? (
            <rect key={`${rowIndex}-${column}`} x={column} y={y} width={1} height={2} fill={color} />
          ) : (
            // ▒：半像素棋盘格。
            <Fragment key={`${rowIndex}-${column}`}>
              {[0, 0.5, 1, 1.5].map((dy) => (
                <rect key={dy} x={column + (dy % 1)} y={y + dy} width={0.5} height={0.5} fill={color} />
              ))}
            </Fragment>
          );
        }),
      )}
      <path d={pathOf(omp.pixels)} fill="var(--text)" />
      <path d={pathOf(studio.pixels)} fill="var(--text-2)" />
      {version && (
        <text
          x={textX}
          y={9.6}
          fontSize={1.9}
          fill="var(--text-3)"
          style={{ fontFamily: "var(--font-mono)" }}
          data-testid="pixel-logo-version"
        >
          v{version}
        </text>
      )}
    </svg>
  );
}
