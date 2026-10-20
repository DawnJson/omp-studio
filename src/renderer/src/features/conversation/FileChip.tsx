// 文件胶囊（Tern 的 Read / Glob / Grep）：文件图标 + 淡色目录 + 正常色文件名，等宽，点击打开右侧文件预览。
import type { ReactNode } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { FileIcon } from "../../icons.tsx";
import { openFilePreview } from "../file-preview/index.ts";
import { splitPath } from "./tool-view.ts";

export function FileChip({ taskId, path, children }: { taskId: TaskId; path: string; children?: ReactNode }) {
  const [dir, name] = splitPath(path);
  return (
    <button
      type="button"
      className="file-chip"
      data-testid="file-link"
      title={path}
      onClick={() => openFilePreview(taskId, path)}
    >
      <FileIcon size={12} />
      <span className="file-chip-path">
        {dir !== "" && <span className="file-chip-dir">{dir}</span>}
        <span className="file-chip-name">{name}</span>
      </span>
      {children}
    </button>
  );
}
