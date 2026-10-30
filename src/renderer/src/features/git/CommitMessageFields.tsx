// 提交信息表单（提交对话框和评审提交框共用，2026-10-29 起只有这一份）：工具行（已暂存数 / 生成中的"取消"在左，"生成"在右）、摘要、说明。
// 提交信息 = 摘要 + 空行 + 说明（composeCommitMessage），由使用方拼。
// "生成"：让 omp 为已暂存的改动写信息（omp commit --dry-run，主进程运行，可取消），只填进输入框；表单卸载（关掉对话框 / 退出评审）时取消。
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { primaryMod } from "../../app/platform-keys.ts";
import { Sparkle } from "../../icons.tsx";
import { Button, Textarea, TextField } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { generateCommitMessage } from "./git-actions.ts";
import "./git.css";

export function CommitMessageFields({
  taskId,
  testIdPrefix,
  heading,
  autoFocus = false,
  stagedCount,
  busy,
  summary,
  description,
  onSummaryChange,
  onDescriptionChange,
  onSubmit,
}: {
  taskId: TaskId;
  /** `review-commit` / `git-commit`：各元素的 testid 是 `<前缀>-summary` 等。 */
  testIdPrefix: string;
  /** 和工具行同一个头部里的标题（评审左栏有，对话框的标题在对话框外壳上）。 */
  heading?: ReactNode;
  /** 对话框打开时焦点进摘要。 */
  autoFocus?: boolean;
  stagedCount: number;
  /** 提交中：不能生成。 */
  busy: boolean;
  summary: string;
  description: string;
  onSummaryChange(next: string): void;
  onDescriptionChange(next: string): void;
  /** 摘要 / 说明里按 Ctrl Enter。 */
  onSubmit(): void;
}) {
  const t = useT();
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const canGenerate = !busy && !generating && stagedCount > 0;

  // 表单不在了（对话框关掉、评审退出）就别让 omp 白跑。
  useEffect(
    () => () => {
      if (generatingRef.current) void window.studio.cancelCommitMessage(taskId).catch(() => undefined);
    },
    [taskId],
  );

  const generate = async () => {
    if (!canGenerate) return;
    generatingRef.current = true;
    setGenerating(true);
    const result = await generateCommitMessage(t, taskId);
    generatingRef.current = false;
    setGenerating(false);
    if (result !== null) {
      onSummaryChange(result.title);
      onDescriptionChange(result.body);
    }
  };
  const cancelGenerate = () => {
    window.studio.cancelCommitMessage(taskId).catch((error: unknown) => reportError(t, error));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && primaryMod(event) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="git-commit-form">
      <div className="git-commit-head">
        {heading}
        {/* 生成中"取消"顶替已暂存数的位置，按钮保持原宽（loading 只换成转圈），工具行不折行、高度不跳。 */}
        <span className="git-commit-tools">
          {generating ? (
            <Button variant="quiet" size="sm" testId={`${testIdPrefix}-generate-cancel`} onClick={cancelGenerate}>
              {t("git.generate.cancel")}
            </Button>
          ) : (
            <span className="git-commit-staged" data-testid={`${testIdPrefix}-staged`}>
              {t("git.commit.staged", { count: stagedCount })}
            </span>
          )}
          <Button
            size="sm"
            icon={<Sparkle size={14} />}
            testId={`${testIdPrefix}-generate`}
            loading={generating}
            disabled={!canGenerate}
            title={stagedCount === 0 ? t("git.generate.nothing") : t("git.generate.tip")}
            onClick={() => void generate()}
          >
            {t("git.generate.action")}
          </Button>
        </span>
      </div>
      <TextField
        width="100%"
        testId={`${testIdPrefix}-summary`}
        data-autofocus={autoFocus ? "" : undefined}
        aria-label={t("git.commit.summary")}
        placeholder={t("git.commit.summary")}
        value={summary}
        onChange={onSummaryChange}
        onKeyDown={onKeyDown}
      />
      <Textarea
        className="git-commit-description"
        testId={`${testIdPrefix}-description`}
        aria-label={t("git.commit.description")}
        placeholder={t("git.commit.description")}
        rows={3}
        value={description}
        onChange={onDescriptionChange}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
