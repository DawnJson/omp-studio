// 命令面板里每条命令的图标（按命令 id 对应）；没登记的命令回退到 CommandIcon。
import type { ComponentType } from "react";
import {
  ArchiveIcon,
  BellIcon,
  CommandIcon,
  CompactIcon,
  CopyIcon,
  FolderPlusIcon,
  GearIcon,
  KeyboardIcon,
  LanguageIcon,
  ModelIcon,
  PlusIcon,
  ProcessIcon,
  RefreshIcon,
  ReviewIcon,
  SidebarToggleIcon,
  StopIcon,
  ThemeIcon,
  ThinkingIcon,
  UsageIcon,
  TreeIcon,
  ExportIcon,
  BtwIcon,
} from "../sidebar/icons.tsx";

const commandIcons: Record<string, ComponentType> = {
  newTask: PlusIcon,
  newTaskHere: PlusIcon,
  openFolder: FolderPlusIcon,
  settings: GearIcon,
  toggleSidebar: SidebarToggleIcon,
  theme: ThemeIcon,
  language: LanguageIcon,
  model: ModelIcon,
  thinking: ThinkingIcon,
  compact: CompactIcon,
  stop: StopIcon,
  copyLast: CopyIcon,
  toggleProcess: ProcessIcon,
  review: ReviewIcon,
  toggleTerminal: CommandIcon,
  jumpWaiting: BellIcon,
  usage: UsageIcon,
  checkUpdate: RefreshIcon,
  shortcuts: KeyboardIcon,
  archive: ArchiveIcon,
  sessionTree: TreeIcon,
  exportHtml: ExportIcon,
  btw: BtwIcon,
};

export function commandIcon(id: string): ComponentType {
  return commandIcons[id] ?? CommandIcon;
}
