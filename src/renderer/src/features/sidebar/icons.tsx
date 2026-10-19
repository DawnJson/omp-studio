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

// 以下是命令面板里各条命令的图标（按命令 id 对应，见 palette/command-icons.ts）。
export const SidebarToggleIcon = () => (
  <Icon>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="M6.5 3v10" />
  </Icon>
);

export const ThemeIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5" />
    <path d="M8 3v10" />
    <path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor" />
  </Icon>
);

export const LanguageIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c-2 2-2 9 0 11M8 2.5c2 2 2 9 0 11" />
  </Icon>
);

export const ModelIcon = () => (
  <Icon>
    <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
    <path d="M6.5 2.5v2M9.5 2.5v2M6.5 11.5v2M9.5 11.5v2M2.5 6.5h2M2.5 9.5h2M11.5 6.5h2M11.5 9.5h2" />
  </Icon>
);

export const ThinkingIcon = () => (
  <Icon>
    <path d="M5.5 11.5h5M6.5 13.5h3M8 2.5a4 4 0 0 0-2.4 7.2c.5.4.9 1 .9 1.8h3c0-.8.4-1.4.9-1.8A4 4 0 0 0 8 2.5z" />
  </Icon>
);

export const CompactIcon = () => (
  <Icon>
    <path d="M3 3.5h10M3 12.5h10M8 5.5v2M6.25 6.5 8 8.25 9.75 6.5M8 10.5v-2M6.25 9.5 8 7.75 9.75 9.5" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="7" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.2a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v7.2a1 1 0 0 0 1 1h.2" />
  </Icon>
);

export const ProcessIcon = () => (
  <Icon>
    <path d="M3 4.5h10M5.5 8h7.5M5.5 11.5h7.5M3 8h.01M3 11.5h.01" />
  </Icon>
);

export const ReviewIcon = () => (
  <Icon>
    <path d="M4 2.5h5.5l3 3v8H4z" />
    <path d="M8.25 6.25v3.5M6.5 8h3.5M6.5 11.5h3.5" />
  </Icon>
);

export const BellIcon = () => (
  <Icon>
    <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3" />
  </Icon>
);

export const UsageIcon = () => (
  <Icon>
    <path d="M3 13V8.5M7 13V3.5M11 13V6M14 13H2" />
  </Icon>
);

export const RefreshIcon = () => (
  <Icon>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M12.5 2v3h-3" />
  </Icon>
);

export const KeyboardIcon = () => (
  <Icon>
    <rect x="2" y="4.5" width="12" height="7" rx="1.5" />
    <path d="M5 7.5h.01M8 7.5h.01M11 7.5h.01M5.5 9.5h5" />
  </Icon>
);

export const ArchiveIcon = () => (
  <Icon>
    <rect x="2.5" y="3" width="11" height="3" rx="1" />
    <path d="M3.5 6v6.5h9V6M6.5 9h3" />
  </Icon>
);

export const TreeIcon = () => (
  <Icon>
    <circle cx="4.5" cy="3.5" r="1.25" />
    <circle cx="4.5" cy="12.5" r="1.25" />
    <circle cx="11.5" cy="8" r="1.25" />
    <path d="M4.5 4.75v6.5M4.5 8h5.75" />
  </Icon>
);

export const ExportIcon = () => (
  <Icon>
    <path d="M8 2.5v7M5.5 4.75 8 2.25l2.5 2.5M3.5 9v3.5h9V9" />
  </Icon>
);

export const BtwIcon = () => (
  <Icon>
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v4a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V10h-.5A1.5 1.5 0 0 1 3 8.5z" />
  </Icon>
);
