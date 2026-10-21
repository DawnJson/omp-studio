// 评审左栏底部的提交框：摘要 / 说明 / 提交。走和提交对话框同一条路径（git-actions 的 commitChanges → commitGit），
// 提交信息 = 摘要 + 空行 + 说明（composeCommitMessage）。默认只提交已暂存的文件——评审里暂存是显式的动作，勾上"先暂存全部改动"才会 add -A。
import { useState, type KeyboardEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { composeCommitMessage } from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
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
  const canCommit = !busy && summary.trim() !== "";

  const submit = async () => {
    if (!canCommit) return;
    setBusy(true);
    const committed = await commitChanges(t, taskId, composeCommitMessage(summary, description), stageAll);
    setBusy(false);
    if (committed) {
      setSummary("");
      setDescription("");
    }
    onCommitted();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && event.ctrlKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className="rv-commit" aria-label={t("git.commit.title")} data-testid="review-commit">
      <div className="rv-commit-head">
        <h3 className="rv-commit-title">{t("git.commit.title")}</h3>
        <span className="rv-commit-staged" data-testid="review-commit-staged">
          {t("review.commitStaged", { count: stagedCount })}
        </span>
      </div>
      <input
        type="text"
        className="rv-box-input"
        data-testid="review-commit-summary"
        aria-label={t("review.commitSummary")}
        placeholder={t("review.commitSummaryPlaceholder")}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <textarea
        className="rv-box-input"
        data-testid="review-commit-description"
        aria-label={t("review.commitDescription")}
        placeholder={t("review.commitDescriptionPlaceholder")}
        rows={3}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <label className="rv-commit-check">
        <input
          type="checkbox"
          data-testid="review-commit-stage-all"
          checked={stageAll}
          onChange={(event) => setStageAll(event.target.checked)}
        />
        <span>{t("git.commit.stageAll")}</span>
      </label>
      <button
        type="button"
        className="rv-btn rv-btn-primary"
        data-testid="review-commit-submit"
        disabled={!canCommit}
        onClick={() => void submit()}
      >
        {t("git.commit.confirm")}
      </button>
    </section>
  );
}
