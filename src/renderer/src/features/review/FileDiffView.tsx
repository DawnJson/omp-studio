// 一个文件（某一侧）的 diff：文件头（暂存/取消暂存/丢弃）、每个 hunk、评论状态、n/p 切换改动块、丢弃前的确认。
import { useEffect, useRef, useState } from "react";
import type { GitDiffArea, GitDiffContext, GitHunkRef } from "../../../../shared/git.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import {
  countChangeBlocks,
  selectionOf,
  selectRange,
  stepHunk,
  type LineRef,
  type LineSelection,
  type QueuedComment,
  type ReviewEntry,
} from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { addComment, removeComment, updateComment } from "../../store/review-store.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { ConfirmDialog } from "../settings/ConfirmDialog.tsx";
import { REVIEW_COMMENTS_MAX } from "../../../../shared/git.ts";
import { HunkView, type CommentCtx, type HunkActions } from "./HunkView.tsx";
import { useReviewKeys } from "./review-keys.ts";
import { languageOf } from "./use-hunk-tokens.ts";
import type { FileDiffState } from "./use-review-data.ts";

type Confirm = { kind: "file" } | { kind: "hunk"; hunk: GitHunkRef };

function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { dir: "", name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

export function FileDiffView({
  taskId,
  entry,
  state,
  mode,
  scope,
  wrap,
  comments,
  onChanged,
}: {
  taskId: TaskId;
  entry: ReviewEntry;
  state: FileDiffState;
  mode: "unified" | "split";
  scope: GitDiffContext;
  wrap: boolean;
  comments: readonly QueuedComment[];
  /** 暂存/丢弃之后（无论成败）让上层重新取状态。 */
  onChanged(): void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<LineRef | null>(null);
  const [draft, setDraft] = useState<LineSelection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeHunk, setActiveHunk] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const area: GitDiffArea = entry.area;
  const diffKey = `${area}:${scope}:${entry.path}`;
  const diff = state.key === diffKey ? state.diff : null;
  const hunkCount = diff?.kind === "text" ? diff.hunks.length : 0;
  // n / p 的单位：改动块视图走 hunk，整个文件视图走文件里的改动块。
  const stepCount =
    scope === "hunks" || diff?.kind !== "text"
      ? hunkCount
      : diff.hunks.reduce((sum, hunk) => sum + countChangeBlocks(hunk.lines), 0);

  useReviewKeys((key) => {
    if (key !== "n" && key !== "p") return false;
    const next = stepHunk(stepCount, activeHunk, key === "n" ? 1 : -1);
    if (next === null) return false;
    setActiveHunk(next);
    return true;
  });

  useEffect(() => {
    if (activeHunk === null) return;
    const selector = scope === "file" ? `[data-block="${activeHunk}"]` : `[data-hunk="${activeHunk}"]`;
    scroller.current?.querySelector(selector)?.scrollIntoView({ block: "nearest" });
  }, [activeHunk, scope]);

  // 换了视图，序号的含义变了；暂存一个 hunk 后这一侧的 hunk 变少，当前序号也可能越界。
  useEffect(() => {
    setActiveHunk(null);
  }, [scope]);
  useEffect(() => {
    setActiveHunk((current) =>
      current !== null && current >= stepCount ? (stepCount > 0 ? stepCount - 1 : null) : current,
    );
  }, [stepCount]);

  const run = (operation: Promise<void>) => {
    operation.catch((error: unknown) => reportError(t, error)).finally(onChanged);
  };
  const stageFile = () => run(window.studio.stageGitFile(taskId, entry.path));
  const unstageFile = () => run(window.studio.unstageGitFile(taskId, entry.path));
  const hunkRef = (index: number): GitHunkRef | null => {
    const hunk = diff?.kind === "text" ? diff.hunks[index] : undefined;
    return hunk ? { index, header: hunk.header } : null;
  };
  const hunkOp = (index: number, op: typeof window.studio.stageGitHunk) => {
    const ref = hunkRef(index);
    if (ref) run(op(taskId, entry.path, ref));
  };

  const ctx: CommentCtx = {
    comments,
    draft,
    editingId,
    pick(ref, extend) {
      setEditingId(null);
      const range = extend && anchor !== null ? selectRange(anchor, ref) : null;
      if (range === null) setAnchor(ref);
      setDraft(range ?? selectionOf(ref));
    },
    submitDraft(body) {
      if (draft === null) return;
      const added = addComment(taskId, {
        file: entry.path,
        area,
        side: draft.side,
        startLine: draft.start,
        endLine: draft.end,
        body: body.trim(),
      });
      if (!added) pushToast({ level: "error", message: t("review.queueFull", { max: REVIEW_COMMENTS_MAX }) });
      setDraft(null);
      setAnchor(null);
    },
    cancelDraft() {
      setDraft(null);
      setAnchor(null);
    },
    edit(id) {
      setDraft(null);
      setEditingId(id);
    },
    saveEdit(id, body) {
      updateComment(taskId, id, body.trim());
      setEditingId(null);
    },
    cancelEdit: () => setEditingId(null),
    remove: (id) => removeComment(taskId, id),
  };

  const { dir, name } = splitPath(entry.path);
  const lang = languageOf(entry.path);
  const hunkActions = (index: number): HunkActions =>
    area === "staged"
      ? { unstage: () => hunkOp(index, window.studio.unstageGitHunk) }
      : area === "unstaged"
        ? {
            stage: () => hunkOp(index, window.studio.stageGitHunk),
            discard: () => {
              const ref = hunkRef(index);
              if (ref) setConfirm({ kind: "hunk", hunk: ref });
            },
          }
        : {};

  const confirmDiscard = () => {
    const pending = confirm;
    setConfirm(null);
    if (pending === null) return;
    run(
      pending.kind === "file"
        ? window.studio.discardGitFile(taskId, entry.path)
        : window.studio.discardGitHunk(taskId, entry.path, pending.hunk),
    );
  };

  let body;
  if (state.key === diffKey && state.error !== null) {
    body = (
      <div className="rv-note" role="alert">
        <span>
          {t("review.loadFailed")} · {describeError(t, state.error)}
        </span>
        <button type="button" className="rv-btn" onClick={onChanged}>
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (diff === null) body = <div className="rv-note">{t("review.loading")}</div>;
  else if (diff.kind === "binary")
    body = (
      <div className="rv-note" data-testid="diff-binary">
        {t("review.binary")}
      </div>
    );
  else if (diff.kind === "too_large")
    body = (
      <div className="rv-note" data-testid="diff-too-large">
        {t("review.tooLarge")}
      </div>
    );
  else if (diff.hunks.length === 0) body = <div className="rv-note">{t("review.noTextChanges")}</div>;
  else {
    let base = 0;
    body = diff.hunks.map((hunk, index) => {
      const blocks = scope === "file" ? { base, active: activeHunk } : null;
      base += countChangeBlocks(hunk.lines);
      return (
        <HunkView
          key={`${hunk.header}:${index}`}
          file={entry.path}
          area={area}
          hunk={hunk}
          index={index}
          mode={mode}
          wrap={wrap}
          active={scope === "hunks" && activeHunk === index}
          blocks={blocks}
          lang={lang}
          ctx={ctx}
          actions={hunkActions(index)}
        />
      );
    });
  }

  return (
    <div className="rv-file" data-testid="file-diff" data-path={entry.path} data-area={area}>
      <header className="rv-file-head">
        <span className="rv-file-path" title={entry.path}>
          {entry.oldPath !== null && <span className="rv-dir">{entry.oldPath} → </span>}
          <span className="rv-dir">{dir}</span>
          <span className="rv-name">{name}</span>
        </span>
        {diff?.kind === "text" && (
          <span className="rv-counts">
            <span className="rv-add">+{diff.added}</span> <span className="rv-del">−{diff.removed}</span>
          </span>
        )}
        <span className="rv-file-actions">
          {area === "staged" ? (
            <button type="button" className="rv-btn" data-testid="file-unstage" onClick={unstageFile}>
              {t("review.unstage")}
            </button>
          ) : (
            <button type="button" className="rv-btn" data-testid="file-stage" onClick={stageFile}>
              {t("review.stage")}
            </button>
          )}
          <button
            type="button"
            className="rv-btn rv-btn-danger"
            data-testid="file-discard"
            onClick={() => setConfirm({ kind: "file" })}
          >
            {t("review.discard")}
          </button>
        </span>
      </header>
      <div className="rv-scroll" ref={scroller} data-testid="diff-scroll" tabIndex={0}>
        {body}
      </div>
      {confirm !== null && (
        <ConfirmDialog
          title={t(confirm.kind === "file" ? "review.discardFileTitle" : "review.discardHunkTitle")}
          body={t(
            confirm.kind === "hunk"
              ? "review.discardHunkBody"
              : area === "untracked" || (area === "staged" && (entry.kind === "added" || entry.kind === "copied"))
                ? "review.discardUntrackedBody"
                : "review.discardFileBody",
            { path: entry.path },
          )}
          confirmLabel={t("review.discardConfirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={confirmDiscard}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
