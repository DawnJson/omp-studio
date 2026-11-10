// 顶栏的切换侧栏图标（不引图标库）。24 栅格，描边 --icon-stroke，颜色跟随 currentColor。
import { glyph24, MorphIcon } from "../ui/MorphIcon.tsx";

const SIDEBAR_FRAME = ["rect", { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5 }] as const;
/** 侧栏显示着：窗框左边一栏。 */
const SIDEBAR_SHOWN = glyph24([SIDEBAR_FRAME, ["path", { d: "M9.5 4.5v15" }]]);
/** 侧栏收起：分隔线并进窗框左边（落在两个圆角之间的直边上，看不出来），只剩一个窗框。 */
const SIDEBAR_HIDDEN = glyph24([SIDEBAR_FRAME, ["path", { d: "M3.5 7v10" }]]);

/** 切换侧栏：显示 ↔ 收起时分隔线滑过去，像侧栏本身收进左边（ui/MorphIcon.tsx 形变）。 */
export function SidebarIcon({ size = 16, shown }: { size?: number; shown: boolean }) {
  return <MorphIcon glyph={shown ? SIDEBAR_SHOWN : SIDEBAR_HIDDEN} size={size} />;
}
