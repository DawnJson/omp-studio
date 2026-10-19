// 全屏评审（PLAN 阶段 3）：文件树 | diff | 右栏（改动说明 / 评论队列）。盖住顶栏以下的整个窗口，Esc 或"退出评审"回到对话。
// 数据：git 状态和 diff 每次都向主进程取（use-review-data.ts）；评论队列在 store/review-store.ts，关闭评审后仍保留。
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Close } from "../../icons.tsx";
import {
  clearComments,
  closeReview,
  setReviewMode,
  useReviewComments,
  useReviewMode,
} from "../../store/review-store.ts";
import { useSettings, useTask, useTranscript } from "../../store/index.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { buildTurns } from "../conversation/model.ts";
import { pushToast } from "../dialogs/index.ts";
import { CommentQueue } from "./CommentQueue.tsx";
import { ExplainPanel } from "./ExplainPanel.tsx";
import { FileDiffView } from "./FileDiffView.tsx";
import { FileTree } from "./FileTree.tsx";
import { explainChanges, notesForFile } from "./explain.ts";
import { useReviewKeys } from "./review-keys.ts";
import { useFileDiff, useReviewStatus } from "./use-review-data.ts";
import "./review.css";
import type { ExitProps } from "../../ui/presence.ts";

const BUSY: readonly TaskState["status"][] = ["starting", "running", "needs_you"];

export function ReviewView({ taskId, open, exit }: { taskId: TaskId; open: boolean; exit: ExitProps }) {
  const t = useT();
  const task = useTask(taskId);
  const settings = useSettings();
  const transcript = useTranscript(taskId);
  const comments = useReviewComments(taskId);
  const mode = useReviewMode();
  const root = useRef<HTMLDivElement>(null);
  const { status, error, stamp, refresh } = useReviewStatus(taskId, task?.status);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"explain" | "comments">("explain");
  const [sending, setSending] = useState(false);
  const lastIndex = useRef(0);

  const groups = useMemo(() => (status?.kind === "ok" ? groupChanges(status.files) : []), [status]);
  const entries = useMemo(() => flattenGroups(groups), [groups]);
  const entry = resolveSelection(entries, selectedKey, lastIndex.current);
  useEffect(() => {
    lastIndex.current = entry === null ? 0 : entries.indexOf(entry);
  }, [entries, entry]);

  const diffState = useFileDiff(taskId, entry, stamp);
  const explanations = useMemo(() => explainChanges(transcript ? buildTurns(transcript) : []), [transcript]);
  const notes = entry === null ? [] : notesForFile(explanations, entry.path, task?.cwd ?? null);

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
    return false;
  });

  const jumpTo = (comment: QueuedComment) => {
    const exact = entries.find((candidate) => candidate.key === entryKey(comment.area, comment.file));
    const target = exact ?? entries.find((candidate) => candidate.path === comment.file);
    if (target) setSelectedKey(target.key);
  };

  const running = task !== null && BUSY.includes(task.status);
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
        <button type="button" className="rv-btn" onClick={refresh}>
          {t("common.retry")}
        </button>
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
        <FileTree groups={groups} selectedKey={entry.key} onSelect={setSelectedKey} />
        <main className="rv-main">
          <FileDiffView
            key={entry.key}
            taskId={taskId}
            entry={entry}
            state={diffState}
            mode={mode}
            comments={comments.filter((comment) => comment.file === entry.path && comment.area === entry.area)}
            onChanged={refresh}
          />
        </main>
        <aside className="rv-aside">
          <div className="rv-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className="rv-tab"
              aria-selected={tab === "explain"}
              data-testid="tab-explain"
              onClick={() => setTab("explain")}
            >
              {t("review.tabExplain")}
            </button>
            <button
              type="button"
              role="tab"
              className="rv-tab"
              aria-selected={tab === "comments"}
              data-testid="tab-comments"
              onClick={() => setTab("comments")}
            >
              {t("review.tabComments")}
              {comments.length > 0 && (
                <span className="rv-badge" data-testid="comment-count">
                  {comments.length}
                </span>
              )}
            </button>
          </div>
          <div className="rv-tabpanel" role="tabpanel">
            {tab === "explain" ? (
              <ExplainPanel notes={notes} />
            ) : (
              <CommentQueue taskId={taskId} comments={comments} onJump={jumpTo} />
            )}
          </div>
        </aside>
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
        <button type="button" className="rv-btn" data-testid="review-close" onClick={closeReview}>
          <Close size={14} />
          <span>{t("review.close")}</span>
        </button>
        <h2 className="rv-title">{t("review.title")}</h2>
        {status?.kind === "ok" && status.branch.head !== null && (
          <span className="rv-branch" data-testid="review-branch">
            {status.branch.head}
          </span>
        )}
        <span className="rv-spacer" />
        <div className="rv-seg" role="group" aria-label={t("review.layout")}>
          <button
            type="button"
            className="rv-seg-btn"
            aria-pressed={mode === "unified"}
            data-testid="mode-unified"
            onClick={() => setReviewMode("unified")}
          >
            {t("review.unified")}
          </button>
          <button
            type="button"
            className="rv-seg-btn"
            aria-pressed={mode === "split"}
            data-testid="mode-split"
            onClick={() => setReviewMode("split")}
          >
            {t("review.split")}
          </button>
        </div>
        <button type="button" className="rv-btn" data-testid="review-refresh" onClick={refresh}>
          {t("review.refresh")}
        </button>
        <button
          type="button"
          className="rv-btn rv-btn-primary"
          data-testid="review-send"
          disabled={comments.length === 0 || sending}
          title={running ? t(whenBusy === "steer" ? "review.sendSteer" : "review.sendFollowUp") : undefined}
          onClick={() => void send()}
        >
          {comments.length > 0 ? t("review.sendCount", { count: comments.length }) : t("review.send")}
        </button>
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
