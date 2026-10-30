// 等 omp 返回的列表用的骨架占位（样式在 controls.css 的 .ui-skeleton*）：与最终行同高的灰条，扫光受 --play-state 控制。
// 数据到了换成真实列表，真实列表的容器加 className="ui-data-in" 淡入（--dur-fast）。
// variant："row" 是分隔线列表的行（48 高，插件行等）；"card" 是 .ui-cards 里的两行卡片（74 高）。label 给读屏用（原来的"正在读取…"文字）。

import type { CSSProperties } from "react";

export function Skeleton({
  variant,
  count = 3,
  height,
  label,
  testId,
}: {
  variant: "row" | "card";
  count?: number | undefined;
  /** 行 / 卡片高度（CSS 长度），默认 row 48、card 64；要和真实行一样高。 */
  height?: string | undefined;
  label: string;
  testId?: string | undefined;
}) {
  const items = Array.from({ length: count }, (_, index) => (
    <div key={index} className={variant === "card" ? "ui-skeleton-card" : "ui-skeleton-row"} aria-hidden="true">
      <span className="ui-skeleton" data-shape="icon" />
      <span className="ui-skeleton-lines">
        <span className="ui-skeleton" data-width="long" />
        <span className="ui-skeleton" data-width="short" />
      </span>
    </div>
  ));
  return (
    <div
      className={variant === "card" ? "ui-cards" : "ui-skeleton-list"}
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid={testId ?? "skeleton"}
      style={height === undefined ? undefined : ({ "--skeleton-h": height } as CSSProperties)}
    >
      {items}
    </div>
  );
}
