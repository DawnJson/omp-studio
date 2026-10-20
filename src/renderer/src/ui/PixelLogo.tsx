// 新任务页的标志：π（照 omp 终端版启动画面，加"层叠"淡影，见 shared/ui/pixel-pi.ts）+ 右边半块字符的像素字 "omp"，
// 后面接同一套像素字的 "studio"，字下一行暗色版本号。半块字符一个像素就是 1×1。
import { markHeight, piWidth } from "../../../shared/ui/pixel-pi.ts";
import { PiMark } from "./PiMark.tsx";

/**
 * 像素字：每个字是若干行，"X" = 一个像素。第 0 行对齐 π 的第 0 个像素行；x 高 4 行（2–5），
 * 升部在 0–1（t、d、i），降部在 6–7（p）。o、m、p 与 omp 的字形一致，其余按同一笔画补齐。
 * 画的时候整体下移 textY 行：x 高的中线（第 4 行）对上 π 的中线（第 5 行），字和 π 上下居中，不再贴着 π 的横。
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

/** π 和字之间空 7 格，和 omp 一样。 */
const textX = piWidth + 7;
const textY = 1;
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
      for (let column = 0; column < row.length; column++)
        if (row[column] === "X") pixels.push({ x: x + column, y: y + textY });
    });
    x += width + (index < word.length - 1 ? letterGap : 0);
  }
  return { pixels, endX: x };
}

const omp = layoutWord("omp", textX);
const studio = layoutWord("studio", omp.endX + wordGap);
const viewWidth = studio.endX;
/** π 的淡影比 π 低 1 像素，整幅高度跟着标志走。 */
const viewHeight = markHeight;

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
      <PiMark />
      <path d={pathOf(omp.pixels)} fill="var(--text)" />
      <path d={pathOf(studio.pixels)} fill="var(--text-2)" />
      {version && (
        <text
          x={textX}
          y={10.4}
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
