// 评审左栏底部的提交框：提交信息表单（git/CommitMessageFields，和提交对话框同一份）+ 勾选项 + 提交。
// 走和提交对话框同一条路径（git-actions 的 commitChanges → commitGit），提交信息 = 摘要 + 空行 + 说明（composeCommitMessage）。
// 默认只提交已暂存的文件——评审里暂存是显式的动作，勾上"先暂存全部改动"才会 add -A。
// "修改上一次提交"：勾上时读出 HEAD 的信息预填；已推送的提交提交前要再确认（改写历史，studio 不强推）。
import { useRef, useState } from "react";
import { splitCommitMessage, type GitLastCommit } from "../../../../shared/git.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { composeCommitMessage } from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Checkbox } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { CommitMessageFields } from "../git/CommitMessageFields.tsx";
import { commitChanges } from "../git/git-actions.ts";

export function CommitBox({
  taskId,
  stagedCount,
  onCommitted,
}: {
  taskId: TaskId;
  stagedCount: number;
  /** 提交成功之后（评审重取状态）。 */
  onCommitted(): void;
}) {
  const t = useT();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [stageAll, setStageAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amend, setAmend] = useState(false);
  const [loadingLast, setLoadingLast] = useState(false);
  const [last, setLast] = useState<GitLastCommit | null>(null);
  const [confirmPushed, setConfirmPushed] = useState(false);
  // 勾上"修改上一次提交"之前输入框里的内容和预填的内容：取消勾选时若预填没被改过就还原。
  const stash = useRef<{
    summary: string;
    description: string;
    prefill: { summary: string; description: string };
  } | null>(null);
  const canCommit = !busy && !loadingLast && summary.trim() !== "";

  const toggleAmend = async (on: boolean) => {
    if (!on) {
      const saved = stash.current;
      stash.current = null;
      setAmend(false);
      setLast(null);
      if (saved !== null && summary === saved.prefill.summary && description === saved.prefill.description) {
        setSummary(saved.summary);
        setDescription(saved.description);
      }
      return;
    }
    setLoadingLast(true);
    try {
      const info = await window.studio.getLastCommit(taskId);
      if (info === null) {
        pushToast({ level: "warning", message: t("git.commit.noPrevious") });
        return;
      }
      const prefill = splitCommitMessage(info.message);
      stash.current = { summary, description, prefill };
      setSummary(prefill.summary);
      setDescription(prefill.description);
      setLast(info);
      setAmend(true);
    } catch (error) {
      reportError(t, error);
    } finally {
      setLoadingLast(false);
    }
  };

  const doCommit = async () => {
    setBusy(true);
    const committed = await commitChanges(t, taskId, composeCommitMessage(summary, description), stageAll, amend);
    setBusy(false);
    if (committed) {
      setSummary("");
      setDescription("");
      setAmend(false);
      setLast(null);
      stash.current = null;
    }
    onCommitted();
  };
  const submit = () => {
    if (!canCommit) return;
    if (amend && last?.pushed) setConfirmPushed(true);
    else void doCommit();
  };

  return (
    <section className="rv-commit" aria-label={t("git.commit.title")} data-testid="review-commit">
      <CommitMessageFields
        taskId={taskId}
        testIdPrefix="review-commit"
        heading={<h3 className="rv-commit-title">{t("git.commit.title")}</h3>}
        stagedCount={stagedCount}
        busy={busy}
        summary={summary}
        description={description}
        onSummaryChange={setSummary}
        onDescriptionChange={setDescription}
        onSubmit={submit}
      />
      <div className="rv-commit-foot">
        <span className="rv-commit-opts">
          <Checkbox checked={stageAll} onChange={setStageAll} testId="review-commit-stage-all">
            {t("git.commit.stageAll")}
          </Checkbox>
          <Checkbox
            checked={amend}
            disabled={busy || loadingLast}
            onChange={(on) => void toggleAmend(on)}
            testId="review-commit-amend"
          >
            {t("review.commitAmend")}
          </Checkbox>
        </span>
        <Button
          variant="primary"
          size="sm"
          testId="review-commit-submit"
          loading={busy}
          disabled={summary.trim() === ""}
          onClick={submit}
        >
          {amend ? t("review.commitAmendConfirm") : t("git.commit.confirm")}
        </Button>
      </div>
      {confirmPushed && (
        <ConfirmDialog
          danger
          testId="review-amend-dialog"
          title={t("review.amendPushedTitle")}
          body={t("review.amendPushedBody")}
          confirmLabel={t("review.commitAmendConfirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setConfirmPushed(false);
            void doCommit();
          }}
          onCancel={() => setConfirmPushed(false)}
        />
      )}
    </section>
  );
}
