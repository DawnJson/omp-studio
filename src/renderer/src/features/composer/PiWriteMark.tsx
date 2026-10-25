// 状态行最左边"正在思考"的图标：标志里的像素 π（shared/ui/pixel-pi.ts）按笔画顺序一格格亮起（先横、再左腿、再右腿），
// 写满停一下，再按同样顺序褪掉，循环（2026-10-24 仓库所有者从六个候选里选定，代替原来的立体点阵球）。
// 动画全在 CSS（composer.css 的 .pi-write）：每格同一段 keyframes，按笔画序号错开起点；keyframes 的 0% 帧是"亮着"，
// 减少动效（--play-state: paused）时停在 0% 帧，就是一个完整的静态 π。
// 每格是一个 HTML 元素而不是 SVG 里的 <g>：HTML 元素的 opacity 动画交给合成器，SVG 内部元素的动画每帧都要在主线程重算样式（2026-10-25 实测）。
import type { CSSProperties } from "react";
import { piCells, type PiCell } from "../../../../shared/ui/pixel-pi.ts";

/** π 竖着的两条腿以第 6 列为界：左腿在 3–4 列，右腿在 7–8 列。 */
const legSplit = 6;
/** 画布（像素）：π 12×10 放在 13×16 的框里，四周留白和原来的 SVG viewBox（-0.5 -3 13 16）一样。 */
const box = { x: -0.5, y: -3, width: 13, height: 16 } as const;

/** 笔画顺序的排序键：横从左到右，然后左腿、右腿各自从上到下（同一行先左后右）。 */
function strokeKey(cell: PiCell): number {
  if (cell.y === 0) return cell.x;
  return 100_000 + (cell.x < legSplit ? 0 : 10_000) + cell.y * 100 + cell.x;
}

const ordered = [...piCells].sort((a, b) => strokeKey(a) - strokeKey(b));

const percent = (value: number) => `${value * 100}%`;

/** ▒ 是 1×2 格里的 4 个半像素（棋盘格），位置相对这一格。 */
const checker = [0, 0.5, 1, 1.5].map((dy) => ({ left: percent(dy % 1), top: percent(dy / 2) }));

export function PiWriteMark({ className }: { className?: string }) {
  return (
    <span className={className === undefined ? "pi-write" : `pi-write ${className}`} aria-hidden="true">
      <span className="pi-write-box">
        {ordered.map((cell, index) => {
          const style = {
            "--pi-step": index / ordered.length,
            left: percent((cell.x - box.x) / box.width),
            top: percent((cell.y - box.y) / box.height),
            width: percent(1 / box.width),
            height: percent(2 / box.height),
            background: cell.kind === "#" ? cell.color : undefined,
          } as CSSProperties;
          return (
            <span key={`${cell.x}-${cell.y}`} className="pi-cell" style={style}>
              {cell.kind === "%" &&
                checker.map((spot) => (
                  <span key={spot.top} className="pi-dot" style={{ ...spot, background: cell.color }} />
                ))}
            </span>
          );
        })}
      </span>
    </span>
  );
}
