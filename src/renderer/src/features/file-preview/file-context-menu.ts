import type { MouseEvent } from "react";
import type { ProjectFilesTarget } from "../../../../shared/ipc.ts";
import { reportErrorNow } from "../../ui/errors.ts";

/** 系统菜单负责复制和定位文件；右键本身不打开预览。 */
export function showFileContextMenu(event: MouseEvent, target: ProjectFilesTarget, path: string): void {
  event.preventDefault();
  event.stopPropagation();
  window.studio.showFileContextMenu(target, path).catch(reportErrorNow);
}
