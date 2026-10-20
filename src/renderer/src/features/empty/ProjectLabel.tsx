// 草稿工具行里审批胶囊右边的项目标签：文件夹图标 + 项目名，只是告诉你这个新任务会在哪个文件夹里运行，不能点；
// 悬停看完整路径。默认文件夹（AppInfo.chatsDir）写"默认文件夹"，不露出 chats 这个目录名。
// 换文件夹走侧栏：新任务 = 默认文件夹，项目分组旁的 ＋ = 在那个项目里，打开文件夹 = 新的文件夹。
import type { Project } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Folder } from "../../icons.tsx";
import { useAppInfo } from "../../store/index.ts";
import { isDefaultFolder } from "./default-folder.ts";

/** project 为 null = 默认文件夹。 */
export function ProjectLabel({ project }: { project: Project | null }) {
  const t = useT();
  const chatsDir = useAppInfo()?.chatsDir ?? null;
  const isDefault = project === null || isDefaultFolder(project, chatsDir);
  const name = isDefault ? t("empty.defaultFolder") : project.name;
  const path = project?.path ?? chatsDir ?? "";
  return (
    <span className="empty-project" data-testid="empty-project" title={path}>
      <Folder size={14} />
      <span className="empty-project-name">{name}</span>
    </span>
  );
}
