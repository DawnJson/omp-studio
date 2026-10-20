// 草稿工具行里审批胶囊右边的项目标签：文件夹图标 + 文件夹路径，只是告诉你这个新任务会在哪个文件夹里运行，不能点。
// 默认文件夹（AppInfo.chatsDir）也直接写它的路径。路径太长时省略开头，留住末尾的文件夹名；悬停看完整路径。
// 换文件夹走侧栏：新任务 = 默认文件夹，项目分组旁的 ＋ = 在那个项目里，打开文件夹 = 新的文件夹。
import type { Project } from "../../../../shared/ipc.ts";
import { Folder } from "../../icons.tsx";
import { useAppInfo } from "../../store/index.ts";

/** 文件夹图标 + 路径（只显示）。 */
export function PathLabel({ path, testId = "empty-project" }: { path: string; testId?: string }) {
  return (
    <span className="empty-project" data-testid={testId} title={path}>
      <Folder size={14} />
      {/* 外层 rtl 让省略号落在开头，bdi 保持路径本身从左往右排 */}
      <span className="empty-project-name">
        <bdi>{path}</bdi>
      </span>
    </span>
  );
}

/** project 为 null = 默认文件夹。 */
export function ProjectLabel({ project }: { project: Project | null }) {
  const chatsDir = useAppInfo()?.chatsDir ?? null;
  return <PathLabel path={project?.path ?? chatsDir ?? ""} />;
}
