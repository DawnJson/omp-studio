// 会形变的图标（ui/MorphIcon.tsx）：模块加载时从 src/icons.tsx 的几何换算一次，各处共用同一个对象（morphicons 按对象缓存采样和配对）。
import type { IconNode } from "morphicons";
import {
  ARROW_UP_NODE,
  CHECK_NODE,
  CLOSE_NODE,
  COPY_NODE,
  EYE_NODE,
  EYE_OFF_NODE,
  PENCIL_NODE,
  RESTART_NODE,
  SHIELD_CHECK_NODE,
  SHIELD_NODE,
  SHIELD_OFF_NODE,
  SPARKLE_NODE,
} from "../icons.tsx";
import { PATHS } from "../features/tsp/icon-names.ts";
import { glyph16, glyph24 } from "./MorphIcon.tsx";

export const ARROW_UP_GLYPH = glyph16(ARROW_UP_NODE);
export const CHECK_GLYPH = glyph16(CHECK_NODE);
export const CLOSE_GLYPH = glyph16(CLOSE_NODE);
export const COPY_GLYPH = glyph16(COPY_NODE);
export const EYE_GLYPH = glyph16(EYE_NODE);
export const EYE_OFF_GLYPH = glyph16(EYE_OFF_NODE);
export const PENCIL_GLYPH = glyph16(PENCIL_NODE);
export const RESTART_GLYPH = glyph16(RESTART_NODE);
export const SHIELD_GLYPH = glyph16(SHIELD_NODE);
export const SHIELD_CHECK_GLYPH = glyph16(SHIELD_CHECK_NODE);
export const SHIELD_OFF_GLYPH = glyph16(SHIELD_OFF_NODE);
export const SPARKLE_GLYPH = glyph16(SPARKLE_NODE);
/** 停止 ■：16px 图标框里 12px 的实心圆角方块（圆角 --radius-xs 3px），按 16 栅格的描边比例写在 24 栅格上。 */
export const STOP_GLYPH = glyph24(
  [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 4.5, fill: "currentColor" }]],
  24 / 16,
);

/** 运行中转圈的那段弧（ui/RunGlyph.tsx）：圆心 (8, 8)、半径 5.5 的上四分之一，和底下的淡圈（RUN_TRACK_R）同心同径。 */
export const RUN_TRACK_R = 5.5;
export const RUN_ARC_GLYPH = glyph16([["path", { d: "M4.11 4.11a5.5 5.5 0 0 1 7.78 0" }]]);

/** 过程区（TSP）的命名图标（features/tsp/icon-names.ts 的 PATHS），和同名的静态 TspIcon 同一份几何。 */
function tspGlyph(name: string) {
  const node: IconNode = (PATHS[name] ?? []).map((d) => ["path", { d }]);
  return glyph16(node);
}
export const TSP_COPY_GLYPH = tspGlyph("copy");
export const TSP_X_CIRCLE_GLYPH = tspGlyph("x-circle");
export const TSP_SLASH_CIRCLE_GLYPH = tspGlyph("slash-circle");
