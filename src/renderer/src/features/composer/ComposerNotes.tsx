// 输入框上方状态行里 omp 状态区的几项（spec §4.14），数据都来自 omp 的 TSP 文档（shared/tsp/composer-facts.ts），动作都是 omp 自己的：
// - 自动重试倒计时：圆环 + "第 2/5 次重试 · 3s" + 取消（点 omp 的 Cancel = 它的 `interrupt` 动作 = Esc）；
// - 压缩：不定进度条 + 取消（omp 的 Stop，同一个 `interrupt` 动作）；
// - 空闲 loader（交接、建 worktree、分支摘要…）：能取消的带取消（发 Esc）；
// - 上一轮被中断（`omp.hint.retry`）：提示 + "重试"（`/retry`，和错误卡上的重试按钮同一个动作）；
// - 扩展 `setStatus` 写的状态：右侧只读小标签，悬停看全文；
// - 聚焦子代理：状态行上方的横幅 + 回到主会话（omp 退出按钮的动作）。
import { useEffect, useRef, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import {
  estimateRetrySeconds,
  type ActionTarget,
  type AutoRetryFact,
  type RetrySample,
} from "../../../../shared/tsp/composer-facts.ts";
import type { FocusView } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { retryTask } from "../session-info/session-info-actions.ts";
import "./composer-notes.css";

/** 点 omp 节点上的动作（和鼠标点它同一个 `action` 事件）。 */
function useClickTarget(taskId: TaskId) {
  const t = useT();
  return (target: ActionTarget) => {
    window.studio
      .sendTspEvent(taskId, { ev: "action", sf: target.sf, id: target.id, act: target.act })
      .catch((error: unknown) => reportError(t, error));
  };
}

/** omp 的 loader 没有按钮可点，取消是 Esc。 */
export function CancelButton({ taskId, target }: { taskId: TaskId; target: ActionTarget | "escape" }) {
  const t = useT();
  const click = useClickTarget(taskId);
  return (
    <Button
      size="sm"
      variant="quiet"
      className="run-cancel"
      testId="run-cancel"
      onClick={() => {
        if (target === "escape")
          window.studio.sendTspKeys(taskId, "\x1b").catch((error: unknown) => reportError(t, error));
        else click(target);
      }}
    >
      {t("modes.cancel")}
    </Button>
  );
}

/** 重试等待的剩余秒数：圆环只给比例，用这次等待里第一次看到的值估总等待（estimateRetrySeconds）；圆环每 0.5 秒动一次，估值跟着更新。 */
function useRetrySeconds({ attempt, remaining }: AutoRetryFact): number | null {
  const first = useRef<{ attempt: number; sample: RetrySample } | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (remaining === null) {
      setSeconds(null);
      return;
    }
    const now: RetrySample = { at: Date.now(), remaining };
    if (first.current?.attempt !== attempt || first.current.sample.remaining < remaining)
      first.current = { attempt, sample: now };
    setSeconds(estimateRetrySeconds(first.current.sample, now));
  }, [attempt, remaining]);
  return seconds;
}

const RING_RADIUS = 5.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** 倒计时圆环（omp 的 `meter style=ring`）：剩余比例从满环走到空。 */
function CountdownRing({ remaining }: { remaining: number }) {
  return (
    <svg
      className="run-ring"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      data-testid="run-retry-ring"
    >
      <circle className="run-ring-track" cx="7" cy="7" r={RING_RADIUS} />
      <circle
        className="run-ring-arc"
        cx="7"
        cy="7"
        r={RING_RADIUS}
        strokeDasharray={`${(RING_LENGTH * remaining).toFixed(2)} ${RING_LENGTH.toFixed(2)}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/** 状态行里"当前活动"的位置：自动重试时换成倒计时。 */
export function RetryActivity({ retry }: { retry: AutoRetryFact }) {
  const t = useT();
  const seconds = useRetrySeconds(retry);
  const params = { attempt: retry.attempt, max: retry.max };
  return (
    <span className="run-activity run-retry" data-testid="run-retry">
      {retry.remaining !== null && <CountdownRing remaining={retry.remaining} />}
      <span data-testid="run-retry-text">
        {seconds === null ? t("modes.retry.status", params) : t("modes.retry.in", { ...params, seconds })}
      </span>
    </span>
  );
}

/** 压缩进行中：不定进度条（omp 的 `progress` 没有 value）。 */
export function IndeterminateBar() {
  return <span className="run-progress" role="progressbar" aria-busy="true" data-testid="run-compaction-bar" />;
}

/** 空闲时 omp 提示上一轮停在工具调用中途："上一轮被中断 [重试]"。 */
export function InterruptedNote({ taskId }: { taskId: TaskId }) {
  const t = useT();
  return (
    <div className="run-main run-interrupted" data-testid="run-interrupted">
      <span className="run-activity">{t("modes.interrupted")}</span>
      <Button size="sm" variant="quiet" testId="run-interrupted-retry" onClick={() => void retryTask(t, taskId)}>
        {t("sessionInfo.retry.button")}
      </Button>
    </div>
  );
}

/** 扩展写的状态：只读小标签，放不下时省略，悬停看全文。 */
export function ExtStatusTags({ statuses }: { statuses: readonly string[] }) {
  const t = useT();
  if (statuses.length === 0) return null;
  return (
    <div className="run-ext" role="group" aria-label={t("modes.ext.aria")} data-testid="run-ext">
      {statuses.map((text, index) => (
        <span key={`${index}:${text}`} className="run-ext-tag" title={text} data-testid="run-ext-tag">
          {text}
        </span>
      ))}
    </div>
  );
}

/** omp 聚焦到某个子代理时：输入框发的话都是给它的。 */
export function FocusBanner({ taskId, focus }: { taskId: TaskId; focus: FocusView }) {
  const t = useT();
  const click = useClickTarget(taskId);
  return (
    <div className="run-focus" role="status" data-testid="run-focus">
      <span className="run-focus-text">{t("modes.focus", { name: focus.name })}</span>
      <Button
        size="sm"
        variant="quiet"
        testId="run-focus-back"
        onClick={() => {
          if (focus.exit !== null) click({ sf: focus.sf, id: focus.exit.id, act: focus.exit.act });
          else window.studio.sendTspKeys(taskId, "\x1b").catch((error: unknown) => reportError(t, error));
        }}
      >
        {t("modes.focus.back")}
      </Button>
    </div>
  );
}
