// 新任务页标题左边的像素 π（只有 π，不带 "omp studio" 字标）：装饰，读屏跳过，标题自己说明这一页。
// 高度 36px 不是 π 像素的整数倍，所以不用 crispEdges（半像素的 ▒ 会被取整得忽粗忽细），让浏览器正常抗锯齿。
import { markHeight, markWidth } from "../../../../shared/ui/pixel-pi.ts";
import { PiMark } from "../../ui/PiMark.tsx";

const HEIGHT = 36;

export function EmptyMark() {
  return (
    <svg
      className="empty-mark"
      width={(HEIGHT * markWidth) / markHeight}
      height={HEIGHT}
      viewBox={`0 0 ${markWidth} ${markHeight}`}
      aria-hidden="true"
      data-testid="empty-mark"
    >
      <PiMark />
    </svg>
  );
}
