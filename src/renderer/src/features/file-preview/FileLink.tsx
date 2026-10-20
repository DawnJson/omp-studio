// 行内文件链接：显示文件名，点击在右侧面板预览（完整路径放 title）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { openFilePreview } from "./preview-store.ts";
import "./file-preview.css";

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

export function FileLink({ taskId, path }: { taskId: TaskId; path: string }) {
  return (
    <button
      type="button"
      className="file-link"
      data-testid="file-link"
      title={path}
      onClick={() => openFilePreview(taskId, path)}
    >
      {baseName(path)}
    </button>
  );
}
