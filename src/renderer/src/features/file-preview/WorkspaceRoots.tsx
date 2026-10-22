// 文件页顶部的"工作区目录"行（spec §4.27）：任务目录 + 这个任务用 `/add-dir` 加进来的额外目录，点一个就把树换成它；
// "添加文件夹…"在主进程弹系统文件夹选择框，再由 omp 执行 `/add-dir`；× 移除（`/remove-dir`，不删文件夹）。
// 列表来自 `TaskState.workspaceDirs`（omp 的输出），这里只用下标选根，从不把绝对路径传回主进程。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Folder, Plus } from "../../icons.tsx";
import { parseDirsOutput } from "../../../../shared/omp-output/dirs.ts";
import { pushToast } from "../dialogs/index.ts";
import { Button, IconButton } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { baseName } from "./PreviewContent.tsx";
import { selectRootWhenListed } from "./roots-store.ts";

interface WorkspaceRootsProps {
  taskId: TaskId;
  /** 任务自己的工作目录，只用于提示文字。 */
  cwd: string;
  dirs: readonly string[];
  root: number;
  onSelect(root: number): void;
}

export function WorkspaceRoots({ taskId, cwd, dirs, root, onSelect }: WorkspaceRootsProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const add = () => {
    setBusy(true);
    window.studio
      .addWorkspaceDir(taskId)
      .then((result) => {
        if (result === null) return;
        const parsed = parseDirsOutput(result.text);
        if (parsed.kind !== "dirs" || parsed.notice?.kind !== "added") return;
        const at = parsed.dirs.indexOf(parsed.notice.path);
        if (at >= 0) selectRootWhenListed(taskId, at + 1);
        pushToast({ level: "info", message: t("preview.dirAdded", { name: baseName(parsed.notice.path) }) });
      })
      .catch((error: unknown) => reportError(t, error))
      .finally(() => setBusy(false));
  };

  const remove = (index: number) => {
    const name = baseName(dirs[index - 1] ?? "");
    setBusy(true);
    window.studio
      .removeWorkspaceDir(taskId, index)
      .then(() => {
        if (root === index) onSelect(0);
        else if (root > index) onSelect(root - 1);
        pushToast({ level: "info", message: t("preview.dirRemoved", { name }) });
      })
      .catch((error: unknown) => reportError(t, error))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="file-preview-roots"
      role="group"
      aria-label={t("preview.rootsLabel")}
      data-testid="workspace-roots"
      title={dirs.length > 0 ? t("preview.dirsNote") : undefined}
    >
      {dirs.length > 0 && (
        <button
          type="button"
          className="file-preview-root"
          aria-pressed={root === 0}
          data-testid="workspace-root-0"
          title={t("preview.rootCwdTitle", { path: cwd })}
          onClick={() => onSelect(0)}
        >
          <Folder size={12} />
          <span>{t("preview.rootCwd")}</span>
        </button>
      )}
      {dirs.map((dir, offset) => {
        const index = offset + 1;
        const name = baseName(dir);
        return (
          <span key={dir} className="file-preview-root-group">
            <button
              type="button"
              className="file-preview-root"
              aria-pressed={root === index}
              data-testid={`workspace-root-${index}`}
              title={dir}
              onClick={() => onSelect(index)}
            >
              <Folder size={12} />
              <span>{name}</span>
            </button>
            <IconButton
              label={t("preview.removeDir", { name })}
              tip={t("preview.removeDirTitle", { path: dir })}
              className="file-preview-root-remove"
              disabled={busy}
              testId={`workspace-root-remove-${index}`}
              onClick={() => remove(index)}
            >
              <Close size={10} />
            </IconButton>
          </span>
        );
      })}
      <Button
        variant="quiet"
        size="sm"
        icon={<Plus size={12} />}
        disabled={busy}
        testId="workspace-add-dir"
        title={t("preview.addDirTitle")}
        onClick={add}
      >
        {t("preview.addDir")}
      </Button>
    </div>
  );
}
