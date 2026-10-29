// git 操作的模态对话框：提交、开 PR、丢弃确认（危险操作先确认）、合并冲突、清理报告。
// 外壳、键盘（Esc / Tab 循环 / 焦点回位）都是 ui/Dialog 的；提交 / 推送是主按钮，丢弃是 danger 确认框。
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { WorktreeCleanupResult, WorktreeSetupInfo } from "../../../../shared/git.ts";
import type { ProjectId, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Diff } from "../../icons.tsx";
import { primaryMod } from "../../app/platform-keys.ts";
import { useSelectedTaskId } from "../../store/index.ts";
import { openReview } from "../../store/review-store.ts";
import { Button, Checkbox, FormField, Textarea, TextField } from "../../ui/controls.tsx";
import { ConfirmDialog, Dialog } from "../../ui/Dialog.tsx";
import { reportError } from "../../ui/errors.ts";
import { usePresence } from "../../ui/presence.ts";
import { commitChanges, discardWorktree, pushAndCreatePullRequest } from "./git-actions.ts";
import { closeGitDialog, useGitDialog, type GitDialogState } from "./git-dialog-store.ts";
import "./git.css";

function CancelButton() {
  const t = useT();
  return <Button onClick={closeGitDialog}>{t("common.cancel")}</Button>;
}

function CommitDialog({ taskId, open }: { taskId: TaskId; open: boolean }) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [stageAll, setStageAll] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || message.trim() === "") return;
    setBusy(true);
    if (await commitChanges(t, taskId, message.trim(), stageAll)) closeGitDialog();
    setBusy(false);
  };

  return (
    <Dialog
      open={open}
      onClose={closeGitDialog}
      title={t("git.commit.title")}
      testId="git-commit-dialog"
      footStart={
        <span className="git-foot-start">
          <Checkbox checked={stageAll} onChange={setStageAll} testId="git-commit-stage-all">
            {t("git.commit.stageAll")}
          </Checkbox>
          <Button
            variant="quiet"
            size="sm"
            icon={<Diff size={14} />}
            testId="git-commit-review"
            onClick={() => {
              closeGitDialog();
              openReview(taskId);
            }}
          >
            {t("git.commit.review")}
          </Button>
        </span>
      }
      footer={
        <>
          <CancelButton />
          <Button
            variant="primary"
            testId="git-commit-confirm"
            loading={busy}
            disabled={message.trim() === ""}
            onClick={() => void submit()}
          >
            {t("git.commit.confirm")}
          </Button>
        </>
      }
    >
      <FormField label={t("git.commit.message")} htmlFor="git-commit-message">
        <Textarea
          id="git-commit-message"
          data-autofocus=""
          testId="git-commit-message"
          rows={4}
          value={message}
          onChange={setMessage}
          onKeyDown={(event) => {
            if (event.key === "Enter" && primaryMod(event) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </FormField>
    </Dialog>
  );
}

function PullRequestDialog({ taskId, defaultTitle, open }: { taskId: TaskId; defaultTitle: string; open: boolean }) {
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
    <Dialog
      open={open}
      onClose={closeGitDialog}
      title={t("git.pr.title")}
      testId="git-pr-dialog"
      footer={
        <>
          <CancelButton />
          <Button
            variant="primary"
            testId="git-pr-confirm"
            loading={busy}
            disabled={title.trim() === ""}
            onClick={() => void submit()}
          >
            {t("git.pr.confirm")}
          </Button>
        </>
      }
    >
      <FormField label={t("git.pr.titleField")} htmlFor="git-pr-title">
        <TextField
          id="git-pr-title"
          width="100%"
          data-autofocus=""
          testId="git-pr-title"
          value={title}
          onChange={setTitle}
        />
      </FormField>
      <FormField label={t("git.pr.body")} htmlFor="git-pr-body">
        <Textarea id="git-pr-body" testId="git-pr-body" rows={6} value={body} onChange={setBody} />
      </FormField>
    </Dialog>
  );
}

/** 危险确认：ConfirmDialog danger（danger-solid、焦点在取消）。确认后的动作放完退出动画才开始；失败由 toast 说明，对话框不再回来。 */
function DiscardDialog({ taskId, branch }: { taskId: TaskId; branch: string }) {
  const t = useT();
  const selected = useSelectedTaskId();
  // 分支名用等宽字（和正文分得开，"worktree 目录"不会和它连成一串）：译文里 {branch} 的位置切开，中间放 <code>
  const [before, after] = t("git.discard.body", { branch: "\u0000" }).split("\u0000");
  return (
    <ConfirmDialog
      danger
      title={t("git.discard.title")}
      body={
        <>
          {before}
          <code className="git-branch">{branch}</code>
          {after}
        </>
      }
      confirmLabel={t("git.discard.confirm")}
      testId="git-discard-dialog"
      onCancel={closeGitDialog}
      onConfirm={() => void discardWorktree(t, taskId, selected).finally(closeGitDialog)}
    />
  );
}

function ConflictDialog({ files, open }: { files: string[]; open: boolean }) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={closeGitDialog}
      title={t("git.merge.conflictTitle")}
      desc={t("git.merge.conflictBody")}
      hideClose
      testId="git-conflict-dialog"
      footer={
        <Button variant="primary" data-autofocus="" onClick={closeGitDialog}>
          {t("common.close")}
        </Button>
      }
    >
      <ul className="git-files" data-testid="git-conflict-files">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </Dialog>
  );
}

function CleanupDialog({ result, open }: { result: WorktreeCleanupResult; open: boolean }) {
  const t = useT();
  const empty = result.removed.length === 0 && result.kept.length === 0;
  return (
    <Dialog
      open={open}
      onClose={closeGitDialog}
      title={t("git.cleanup.title")}
      hideClose
      testId="git-cleanup-dialog"
      footer={
        <Button variant="primary" data-autofocus="" onClick={closeGitDialog}>
          {t("common.close")}
        </Button>
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
    </Dialog>
  );
}

/** 仓库里的 setup 脚本是可执行内容：首次使用（或内容变了）先问；任何方式关闭对话框都等于拒绝。 */
function SetupDialog({
  projectId,
  script,
  settle,
  open,
}: {
  projectId: ProjectId;
  script: WorktreeSetupInfo;
  settle(approved: boolean): void;
  open: boolean;
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
  useEffect(() => {
    if (!open) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
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
    <Dialog
      open={open}
      onClose={closeGitDialog}
      size="sm"
      title={t("git.setup.title")}
      desc={t("git.setup.body", { script: script.name })}
      testId="git-setup-dialog"
      footer={
        <>
          <Button data-autofocus="" onClick={closeGitDialog}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" testId="git-setup-confirm" onClick={() => void approve()}>
            {t("git.setup.confirm")}
          </Button>
        </>
      }
    />
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
  return <Fragment key={serialRef.current}>{renderDialog(shown, state !== null)}</Fragment>;
}

function renderDialog(state: GitDialogState, open: boolean): ReactNode {
  switch (state.kind) {
    case "commit":
      return <CommitDialog taskId={state.taskId} open={open} />;
    case "pr":
      return <PullRequestDialog taskId={state.taskId} defaultTitle={state.defaultTitle} open={open} />;
    case "discard":
      return <DiscardDialog taskId={state.taskId} branch={state.branch} />;
    case "conflict":
      return <ConflictDialog files={state.files} open={open} />;
    case "cleanup":
      return <CleanupDialog result={state.result} open={open} />;
    case "setup":
      return <SetupDialog projectId={state.projectId} script={state.script} settle={state.settle} open={open} />;
  }
}
