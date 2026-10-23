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
export const ChevronLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
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
/** 源码：尖括号 */
export const Code = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
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
/** 询问并记住：盾牌里一个勾 */
export const ShieldCheck = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2 3.5 3.8v3.6c0 3 2 5 4.5 6.1 2.5-1.1 4.5-3.1 4.5-6.1V3.8L8 2Z" />
    <path d="m5.8 8 1.6 1.6L10.300 6.500" />
  </Icon>
);
/** 全自动：划掉的盾牌（不再询问）；斜线穿过的两处轮廓断开，14px 下不糊成一团 */
export const ShieldOff = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 6v1.4c0 3 2 5 4.5 6.1.55-.24 1.1-.53 1.6-.87" />
    <path d="M6 2.8 8 2l4.5 1.8v3.6c0 .6-.07 1.15-.2 1.65" />
    <path d="m2.5 2.5 11 11" />
  </Icon>
);
/** 后台任务：闪电 */
export const Bolt = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 2 3.500 9H8l-1 5 5.500-7H8L9 2Z" />
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
/** 子代理：两个人 */
export const Users = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="6" cy="5.500" r="2" />
    <path d="M2.500 13c0-2 1.500-3.500 3.500-3.500s3.500 1.500 3.500 3.500" />
    <circle cx="11.500" cy="6" r="1.600" />
    <path d="M11 9.600c1.900 0 3 1.300 3 3.400" />
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
/** 会话开关：两根推杆 */
export const Sliders = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 5h5.8M11.7 5h1.8M2.5 11h2M7.5 11h6" />
    <circle cx="10" cy="5" r="1.7" />
    <circle cx="6" cy="11" r="1.7" />
  </Icon>
);
/** ⓘ 说明 */
export const Info = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v3.6" />
    <circle cx="8" cy="5" r=".4" />
  </Icon>
);
/** 恢复默认：逆时针 ↺（"刷新"用 Restart ↻） */
export const Reset = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3.5 2v3h3" />
  </Icon>
);
/** 在系统浏览器 / 外部程序里打开 */
export const External = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 3H13v3.5M13 3 7.5 8.5M11 9.5V13H3V5h3.5" />
  </Icon>
);
export const Trash = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
);
/** 折行：一行文字绕回下一行 */
export const Wrap = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 4h11M2.5 12h4M2.5 8h8.5a2 2 0 0 1 0 4H9.5" />
    <path d="m11 10.500-1.500 1.500 1.500 1.500" />
  </Icon>
);
/** 评论：对话气泡 */
export const Comment = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 3.500h10v7H8.500L5.500 13v-2.500H3v-7Z" />
  </Icon>
);
/** 模型角色 default：星 */
export const Star = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2.5 9.7 6l3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6L6.3 6 8 2.5Z" />
  </Icon>
);
/** 模型角色 slow（深度思考）：沙漏 */
export const Hourglass = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 2.5h7M4.5 13.5h7M5.5 2.5c0 3 2.5 3.5 2.5 5.5s-2.5 2.5-2.5 5.5M10.5 2.5c0 3-2.5 3.5-2.5 5.5s2.5 2.5 2.5 5.5" />
  </Icon>
);
/** 模型角色 plan（规划）：折页地图 */
export const MapIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 4.3 6 3l4 1.5 3.5-1.3v8.5L10 13l-4-1.5-3.5 1.3V4.3ZM6 3v8.5M10 4.5V13" />
  </Icon>
);
/** 模型角色 commit：一个提交节点 */
export const Commit = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M2 8h3.5M10.5 8H14" />
  </Icon>
);
/** 模型角色 advisor（顾问）：灯泡 */
export const Bulb = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.2 13.5h3.6M8 2.5a3.5 3.5 0 0 0-2.1 6.3c.4.3.6.8.6 1.3v1.4h3v-1.4c0-.5.2-1 .6-1.3A3.5 3.5 0 0 0 8 2.5Z" />
  </Icon>
);
/** 自定义的模型角色：标签 */
export const Tag = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 3.5v4l6 6 5-5-6-6h-4a1 1 0 0 0-1 1Z" />
    <circle cx="5.5" cy="5.5" r=".75" />
  </Icon>
);
/** 生成（提交信息）：四角星 */
export const Sparkle = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 2.5 8.300 6 11.800 7.200 8.300 8.500 7 12 5.700 8.500 2.200 7.200 5.700 6 7 2.500ZM12.200 10.500l.5 1.300 1.300.5-1.300.5-.5 1.300-.5-1.300-1.300-.5 1.300-.5.5-1.300Z" />
  </Icon>
);
/** 忽略空白：行尾带空格标记的折线 */
export const Whitespace = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.500 4.500h11M2.500 8h5M2.500 11.500h11M10 8h3.500M11.500 6.500l2 1.500-2 1.500" />
  </Icon>
);
