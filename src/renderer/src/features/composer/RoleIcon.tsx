// 模型角色的图标（模型选择对话框的角色行、模型行上的角色标记、参数行、顶栏的"为 X 选模型"）。常用的内置角色各一个；
// 其余内置角色（tiny、memory、widget、speech…）用一个中性的小圆点，自定义角色（modelRoles 里自己加的）用标签
// （2026-10-29 起：之前 vision / tiny / memory / widget 都落到标签上，看着像同一种角色）。名字在调用方的悬停提示 / 文字里。
import type { ComponentType, SVGProps } from "react";
import { Bolt, Bulb, Commit, Eye, Globe, Hourglass, MapIcon, RoleDot, Star, Tag, Users } from "../../icons.tsx";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const icons: Readonly<Record<string, IconComponent>> = {
  default: Star,
  smol: Bolt,
  slow: Hourglass,
  plan: MapIcon,
  task: Users,
  commit: Commit,
  advisor: Bulb,
  vision: Eye,
  web: Globe,
};

/** omp 内置、但没有专属图标的角色（同 model.role.hint.* 的键）。 */
const builtIn: Readonly<Record<string, true>> = {
  tiny: true,
  memory: true,
  widget: true,
  image: true,
  speech: true,
  dictation: true,
  judge: true,
};

export function RoleIcon({ role, size = 14 }: { role: string; size?: number }) {
  const Icon = icons[role] ?? (builtIn[role] ? RoleDot : Tag);
  return <Icon size={size} />;
}
