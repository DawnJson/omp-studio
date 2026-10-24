// 状态行最左边"正在思考"的图标：标志里的像素 π（shared/ui/pixel-pi.ts）按笔画顺序一格格亮起（先横、再左腿、再右腿），
// 写满停一下，再按同样顺序褪掉，循环（2026-10-24 仓库所有者从六个候选里选定，代替原来的立体点阵球）。
// 动画全在 CSS（composer.css 的 .pi-write）：每格同一段 keyframes，按笔画序号错开起点；keyframes 的 0% 帧是"亮着"，
// 减少动效（--play-state: paused）时停在 0% 帧，就是一个完整的静态 π。
import type { CSSProperties } from "react";
import { cellRects, piCells, type PiCell } from "../../../../shared/ui/pixel-pi.ts";

/** π 竖着的两条腿以第 6 列为界：左腿在 3–4 列，右腿在 7–8 列。 */
const legSplit = 6;

/** 笔画顺序的排序键：横从左到右，然后左腿、右腿各自从上到下（同一行先左后右）。 */
function strokeKey(cell: PiCell): number {
  if (cell.y === 0) return cell.x;
  return 100_000 + (cell.x < legSplit ? 0 : 10_000) + cell.y * 100 + cell.x;
}

const ordered = [...piCells].sort((a, b) => strokeKey(a) - strokeKey(b));

export function PiWriteMark({ className }: { className?: string }) {
  return (
    <svg
      className={className === undefined ? "pi-write" : `pi-write ${className}`}
      viewBox="-0.5 -3 13 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {ordered.map((cell, index) => (
        <g key={`${cell.x}-${cell.y}`} style={{ "--pi-step": index / ordered.length } as CSSProperties}>
          {cellRects(cell).map(([x, y, width, height]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={width} height={height} fill={cell.color} />
          ))}
        </g>
      ))}
    </svg>
  );
}
