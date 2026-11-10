// 会形变的图标（ui/MorphIcon.tsx）：模块加载时从 src/icons.tsx 的几何换算一次，各处共用同一个对象（morphicons 按对象缓存采样和配对）。
import { ARROW_UP_NODE, CHECK_NODE, CLOSE_NODE, COPY_NODE, RESTART_NODE, SPARKLE_NODE } from "../icons.tsx";
import { glyph16, glyph24 } from "./MorphIcon.tsx";

export const ARROW_UP_GLYPH = glyph16(ARROW_UP_NODE);
export const CHECK_GLYPH = glyph16(CHECK_NODE);
export const CLOSE_GLYPH = glyph16(CLOSE_NODE);
export const COPY_GLYPH = glyph16(COPY_NODE);
export const RESTART_GLYPH = glyph16(RESTART_NODE);
export const SPARKLE_GLYPH = glyph16(SPARKLE_NODE);
/** 停止 ■：16px 图标框里 12px 的实心圆角方块（圆角 --radius-xs 3px），按 16 栅格的描边比例写在 24 栅格上。 */
export const STOP_GLYPH = glyph24(
  [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 4.5, fill: "currentColor" }]],
  24 / 16,
);
