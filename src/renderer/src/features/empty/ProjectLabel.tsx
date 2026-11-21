// 输入框工具行里审批胶囊右边的文件夹标签：文件夹图标 + 上级文件夹\当前文件夹，只是告诉你任务在哪个文件夹里运行，不能点。
// 草稿（新任务会在哪）和任务的输入框（Composer，任务的 cwd）都放。
// 只写最后两级（仓库所有者定，2026-11-21），悬停看完整路径；两级也放不下时省略开头，留住当前文件夹名。
// 换文件夹走侧栏：新任务 = 默认文件夹，项目分组旁的 ＋ = 在那个项目里，打开文件夹 = 新的文件夹。
import type { Project } from "../../../../shared/ipc.ts";
import { Folder } from "../../icons.tsx";
import { useAppInfo } from "../../store/index.ts";
import "./empty.css";

/** 路径的最后两级（上级文件夹 + 当前文件夹），分隔符照原路径：`E:\code\omp-studio` -> `code\omp-studio`；不到两级（`E:\`）原样。 */
function shortPath(path: string): string {
  return /[^\\/]+[\\/]+[^\\/]+(?=[\\/]*$)/.exec(path)?.[0] ?? path;
}

/** 文件夹图标 + 最后两级路径（只显示）；悬停提示完整路径。 */
export function PathLabel({ path, testId = "empty-project" }: { path: string; testId?: string }) {
  return (
    <span className="empty-project" data-testid={testId} title={path}>
      <Folder size={14} />
      {/* 外层 rtl 让省略号落在开头，bdi 保持路径本身从左往右排 */}
      <span className="empty-project-name">
        <bdi>{shortPath(path)}</bdi>
      </span>
    </span>
  );
}

/** project 为 null = 默认文件夹。 */
export function ProjectLabel({ project }: { project: Project | null }) {
  const chatsDir = useAppInfo()?.chatsDir ?? null;
  return <PathLabel path={project?.path ?? chatsDir ?? ""} />;
}
