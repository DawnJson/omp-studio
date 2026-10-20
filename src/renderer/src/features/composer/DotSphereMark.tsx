// 状态行最左边"正在思考"的图标：立体点阵球像魔方一样一层层拧（模型见 dot-sphere.ts）。
// 每帧直接改 <circle> 的属性，不经过 React 渲染。减少动效（--play-state: paused）时停在当前一帧。
import { useEffect, useRef } from "react";
import { DotSphere, dotCount } from "./dot-sphere.ts";

/** 多久重读一次 --play-state（毫秒）：设置里切换"减少动效"时跟上，不必每帧读样式。 */
const motionCheckMs = 500;
/** 一帧最多前进多少毫秒：窗口在后台时 rAF 停了，回来时不一下子跳过好几次转动。 */
const maxStepMs = 50;

export function DotSphereMark({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (svg === null) return;
    const circles = [...svg.querySelectorAll("circle")];
    const sphere = new DotSphere();
    let clock = 0;
    let last: number | null = null;
    let paused = false;
    let checkedAt = -Infinity;
    let frame = 0;

    const draw = () => {
      sphere.frame(clock).forEach((dot, index) => {
        const circle = circles[index];
        if (circle === undefined) return;
        circle.setAttribute("cx", dot.x.toFixed(2));
        circle.setAttribute("cy", dot.y.toFixed(2));
        circle.setAttribute("r", dot.r.toFixed(2));
        circle.setAttribute("opacity", dot.opacity.toFixed(2));
      });
    };
    const tick = (now: number) => {
      if (now - checkedAt >= motionCheckMs) {
        paused = getComputedStyle(svg).getPropertyValue("--play-state").trim() === "paused";
        checkedAt = now;
      }
      if (!paused) {
        clock += Math.min(maxStepMs, last === null ? 0 : now - last);
        draw();
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    draw();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg ref={ref} className={className} viewBox="0 0 16 16" aria-hidden="true">
      {Array.from({ length: dotCount }, (_, index) => (
        <circle key={index} />
      ))}
    </svg>
  );
}
