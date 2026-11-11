// 运行状态槽（工具卡、工具组标题行、bash 卡片脚）：运行中是一段转着的弧（底下一圈淡环），跑完弧形变成结果图标（✓ / × …，spec §2.6"图标形变"）。
// 转圈靠外层盒子的 CSS 旋转（controls.css 的 .run-glyph）；跑完时摘掉旋转，弧回到起始角度（顶上）再变形。
// 只有这次挂载时见过"运行中"的槽才挂这个组件（useRanHere）：一挂上就已经跑完的（历史、切任务、重挂载）由调用方画静态图标，
// 长对话里成百张卡片不各带一个形变实例，同时跑完的一批卡片也只有它们自己在变。
import { useState } from "react";
import { MorphIcon, type MorphGlyph } from "./MorphIcon.tsx";
import { RUN_ARC_GLYPH, RUN_TRACK_R } from "./morph-glyphs.ts";

/** 这次挂载里是否出现过 running（之后一直是 true）。 */
export function useRanHere(running: boolean): boolean {
  const [ran, setRan] = useState(running);
  if (running && !ran) setRan(true);
  return ran;
}

export function RunGlyph({
  running,
  result,
  size,
  className,
  testId,
}: {
  running: boolean;
  /** 跑完后的图标。 */
  result: MorphGlyph;
  size: number;
  className?: string | undefined;
  testId?: string | undefined;
}) {
  return (
    <span
      className={className === undefined ? "run-glyph" : `run-glyph ${className}`}
      data-running={running || undefined}
      data-testid={testId}
      aria-hidden="true"
    >
      {running && (
        <svg className="run-glyph-track" width={size} height={size} viewBox="0 0 16 16" focusable="false">
          <circle cx="8" cy="8" r={RUN_TRACK_R} />
        </svg>
      )}
      <MorphIcon glyph={running ? RUN_ARC_GLYPH : result} size={size} />
    </span>
  );
}
