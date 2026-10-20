// 界面里用到的少量线性图标：16 或 14px，stroke 取 currentColor，粗细跟 --icon-stroke。
import type { SVGProps } from "react";

function Icon({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="var(--icon-stroke)"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export const ChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Icon>
);
export const ChevronDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 6 8 10.5 12.5 6" />
  </Icon>
);
export const Check = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);
export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5.5" y="5.5" width="7" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.2a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v7.2a1 1 0 0 0 1 1h.2" />
  </Icon>
);
export const Close = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);
export const Plus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);
export const ArrowUp = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 13V3.5M4 7.5l4-4 4 4" />
  </Icon>
);
export const Shield = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2 3.5 3.8v3.6c0 3 2 5 4.5 6.1 2.5-1.1 4.5-3.1 4.5-6.1V3.8L8 2Z" />
  </Icon>
);
export const Dots = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="3.5" cy="8" r=".6" />
    <circle cx="8" cy="8" r=".6" />
    <circle cx="12.5" cy="8" r=".6" />
  </Icon>
);
export const FileIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 2.500h4l3 3v8h-7v-11Z" />
    <path d="M8.5 2.500v3h3" />
  </Icon>
);
export const Terminal = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3 4.5 3.5 3.5L3 11.500M8 12h5" />
  </Icon>
);
export const Restart = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M12.500 2v3h-3" />
  </Icon>
);
export const Search = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3.5 3.5" />
  </Icon>
);
export const Pencil = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3 13 .8-3L10.5 3.3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L6 12.2 3 13Z" />
  </Icon>
);
export const Branch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.500-3 2.500-7 4" />
  </Icon>
);
/** 评审：一页纸上的 ± */
export const Diff = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 2.5h5.5l3 3v8H4z" />
    <path d="M8.25 6.25v3.5M6.5 8h3.5M6.5 11.5h3.5" />
  </Icon>
);
export const Folder = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Icon>
);
