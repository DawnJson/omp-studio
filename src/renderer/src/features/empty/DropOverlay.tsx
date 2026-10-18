// 拖入文件夹时的全窗口覆盖（spec §4.16）。路径由 preload 取走交给主进程；这里只管视觉和把默认行为拦掉
// （不拦的话 Chromium 会尝试导航到被拖入的文件）。主进程加入项目后发 projectDropped，空状态据此切换项目。
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { clearSelection, showView } from "../../store/index.ts";
import { refreshProjects } from "../sidebar/projects-store.ts";
import { pickDraftProject } from "./draft-project.ts";

/** 拖动中只能看到 kind 和 type：文件夹的 type 是空串；全是图片则交给输入框自己的覆盖层。 */
function carriesFolder(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  return [...transfer.items].some((item) => item.kind === "file" && item.type === "");
}

export function DropOverlay() {
  const t = useT();
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      depth.current += 1;
      if (carriesFolder(event.dataTransfer)) setActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      depth.current = 0;
      setActive(false);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    const unsubscribe = window.studio.onProjectDropped((project) => {
      void refreshProjects();
      clearSelection();
      showView("conversation");
      pickDraftProject(project.id);
    });
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      unsubscribe();
    };
  }, []);

  if (!active) return null;
  return (
    <div className="drop-overlay" data-testid="drop-overlay" role="presentation">
      <span className="drop-overlay-label">{t("dropzone.folder")}</span>
    </div>
  );
}
