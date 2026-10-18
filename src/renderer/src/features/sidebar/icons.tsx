// 侧栏和命令面板用的线性图标：16×16 视口，描边 1.5，颜色跟随 currentColor。没有图标库依赖。
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="m6 4 4 4-4 4" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="3.5" cy="8" r="0.5" fill="currentColor" />
    <circle cx="8" cy="8" r="0.5" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.5" fill="currentColor" />
  </Icon>
);

export const FolderPlusIcon = () => (
  <Icon>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
    <path d="M8 7v3.5M6.25 8.75h3.5" />
  </Icon>
);

// 带齿的齿轮：8 个梯形齿 + 中心圆孔。之前的"圆加 8 条短线"看起来像太阳。
export const GearIcon = () => (
  <Icon>
    <path d="M6.83 3.14 7.12 1.46h1.76l.29 1.68 1.44.6 1.39-.99 1.25 1.25-.99 1.39.6 1.44 1.68.29v1.76l-1.68.29-.6 1.44.99 1.39-1.25 1.25-1.39-.99-1.44.6-.29 1.68H7.12l-.29-1.68-1.44-.6-1.39.99-1.25-1.25.99-1.39-.6-1.44-1.68-.29V7.12l1.68-.29.6-1.44-.99-1.39 1.25-1.25 1.39.99z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3.5 3.5" />
  </Icon>
);

export const TaskIcon = () => (
  <Icon>
    <path d="M3 4.5h10M3 8h10M3 11.5h6" />
  </Icon>
);

export const SessionIcon = () => (
  <Icon>
    <path d="M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM8 5.5V8l1.75 1.25" />
  </Icon>
);

export const CommandIcon = () => (
  <Icon>
    <path d="m4 5 3 3-3 3M8.5 11.5H12" />
  </Icon>
);

export const SlashIcon = () => (
  <Icon>
    <path d="m10.5 3-5 10" />
  </Icon>
);
