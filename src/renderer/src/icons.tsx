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

export const ChevronRight = (props: IconProps) => <Icon {...props}><path d="M6 3.5 10.5 8 6 12.5" /></Icon>;
export const ChevronDown = (props: IconProps) => <Icon {...props}><path d="M3.5 6 8 10.5 12.5 6" /></Icon>;
export const Check = (props: IconProps) => <Icon {...props}><path d="m3.5 8.5 3 3 6-7" /></Icon>;
export const CopyIcon = (props: IconProps) => <Icon {...props}><rect x="5.5" y="5.5" width="7" height="8" rx="1.5" /><path d="M10.5 3.5v-.2a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v7.2a1 1 0 0 0 1 1h.2" /></Icon>;
export const Close = (props: IconProps) => <Icon {...props}><path d="m4 4 8 8M12 4l-8 8" /></Icon>;
export const Plus = (props: IconProps) => <Icon {...props}><path d="M8 3.5v9M3.5 8h9" /></Icon>;
export const ArrowUp = (props: IconProps) => <Icon {...props}><path d="M8 13V3.5M4 7.5l4-4 4 4" /></Icon>;
export const Shield = (props: IconProps) => <Icon {...props}><path d="M8 2 3.5 3.8v3.6c0 3 2 5 4.5 6.1 2.5-1.1 4.5-3.1 4.5-6.1V3.8L8 2Z" /></Icon>;
export const Dots = (props: IconProps) => <Icon {...props}><circle cx="3.5" cy="8" r=".6" /><circle cx="8" cy="8" r=".6" /><circle cx="12.5" cy="8" r=".6" /></Icon>;
export const FileIcon = (props: IconProps) => <Icon {...props}><path d="M4.5 2.500h4l3 3v8h-7v-11Z" /><path d="M8.5 2.500v3h3" /></Icon>;
export const Terminal = (props: IconProps) => <Icon {...props}><path d="m3 4.5 3.5 3.5L3 11.500M8 12h5" /></Icon>;
export const Search = (props: IconProps) => <Icon {...props}><circle cx="7" cy="7" r="4" /><path d="m10 10 3.5 3.5" /></Icon>;
export const Pencil = (props: IconProps) => <Icon {...props}><path d="m3 13 .8-3L10.5 3.3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L6 12.2 3 13Z" /></Icon>;
export const Gear = (props: IconProps) => <Icon {...props}><circle cx="8" cy="8" r="2" /><path d="M8 2v1.500M8 12.5V14M2 8h1.500M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1" /></Icon>;
