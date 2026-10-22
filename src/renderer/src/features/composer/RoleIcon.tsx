// 模型角色的图标（模型选择对话框的角色行、模型行上的角色标记、参数行、顶栏的"为 X 选模型"）。omp 内置角色各一个，
// 其它角色（modelRoles 里自定义的）用标签。名字在调用方的悬停提示 / 文字里。
import type { ComponentType, SVGProps } from "react";
import { Bolt, Bulb, Commit, Hourglass, MapIcon, Star, Tag, Users } from "../../icons.tsx";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const icons: Readonly<Record<string, IconComponent>> = {
  default: Star,
  smol: Bolt,
  slow: Hourglass,
  plan: MapIcon,
  task: Users,
  commit: Commit,
  advisor: Bulb,
};

export function RoleIcon({ role, size = 14 }: { role: string; size?: number }) {
  const Icon = icons[role] ?? Tag;
  return <Icon size={size} />;
}
