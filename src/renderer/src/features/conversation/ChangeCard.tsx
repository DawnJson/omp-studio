// 改动卡片（spec 4.12）：N 个文件已更改 +a −d；≤5 个文件默认展开，更多默认折叠；本轮完全结束后才出现。
// 数字来自工具事件的近似（tool-info.ts summarizeChanges），不是 git 的结果；文件行暂时不可点（没有"在资源管理器中显示"的契约）。
import { reportError } from "../../ui/errors.ts";
import { memo, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { ChevronDown, ChevronRight, Dots, FileIcon } from "../../icons.tsx";
import { Popover } from "../composer/Popover.tsx";
import { relativeToProject, type FileChange } from "./tool-info.ts";
import type { TaskId } from "../../../../shared/ipc.ts";

const VISIBLE = 5;

function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? { dir: "", name: normalized } : { dir: normalized.slice(0, slash + 1), name: normalized.slice(slash + 1) };
}

export const ChangeCard = memo(function ChangeCard({ changes, taskId, projectPath }: { changes: readonly FileChange[]; taskId: TaskId; projectPath: string | null }) {
  const t = useT();
  const [expanded, setExpanded] = useState(changes.length <= VISIBLE);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  if (changes.length === 0) return null;
  const report = (error: unknown) => reportError(t, error);
  const open = (path: string) => window.studio.openTaskFile(taskId, path).catch(report);
  const reveal = (path: string) => window.studio.revealTaskFile(taskId, path).catch(report);
  const known = changes.filter((change) => change.added !== null);
  const added = known.reduce((sum, change) => sum + (change.added ?? 0), 0);
  const removed = known.reduce((sum, change) => sum + (change.removed ?? 0), 0);

  return (
    <section className="change" data-anchor data-testid="change-card">
      <header className="change-head">
        <button type="button" className="change-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{t("change.summary", { count: changes.length })}</span>
          {known.length > 0 && (
            <>
              <span className="change-add">+{added}</span>
              <span className="change-del">−{removed}</span>
            </>
          )}
        </button>
        <div className="pop-anchor">
          <button type="button" className="tool-btn" aria-label={t("change.menu")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>
            <Dots size={16} />
          </button>
          <Popover open={menu} onClose={() => setMenu(false)} width={200} align="end" label={t("change.menu")}>
            <button
              type="button"
              className="pop-item"
              onClick={() => {
                navigator.clipboard.writeText(changes.map((change) => change.path).join("\n")).then(() => setCopied(true), report);
                setMenu(false);
              }}
            >
              <span className="pop-item-text">{copied ? t("common.copied") : t("change.copyList")}</span>
            </button>
          </Popover>
        </div>
      </header>
      {expanded && (
        <ul className="change-files">
          {changes.slice(0, VISIBLE).map((change) => {
            const { dir, name } = splitPath(change.path);
            const rel = relativeToProject(change.path, projectPath);
            return (
              <li key={change.path} className="change-file" title={change.path} onContextMenu={rel === null ? undefined : (event) => {
                event.preventDefault();
                reveal(rel);
              }}>
                <button type="button" className="change-open" disabled={rel === null} aria-label={`${t("change.open")}: ${change.path}`} onClick={() => rel !== null && open(rel)}>
                  <span className="change-path"><span className="change-dir">{dir}</span><span className="change-name">{name}</span></span>
                  {change.added !== null && (
                    <span className="change-nums"><span className="change-add">+{change.added}</span> <span className="change-del">−{change.removed ?? 0}</span></span>
                  )}
                </button>
                {rel !== null && (
                  <button type="button" className="change-reveal" aria-label={t("change.reveal")} title={t("change.reveal")} onClick={() => reveal(rel)}>
                    <FileIcon size={14} />
                  </button>
                )}
              </li>
            );
          })}
          {changes.length > VISIBLE && <li className="change-more">{t("change.more", { n: changes.length - VISIBLE })}</li>}
        </ul>
      )}
    </section>
  );
});
