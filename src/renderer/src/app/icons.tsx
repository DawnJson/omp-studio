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
