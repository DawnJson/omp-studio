// 按几种可能的内容里最大的那个占位：对话框里切换选项（分段、下拉、开关）时只换内容，外框大小不变。
// 所有候选叠在同一个网格格子里，格子按最大的那个撑开；`ghosts` 只用来量尺寸：不可见、不可交互、读屏读不到，
// 所以里面不要放 testId（会和真正显示的那份重名）。
import type { ReactNode } from "react";

interface ReserveProps {
  /** 现在显示的内容。 */
  children: ReactNode;
  /** 其余可能出现的内容（不带 testId 的样子），只占位。 */
  ghosts: readonly ReactNode[];
  className?: string | undefined;
}

export function Reserve({ children, ghosts, className }: ReserveProps) {
  return (
    <div className={className === undefined ? "ui-reserve" : `ui-reserve ${className}`}>
      {ghosts.map((ghost, index) => (
        <div key={index} className="ui-reserve-ghost" aria-hidden="true" inert>
          {ghost}
        </div>
      ))}
      <div className="ui-reserve-now">{children}</div>
    </div>
  );
}
