// 全屏评审：文件树 | diff。评论只在 diff 里（行内卡片），工具条的"评论 N"打开列表浮层。盖住顶栏以下的整个窗口，Esc 或"退出评审"回到对话。
// 数据：git 状态和 diff 每次都向主进程取（use-review-data.ts）；评论队列在 store/review-store.ts，关闭评审后仍保留。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import {
  entryKey,
  flattenGroups,
  groupChanges,
  resolveSelection,
  stepEntry,
  toReviewComments,
  type QueuedComment,
} from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Restart } from "../../icons.tsx";
import {
  clearComments,
  closeReview,
  setReviewMode,
  setReviewScope,
  setReviewWrap,
  useReviewComments,
  useReviewMode,
  useReviewScope,
  useReviewWrap,
} from "../../store/review-store.ts";
import { useSettings, useTask } from "../../store/index.ts";
import { Button, IconButton } from "../../ui/controls.tsx";
import { describeError, reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { CommentQueue } from "./CommentQueue.tsx";
import { CommitBox } from "./CommitBox.tsx";
import { FileDiffView } from "./FileDiffView.tsx";
import { FileTree } from "./FileTree.tsx";
import { useReviewKeys } from "./review-keys.ts";
import { useChangeStats, useFileDiff, useReviewStatus } from "./use-review-data.ts";
import "./review.css";
import { ViewControls } from "./ViewControls.tsx";
import type { ExitProps } from "../../ui/presence.ts";

const BUSY: ReadonlySet<TaskState["status"]> = new Set(["starting", "running", "needs_you"]);

export function ReviewView({ taskId, open, exit }: { taskId: TaskId; open: boolean; exit: ExitProps }) {
  const t = useT();
  const task = useTask(taskId);
  const settings = useSettings();
  const comments = useReviewComments(taskId);
  const mode = useReviewMode();
  const scope = useReviewScope();
  const wrap = useReviewWrap();
  const root = useRef<HTMLDivElement>(null);
  const { status, error, stamp, refresh } = useReviewStatus(taskId, task?.status);
  const [ignoreSpace, setIgnoreSpace] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  const clearReveal = useCallback(() => setReveal(null), []);
  const lastIndex = useRef(0);

  const groups = useMemo(() => (status?.kind === "ok" ? groupChanges(status.files) : []), [status]);
  const entries = useMemo(() => flattenGroups(groups), [groups]);
  const entry = resolveSelection(entries, selectedKey, lastIndex.current);
  useEffect(() => {
    lastIndex.current = entry === null ? 0 : entries.indexOf(entry);
  }, [entries, entry]);

  const diffState = useFileDiff(taskId, entry, scope, ignoreSpace, stamp);
  const stats = useChangeStats(taskId, stamp);
  const stagedCount = groups.find((group) => group.area === "staged")?.entries.length ?? 0;

  // 进入时把焦点放进评审、底下的页面不可达（inert）；退出（开始退出动画或卸载）时焦点回到触发它的元素，已经不在了就回输入框。
  const release = useRef<() => void>(() => undefined);
  useEffect(() => {
    const trigger = document.activeElement;
    const body = document.querySelector(".body");
    body?.setAttribute("inert", "");
    root.current?.focus();
    let released = false;
    release.current = () => {
      if (released) return;
      released = true;
      body?.removeAttribute("inert");
      const target =
        trigger instanceof HTMLElement && trigger.isConnected
          ? trigger
          : document.querySelector<HTMLElement>("[data-composer-input]");
      target?.focus();
    };
    return () => release.current();
  }, []);
  useEffect(() => {
    if (!open) release.current();
  }, [open]);

  useReviewKeys((key) => {
    if (key === "Escape") {
      closeReview();
      return true;
    }
    if (key === "j" || key === "k") {
      const next = stepEntry(entries, entry?.key ?? null, key === "j" ? 1 : -1);
      if (next) setSelectedKey(next.key);
      return true;
    }
    if (key === "v") {
      setReviewMode(mode === "unified" ? "split" : "unified");
      return true;
    }
    if (key === "f") {
      setReviewScope(scope === "hunks" ? "file" : "hunks");
      return true;
    }
    if (key === "w") {
      setReviewWrap(!wrap);
      return true;
    }
    return false;
  });

  const jumpTo = (comment: QueuedComment) => {
    const exact = entries.find((candidate) => candidate.key === entryKey(comment.area, comment.file));
    const target = exact ?? entries.find((candidate) => candidate.path === comment.file);
    if (target) setSelectedKey(target.key);
    setReveal(comment.id);
  };

  const running = task !== null && BUSY.has(task.status);
  const whenBusy = settings?.enterWhileRunning ?? "steer";
  const send = async () => {
    const payload = toReviewComments(comments);
    if (payload.length === 0 || sending) return;
    setSending(true);
    try {
      await window.studio.sendReviewComments(taskId, payload, whenBusy);
      clearComments(taskId);
      closeReview();
      pushToast({ message: t("review.sent") });
    } catch (cause) {
      reportError(t, cause);
    } finally {
      setSending(false);
    }
  };

  let content;
  if (error !== null && status === null) {
    content = (
      <div className="rv-state" role="alert">
        <p>
          {t("review.loadFailed")} · {describeError(t, error)}
        </p>
        <Button onClick={refresh}>{t("common.retry")}</Button>
      </div>
    );
  } else if (status === null) content = <div className="rv-state">{t("review.loading")}</div>;
  else if (status.kind === "git_missing")
    content = (
      <div className="rv-state" data-testid="review-git-missing">
        {t("review.gitMissing")}
      </div>
    );
  else if (status.kind === "not_git")
    content = (
      <div className="rv-state" data-testid="review-not-git">
        {t("review.notGit")}
      </div>
    );
  else if (entry === null)
    content = (
      <div className="rv-state" data-testid="review-empty">
        {t("review.noFiles")}
      </div>
    );
  else
    content = (
      <div className="rv-body">
        <div className="rv-side">
          <FileTree groups={groups} stats={stats} selectedKey={entry.key} onSelect={setSelectedKey} />
          <CommitBox taskId={taskId} stagedCount={stagedCount} onCommitted={refresh} />
        </div>
        <main className="rv-main">
          <FileDiffView
            key={entry.key}
            taskId={taskId}
            entry={entry}
            state={diffState}
            mode={mode}
            scope={scope}
            wrap={wrap}
            ignoreSpace={ignoreSpace}
            comments={comments.filter((comment) => comment.file === entry.path && comment.area === entry.area)}
            reveal={reveal}
            onRevealed={clearReveal}
            onChanged={refresh}
          />
        </main>
      </div>
    );

  return (
    <div
      className="review"
      ref={root}
      tabIndex={-1}
      data-testid="review"
      role="region"
      aria-label={t("review.title")}
      {...exit}
    >
      <header className="rv-head">
        <IconButton label={t("review.close")} testId="review-close" onClick={closeReview}>
          <Close size={14} />
        </IconButton>
        <h2 className="rv-title">{t("review.title")}</h2>
        {status?.kind === "ok" && status.branch.head !== null && (
          <span className="rv-branch" data-testid="review-branch">
            {status.branch.head}
          </span>
        )}
        <span className="rv-spacer" />
        <ViewControls mode={mode} scope={scope} wrap={wrap} ignoreSpace={ignoreSpace} onIgnoreSpace={setIgnoreSpace} />
        <IconButton label={t("review.refresh")} testId="review-refresh" onClick={refresh}>
          <Restart size={14} />
        </IconButton>
        <CommentQueue comments={comments} onJump={jumpTo} />
        <Button
          variant="primary"
          size="sm"
          testId="review-send"
          disabled={comments.length === 0}
          loading={sending}
          title={running ? t(whenBusy === "steer" ? "review.sendSteer" : "review.sendFollowUp") : undefined}
          onClick={() => void send()}
        >
          {t("review.send")}
        </Button>
      </header>
      {error !== null && status !== null && (
        <div className="rv-state" role="alert" data-testid="review-stale-error">
          {t("review.loadFailed")} · {describeError(t, error)}
        </div>
      )}
      {content}
    </div>
  );
}
