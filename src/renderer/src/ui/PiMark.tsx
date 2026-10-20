// 标志里的 π（数据和"层叠"的说明见 shared/ui/pixel-pi.ts）：先画往右下错开 1 像素的淡影，再画 π 本身。
// 只输出 SVG 片段，坐标单位是像素；外层 <svg> 负责 viewBox 和 shape-rendering。
import { cellRects, piCells, shadow } from "../../../shared/ui/pixel-pi.ts";

function Cells({ dx = 0, dy = 0 }: { dx?: number; dy?: number }) {
  return piCells.flatMap((cell) =>
    cellRects(cell).map(([x, y, width, height]) => (
      <rect key={`${x}-${y}`} x={x + dx} y={y + dy} width={width} height={height} fill={cell.color} />
    )),
  );
}

export function PiMark() {
  return (
    <>
      <g opacity={shadow.opacity}>
        <Cells dx={shadow.dx} dy={shadow.dy} />
      </g>
      <g>
        <Cells />
      </g>
    </>
  );
}
