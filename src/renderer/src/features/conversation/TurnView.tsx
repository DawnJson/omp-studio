// 一轮：用户消息 → 过程（工具卡片，默认展开）→ 结论 → 改动卡片 → 提示。
import { memo } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { Markdown } from "../../markdown/index.ts";
import { ChangeCard } from "./ChangeCard.tsx";
import { ExtraView } from "./Extras.tsx";
import { formatElapsed, formatTokenCount, formatTurnCost } from "./tool-view.ts";
import type { Turn } from "./model.ts";
import { ProcessRow } from "./ProcessRow.tsx";
import { UserMessage } from "./UserMessage.tsx";

interface TurnViewProps {
  turn: Turn;
  /** 只有当前正在跑的那一轮为 true；其余轮恒为 false，不会因为任务状态变化重渲染。 */
  live: boolean;
  /** 最近 20 轮之外的已结束轮用 content-visibility 跳过离屏渲染。 */
  offscreenSkippable: boolean;
  taskId: TaskId;
  projectPath: string | null;
  /** 这一轮里开始的子代理（泳道）；没有时是同一个空数组。 */
  lanes: readonly SubagentLane[];
  /** 这一轮是最近一轮、任务空闲且上一次 prompt 以错误结束：最后一条 prompt 错误可以带"重试"。 */
  canRetry: boolean;
}

function AssistantAnswer({ text, streaming, live }: { text: string; streaming: boolean; live: boolean }) {
  const t = useT();
  return (
    <div className="answer" data-live={live || undefined} data-testid="assistant-message">
      <Markdown source={text} streaming={streaming} />
      {!streaming && (
        <button
          type="button"
          className="hover-action answer-copy"
          onClick={() => void navigator.clipboard.writeText(text)}
        >
          {t("common.copy")}
        </button>
      )}
    </div>
  );
}

/** 一轮结束后结论下面的一行小字：32.4s · 19K tokens · $0.01；悬停给输入 / 输出 / 缓存明细。 */
function TurnFooter({ turn }: { turn: Turn }) {
  const t = useT();
  const { input, output, cacheRead, cacheWrite, cost } = turn.usage;
  const duration = turn.endedAt - turn.startedAt;
  const tokens = input + output;
  const price = formatTurnCost(cost);
  const parts = [
    ...(duration > 0 ? [formatElapsed(duration)] : []),
    ...(tokens > 0 ? [t("process.turnTokens", { count: formatTokenCount(tokens) })] : []),
    ...(price !== null ? [price] : []),
  ];
  if (parts.length === 0) return null;
  const number = (value: number) => value.toLocaleString("en-US");
  return (
    <p
      className="turn-footer"
      data-testid="turn-footer"
      title={t("process.turnUsage", {
        duration: formatElapsed(Math.max(0, duration)),
        total: number(tokens),
        input: number(input),
        output: number(output),
        cache: number(cacheRead + cacheWrite),
      })}
    >
      {parts.join(" · ")}
    </p>
  );
}

export const TurnView = memo(function TurnView({
  turn,
  live,
  offscreenSkippable,
  taskId,
  projectPath,
  lanes,
  canRetry,
}: TurnViewProps) {
  const t = useT();
  const complete = !live;
  const lastPromptErrorKey = turn.extras.findLast((extra) => extra.kind === "prompt_error")?.key;
  const noResult = complete && turn.answer === null && (turn.hasAssistantOutput || turn.toolCalls > 0);
  return (
    <section
      className="turn"
      data-turn-key={turn.key}
      data-skippable={(offscreenSkippable && complete) || undefined}
      data-testid="turn"
    >
      {turn.modelSwitch !== null && (
        <div className="model-divider" role="separator">
          <span>{t("model.switchedModel", { model: turn.modelSwitch })}</span>
        </div>
      )}
      {turn.user && <UserMessage user={turn.user} taskId={taskId} />}
      {/* "已附带文件"属于用户这条消息（omp 展开 @路径 生成的），紧跟在它下面；其他附注在一轮末尾。 */}
      {turn.extras
        .filter((extra) => extra.kind === "file_mention")
        .map((extra) => (
          <ExtraView key={extra.key} extra={extra} taskId={taskId} retryable={false} />
        ))}
      <ProcessRow turn={turn} live={live} taskId={taskId} projectPath={projectPath} lanes={lanes} />
      {turn.answer && (
        <AssistantAnswer text={turn.answer.text} streaming={turn.answer.streaming} live={turn.answer.streaming} />
      )}
      {noResult && (
        <p className="note" data-testid="no-result">
          {t("turn.noResult")}
        </p>
      )}
      {complete && turn.runFinished && turn.hasAssistantOutput && <TurnFooter turn={turn} />}
      {complete && turn.runFinished && <ChangeCard changes={turn.changes} taskId={taskId} projectPath={projectPath} />}
      {turn.extras
        .filter((extra) => extra.kind !== "file_mention")
        .map((extra) => (
          <ExtraView
            key={extra.key}
            extra={extra}
            taskId={taskId}
            retryable={canRetry && extra.key === lastPromptErrorKey}
          />
        ))}
    </section>
  );
});
