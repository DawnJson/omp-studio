// 图标形变（morphicons，spec §2.6 动效表"图标形变"）：同一个 <svg><path> 从一个图标按弹簧变成另一个，
// 用在发送 ↔ 停止、复制 → 勾、优化 ✦ ↔ 停止、浏览器刷新 ↔ 停止、切换侧栏。
// 所有形变共用 morphicons 的一个 requestAnimationFrame 循环，没有在变的图标就不排帧；静止时就是一个普通的 <path>。
// 减少动效（系统或设置里的开关）时直接换成目标图标。
import type { CSSProperties } from "react";
import { fitIcon, type IconInput, type IconNode } from "morphicons";
import { setRegionLoader } from "morphicons/dom";
import { MorphIcon as Morph } from "morphicons/react";
import * as region from "morphicons/region";
import { useReducedMotion } from "../features/tsp/use-clock.ts";

// 有实心图标（停止 ■）的形变要把描边换算成面：这段代码直接打进包里，不在第一次形变时再去加载。
setRegionLoader(async () => region);

/** 形变用的图标数据：几何在 morphicons 的 24 栅格上，描边粗细按 --icon-stroke 的倍数，画出来和同尺寸的静态图标一样粗。 */
export interface MorphGlyph {
  readonly icon: IconInput;
  readonly strokeStyle: CSSProperties;
  /** 描边相对 --icon-stroke 的倍数（16 栅格放大到 24 是 1.5）。 */
  readonly strokeScale: number;
}

function makeGlyph(icon: IconInput, strokeScale: number): MorphGlyph {
  return { icon, strokeScale, strokeStyle: { strokeWidth: `calc(var(--icon-stroke) * ${strokeScale})` } };
}

/** 16 栅格的图标（src/icons.tsx 的 *_NODE）：模块加载时换算一次，不要在渲染里调。 */
export function glyph16(node: IconNode): MorphGlyph {
  return makeGlyph(fitIcon(node, 16), 24 / 16);
}

/** 本来就画在 24 栅格上的图标（app/icons.tsx），或手写在 24 栅格上的实心图标（fitIcon 只出描边的 d，会丢掉 fill）。 */
export function glyph24(node: IconNode, strokeScale = 1): MorphGlyph {
  return makeGlyph(node, strokeScale);
}

let iconStroke: number | undefined;
/** 描边换算成面时（实心图标参与的形变）morphicons 要一个数值：读一次 tokens.css 的 --icon-stroke。没有样式表（单测）时用库的默认值。 */
function regionStroke(scale: number): number | undefined {
  iconStroke ??= Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--icon-stroke"));
  return Number.isNaN(iconStroke) ? undefined : iconStroke * scale;
}

export function MorphIcon({ glyph, size = 16 }: { glyph: MorphGlyph; size?: number }) {
  const reduced = useReducedMotion();
  const stroke = regionStroke(glyph.strokeScale);
  return (
    <Morph
      icon={glyph.icon}
      size={size}
      {...(stroke === undefined ? {} : { strokeWidth: stroke })}
      style={glyph.strokeStyle}
      reducedMotion={reduced ? "always" : "user"}
      focusable="false"
    />
  );
}
