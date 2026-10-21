// git 操作的模态对话框：提交、开 PR、丢弃确认（危险操作先确认）、合并冲突、清理报告。
// 键盘：Esc 关闭（消耗掉，不触发"停止任务"），Tab 在对话框内循环；关闭后焦点回到打开前的元素。
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { WorktreeCleanupResult, WorktreeSetupInfo } from "../../../../shared/git.ts";
import type { ProjectId, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { useSelectedTaskId } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { usePresence, type Presence } from "../../ui/presence.ts";
import { announceCommit, discardWorktree, pushAndCreatePullRequest } from "./git-actions.ts";
import { openReview } from "../../store/review-store.ts";
import { closeGitDialog, useGitDialog, type GitDialogState } from "./git-dialog-store.ts";
import { refreshGit } from "./git-store.ts";
import "./git.css";

const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)";

// Shell 从这里拿退出动画状态；Host 在外面算好。
const ExitContext = createContext<Presence>({
  mounted: true,
  closing: false,
  exitProps: { onAnimationEnd: () => undefined },
});
function Shell({
  title,
  testId,
  children,
  footer,
}: {
  title: string;
  testId: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = useT();
  const presence = useContext(ExitContext);
  useTitleBarDim(!presence.closing);
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const restored = useRef(false);

  const restoreFocus = () => {
    if (restored.current) return;
    restored.current = true;
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
  useEffect(() => {
    openerRef.current = document.activeElement;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return restoreFocus;
  }, []);
  // 开始退出动画就还焦点，不等卸载。
  useEffect(() => {
    if (presence.closing) restoreFocus();
  }, [presence.closing]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeGitDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="scrim" data-closing={presence.closing ? "fade" : undefined} onPointerDown={closeGitDialog}>
      <div
        ref={ref}
        className="git-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        {...presence.exitProps}
      >
        <header className="git-dialog-head">
          <h2 id={titleId} className="git-dialog-title">
            {title}
          </h2>
          <button type="button" className="tool-btn" aria-label={t("common.close")} onClick={closeGitDialog}>
            <Close size={14} />
          </button>
        </header>
        <div className="git-dialog-body">{children}</div>
        <footer className="git-dialog-foot">{footer}</footer>
      </div>
    </div>,
    document.body,
  );
}

function CancelButton() {
  const t = useT();
  return (
    <button type="button" className="gate-btn" onClick={closeGitDialog}>
      {t("common.cancel")}
    </button>
  );
}

function CommitDialog({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [stageAll, setStageAll] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || message.trim() === "") return;
    setBusy(true);
    try {
      if (announceCommit(t, await window.studio.commitGit(taskId, message.trim(), stageAll))) closeGitDialog();
    } catch (error) {
      reportError(t, error, t("git.commit.failed"));
    } finally {
      setBusy(false);
      refreshGit(taskId);
    }
  };

  return (
    <Shell
      title={t("git.commit.title")}
      testId="git-commit-dialog"
      footer={
        <>
          <button
            type="button"
            className="gate-btn git-foot-lead"
            data-testid="git-commit-review"
            onClick={() => {
              closeGitDialog();
              openReview(taskId);
            }}
          >
            {t("git.commit.review")}
          </button>
          <CancelButton />
          <button
            type="button"
            className="gate-btn"
            data-primary
            data-testid="git-commit-confirm"
            disabled={busy || message.trim() === ""}
            onClick={() => void submit()}
          >
            {t("git.commit.confirm")}
          </button>
        </>
      }
    >
      <label className="git-field">
        <span>{t("git.commit.message")}</span>
        <textarea
          className="git-input"
          data-autofocus
          data-testid="git-commit-message"
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.ctrlKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </label>
      <label className="git-check">
        <input
          type="checkbox"
          data-testid="git-commit-stage-all"
          checked={stageAll}
          onChange={(event) => setStageAll(event.target.checked)}
        />
        <span>{t("git.commit.stageAll")}</span>
      </label>
    </Shell>
  );
}

function PullRequestDialog({ taskId, defaultTitle }: { taskId: TaskId; defaultTitle: string }) {
  const t = useT();
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || title.trim() === "") return;
    setBusy(true);
    const created = await pushAndCreatePullRequest(t, taskId, { title: title.trim(), body });
    setBusy(false);
    if (created) closeGitDialog();
  };

  return (
    <Shell
      title={t("git.pr.title")}
      testId="git-pr-dialog"
      footer={
        <>
          <CancelButton />
          <button
            type="button"
            className="gate-btn"
            data-primary
            data-testid="git-pr-confirm"
            disabled={busy || title.trim() === ""}
            onClick={() => void submit()}
          >
            {t("git.pr.confirm")}
          </button>
        </>
      }
    >
      <label className="git-field">
        <span>{t("git.pr.titleField")}</span>
        <input
          className="git-input"
          data-autofocus
          data-testid="git-pr-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="git-field">
        <span>{t("git.pr.body")}</span>
        <textarea
          className="git-input"
          data-testid="git-pr-body"
          rows={6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
    </Shell>
  );
}

function DiscardDialog({ taskId, branch }: { taskId: TaskId; branch: string }) {
  const t = useT();
  const selected = useSelectedTaskId();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const done = await discardWorktree(t, taskId, selected);
    setBusy(false);
    if (done) closeGitDialog();
  };

  return (
    <Shell
      title={t("git.discard.title")}
      testId="git-discard-dialog"
      footer={
        <>
          <button type="button" className="gate-btn" data-autofocus onClick={closeGitDialog}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="gate-btn"
            data-deny
            data-testid="git-discard-confirm"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {t("git.discard.confirm")}
          </button>
        </>
      }
    >
      <p className="git-text">{t("git.discard.body", { branch })}</p>
    </Shell>
  );
}

function ConflictDialog({ files }: { files: string[] }) {
  const t = useT();
  return (
    <Shell
      title={t("git.merge.conflictTitle")}
      testId="git-conflict-dialog"
      footer={
        <button type="button" className="gate-btn" data-primary data-autofocus onClick={closeGitDialog}>
          {t("common.close")}
        </button>
      }
    >
      <p className="git-text">{t("git.merge.conflictBody")}</p>
      <ul className="git-files" data-testid="git-conflict-files">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </Shell>
  );
}

function CleanupDialog({ result }: { result: WorktreeCleanupResult }) {
  const t = useT();
  const empty = result.removed.length === 0 && result.kept.length === 0;
  return (
    <Shell
      title={t("git.cleanup.title")}
      testId="git-cleanup-dialog"
      footer={
        <button type="button" className="gate-btn" data-primary data-autofocus onClick={closeGitDialog}>
          {t("common.close")}
        </button>
      }
    >
      {empty && <p className="git-text">{t("git.cleanup.none")}</p>}
      {result.removed.length > 0 && (
        <section>
          <h3 className="git-group">{t("git.cleanup.removed")}</h3>
          <ul className="git-files" data-testid="git-cleanup-removed">
            {result.removed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      )}
      {result.kept.length > 0 && (
        <section>
          <h3 className="git-group">{t("git.cleanup.kept")}</h3>
          <ul className="git-files" data-testid="git-cleanup-kept">
            {result.kept.map((entry) => (
              <li key={entry.name}>
                {entry.name}
                <span className="git-files-note">{t(`git.cleanup.${entry.reason}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

/** 仓库里的 setup 脚本是可执行内容：首次使用（或内容变了）先问；任何方式关闭对话框都等于拒绝。 */
function SetupDialog({
  projectId,
  script,
  settle,
}: {
  projectId: ProjectId;
  script: WorktreeSetupInfo;
  settle(approved: boolean): void;
}) {
  const t = useT();
  const settled = useRef(false);
  // 卸载时（Esc、点遮罩、切走）按拒绝处理；用 ref 拿最新的 settle，卸载回调不需要跟着重建。
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const finish = (approved: boolean) => {
    if (settled.current) return;
    settled.current = true;
    settleRef.current(approved);
  };
  // 关闭（取消、Esc、点遮罩、切走）就按拒绝处理：在退出动画开始时就结算，不等卸载，
  // 否则发送流程要多等一段动画，期间再按 Enter 会被当成"还在发送"忽略掉。
  const closing = useContext(ExitContext).closing;
  useEffect(() => {
    if (closing) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);
  useEffect(() => () => finish(false), []);

  const approve = async () => {
    try {
      await window.studio.approveWorktreeSetup(projectId, script.sha256);
      finish(true);
    } catch (error) {
      reportError(t, error);
      finish(false);
    }
    closeGitDialog();
  };

  return (
    <Shell
      title={t("git.setup.title")}
      testId="git-setup-dialog"
      footer={
        <>
          <button type="button" className="gate-btn" data-autofocus onClick={closeGitDialog}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="gate-btn"
            data-primary
            data-testid="git-setup-confirm"
            onClick={() => void approve()}
          >
            {t("git.setup.confirm")}
          </button>
        </>
      }
    >
      <p className="git-text">{t("git.setup.body", { script: script.name })}</p>
    </Shell>
  );
}

export function GitDialogHost() {
  const state = useGitDialog();
  // 关闭后留着最后一个对话框放完退出动画；这期间 state 已是 null。
  // 每次打开都是新的一份（key 按请求递增）：退出动画中又来一个请求时，不复用上一个对话框的状态和卸载逻辑。
  const lastRef = useRef(state);
  const serialRef = useRef(0);
  if (state !== null && state !== lastRef.current) serialRef.current += 1;
  if (state !== null) lastRef.current = state;
  const shown = state ?? lastRef.current;
  const presence = usePresence(state !== null);
  if (!presence.mounted || shown === null) return null;
  return (
    <ExitContext.Provider value={presence} key={serialRef.current}>
      {renderDialog(shown)}
    </ExitContext.Provider>
  );
}

function renderDialog(state: GitDialogState): ReactNode {
  switch (state.kind) {
    case "commit":
      return <CommitDialog taskId={state.taskId} />;
    case "pr":
      return <PullRequestDialog taskId={state.taskId} defaultTitle={state.defaultTitle} />;
    case "discard":
      return <DiscardDialog taskId={state.taskId} branch={state.branch} />;
    case "conflict":
      return <ConflictDialog files={state.files} />;
    case "cleanup":
      return <CleanupDialog result={state.result} />;
    case "setup":
      return <SetupDialog projectId={state.projectId} script={state.script} settle={state.settle} />;
  }
}
