// 菜单用的内联 SVG 图标（不引图标库）。24 栅格，描边 --icon-stroke，颜色跟随 currentColor。
import type { ReactNode } from "react";

function Icon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="icon"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export interface IconProps {
  size?: number;
}

export function CheckIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

/** 切换侧栏：一个窗框，左边一栏；侧栏显示时左栏填满，收起时只剩分隔线（填充淡入淡出，见 app.css .sidebar-icon-fill）。 */
export function SidebarIcon({ size = 16, shown }: IconProps & { shown: boolean }) {
  return (
    <Icon size={size}>
      <rect
        className="sidebar-icon-fill"
        data-shown={shown}
        x="3.5"
        y="4.5"
        width="6"
        height="15"
        rx="2.5"
        fill="currentColor"
        stroke="none"
      />
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </Icon>
  );
}

/** 关于与反馈：圆圈里一个感叹号。 */
export function InfoIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5v.01" />
    </Icon>
  );
}
