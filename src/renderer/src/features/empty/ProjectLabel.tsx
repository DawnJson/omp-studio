// 文件夹标签：文件夹图标 + 上级文件夹\当前文件夹，告诉你任务（或新任务）在哪个文件夹里运行。
// 在输入框下方状态行的位置胶囊里（features/git 的 TaskPlace / DraftPlace；不是 git 仓库时单独出现，不能点）。
// 只写最后两级（仓库所有者定，2026-11-21），悬停看完整路径；两级也放不下时省略开头，留住当前文件夹名。
// 换文件夹走侧栏：新任务 = 默认文件夹，项目分组旁的 ＋ = 在那个项目里，打开文件夹 = 新的文件夹。
import { Folder } from "../../icons.tsx";
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
