// 一个文件（某一侧）的 diff：文件头（暂存/取消暂存/丢弃）、每个 hunk、评论状态、n/p 切换改动块、丢弃前的确认。
import { useEffect, useRef, useState } from "react";
import {
  REVIEW_COMMENTS_MAX,
  type GitDiffArea,
  type GitDiffContext,
  type GitHunkRef,
  type GitLinesRef,
} from "../../../../shared/git.ts";
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
import { extendToLine, moveSelection, toggleLine, type LinePick } from "../../../../shared/ui/line-selection.ts";
import { useT } from "../../i18n/use-t.ts";
import { addComment, removeComment, updateComment } from "../../store/review-store.ts";
import { Button } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { explainError, reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { splitPath } from "./FileTree.tsx";
import { HunkView, type CommentCtx, type HunkActions, type PickCtx } from "./HunkView.tsx";
import { useReviewKeys } from "./review-keys.ts";
import { languageOf } from "./use-hunk-tokens.ts";
import { diffKeyOf, type FileDiffState } from "./use-review-data.ts";

type Confirm = { kind: "file" } | { kind: "hunk"; hunk: GitHunkRef } | { kind: "lines"; ref: GitLinesRef };

const EMPTY_SET: ReadonlySet<number> = new Set();

export function FileDiffView({
  taskId,
  entry,
  state,
  mode,
  scope,
  wrap,
  ignoreSpace,
  comments,
  reveal,
  onRevealed,
  onChanged,
}: {
  taskId: TaskId;
  entry: ReviewEntry;
  state: FileDiffState;
  mode: "unified" | "split";
  scope: GitDiffContext;
  wrap: boolean;
  comments: readonly QueuedComment[];
  /** 从评论列表点进来要滚到的评论 id（diff 载入后滚一次，滚完调 onRevealed）。 */
  reveal: string | null;
  onRevealed(): void;
  /** 暂存/丢弃之后（无论成败）让上层重新取状态。 */
  onChanged(): void;
  /** 忽略空白（`git diff -w`）：只影响显示；打开时 hunk / 行级暂存不可用。 */
  ignoreSpace: boolean;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<LineRef | null>(null);
  const [draft, setDraft] = useState<LineSelection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeHunk, setActiveHunk] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [picked, setPicked] = useState<LinePick | null>(null);
  const area: GitDiffArea = entry.area;
  const diffKey = diffKeyOf(area, scope, ignoreSpace, entry.path);
  const diff = state.key === diffKey ? state.diff : null;
  const hunkCount = diff?.kind === "text" ? diff.hunks.length : 0;
  // n / p 的单位：改动块视图走 hunk，整个文件视图走文件里的改动块。
  const stepCount =
    scope === "hunks" || diff?.kind !== "text"
      ? hunkCount
      : diff.hunks.reduce((sum, hunk) => sum + countChangeBlocks(hunk.lines), 0);

  useReviewKeys((key, event) => {
    if (key === "Escape" && picked !== null) {
      setPicked(null);
      return true;
    }
    if (event.shiftKey && (key === "ArrowDown" || key === "ArrowUp")) {
      if (!pickable) return false;
      const hunk = picked?.hunk ?? activeHunk ?? 0;
      const next = moveSelection(picked, hunk, key === "ArrowDown" ? 1 : -1, changedOf(hunk));
      if (next === null) return false;
      setPicked(next);
      return true;
    }
    if (key !== "n" && key !== "p") return false;
    const next = stepHunk(stepCount, activeHunk, key === "n" ? 1 : -1);
    if (next === null) return false;
    setActiveHunk(next);
    return true;
  }, true);

  // 键盘扩展选择时让端点留在视野里。
  useEffect(() => {
    if (picked === null) return;
    const rows = scroller.current?.querySelectorAll(`[data-hunk="${picked.hunk}"] [data-idx="${picked.cursor}"]`);
    rows?.[0]?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  useEffect(() => {
    if (activeHunk === null) return;
    const selector = scope === "file" ? `[data-block="${activeHunk}"]` : `[data-hunk="${activeHunk}"]`;
    scroller.current?.querySelector(selector)?.scrollIntoView({ block: "nearest" });
  }, [activeHunk, scope]);

  // 换了一份 diff（重取、换文件 / 视图）：行下标不再可信，选择作废。
  useEffect(() => {
    setPicked(null);
  }, [diff, ignoreSpace]);

  useEffect(() => {
    if (reveal === null || diff === null) return;
    const card = scroller.current?.querySelector(`[data-comment-id="${CSS.escape(reveal)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    onRevealed();
  }, [reveal, diff, onRevealed]);

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

  // ── 按行选择：只在改动块视图、没有忽略空白、已跟踪的文件上可用（见 docs/architecture/git.md）。
  const pickable = scope === "hunks" && !ignoreSpace && area !== "untracked" && diff?.kind === "text";
  const linesRef = (): GitLinesRef | null => {
    const ref = picked === null ? null : hunkRef(picked.hunk);
    return picked !== null && ref ? { ...ref, lines: picked.lines } : null;
  };
  const runLines = (op: typeof window.studio.stageGitLines, ref: GitLinesRef) => {
    setPicked(null);
    run(op(taskId, entry.path, ref));
  };
  const linesOp = (op: typeof window.studio.stageGitLines) => {
    const ref = linesRef();
    if (ref) runLines(op, ref);
  };
  const changedOf = (index: number): boolean[] =>
    diff?.kind === "text" ? (diff.hunks[index]?.lines.map((line) => line.kind !== "context") ?? []) : [];
  const pickCtx = (index: number): PickCtx => ({
    selected: picked !== null && picked.hunk === index ? new Set(picked.lines) : EMPTY_SET,
    onPick: (line, extend) =>
      setPicked((current) =>
        extend
          ? extendToLine(current, index, line, changedOf(index))
          : toggleLine(current, index, line, changedOf(index)),
      ),
  });

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
  const hunkActions = (index: number): HunkActions => {
    const lines: HunkActions["lines"] =
      picked !== null && picked.hunk === index && pickable
        ? {
            count: picked.lines.length,
            clear: () => setPicked(null),
            ...(area === "staged"
              ? { unstage: () => linesOp(window.studio.unstageGitLines) }
              : {
                  stage: () => linesOp(window.studio.stageGitLines),
                  discard: () => {
                    const ref = linesRef();
                    if (ref) setConfirm({ kind: "lines", ref });
                  },
                }),
          }
        : undefined;
    const blocked = ignoreSpace || undefined;
    const rest = lines === undefined ? {} : { lines };
    return area === "staged"
      ? { unstage: () => hunkOp(index, window.studio.unstageGitHunk), blocked, ...rest }
      : area === "unstaged"
        ? {
            stage: () => hunkOp(index, window.studio.stageGitHunk),
            discard: () => {
              const ref = hunkRef(index);
              if (ref) setConfirm({ kind: "hunk", hunk: ref });
            },
            blocked,
            ...rest,
          }
        : {};
  };

  const confirmDiscard = () => {
    const pending = confirm;
    setConfirm(null);
    if (pending === null) return;
    if (pending.kind === "lines") runLines(window.studio.discardGitLines, pending.ref);
    else
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
          {t("review.loadFailed")} · {explainError(t, state.error)}
        </span>
        <Button size="sm" onClick={onChanged}>
          {t("common.retry")}
        </Button>
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
          pick={pickable ? pickCtx(index) : null}
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
        <span className="rv-file-actions">
          {area === "staged" ? (
            <Button size="sm" testId="file-unstage" onClick={unstageFile}>
              {t("review.unstage")}
            </Button>
          ) : (
            <Button size="sm" testId="file-stage" onClick={stageFile}>
              {t("review.stage")}
            </Button>
          )}
          <Button size="sm" variant="danger" testId="file-discard" onClick={() => setConfirm({ kind: "file" })}>
            {t("review.discard")}
          </Button>
        </span>
      </header>
      <div className="rv-scroll" ref={scroller} data-testid="diff-scroll" tabIndex={0}>
        {body}
      </div>
      {confirm !== null && (
        <ConfirmDialog
          danger
          testId="review-discard-dialog"
          title={t(
            confirm.kind === "file"
              ? "review.discardFileTitle"
              : confirm.kind === "hunk"
                ? "review.discardHunkTitle"
                : "review.discardLinesTitle",
          )}
          body={
            confirm.kind === "lines"
              ? t("review.discardLinesBody", { path: entry.path, count: confirm.ref.lines.length })
              : t(
                  confirm.kind === "hunk"
                    ? "review.discardHunkBody"
                    : area === "untracked" || (area === "staged" && (entry.kind === "added" || entry.kind === "copied"))
                      ? "review.discardUntrackedBody"
                      : "review.discardFileBody",
                  { path: entry.path },
                )
          }
          confirmLabel={t("review.discardConfirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={confirmDiscard}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
