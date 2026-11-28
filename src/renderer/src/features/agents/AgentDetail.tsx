// 子代理详情（列表下方，不再套一层卡片）：头行 = 名字 + 模型 + 思考强度 + 结束 / 恢复；一排统计（数字在上、标签在下；用时在列表行上）；
// 任务说明（Markdown 全文）；最终输出；对话记录（omp Hub 详情里的 Recent activity；默认收起，工具调用的细节点开才看，仓库所有者 2026-10-27）。
// 状态在选中的那一行上，这里不重复。
// 统计来自文档里的 `agent` 节点；最终输出（`.md`）和记录（会话文件）经 IPC 只读 omp 的存档。插话框在面板底部（AgentsPanel）。
import { useMemo, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { isAgentActive, type HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { Markdown } from "../../markdown/index.ts";
import { Badge, Button, Disclosure, SectionHead } from "../../ui/controls.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { thinkingLabel } from "../composer/thinking-levels.ts";
import { buildTurns } from "../conversation/model.ts";
import { ProcessDetails } from "../conversation/ProcessDetails.tsx";
import { formatCount } from "../composer/usage-format.ts";
import { formatCost } from "../tsp/fmt.ts";
import { shortModel } from "./format.ts";
import {
  agentContextPercent,
  agentProgress,
  canFocus,
  canKill,
  canRevive,
  cleanTask,
  hubStatus,
} from "./agent-model.ts";
import { focusAgent, killAgent, reviveAgent } from "./agents-actions.ts";
import { useAgentRecord, type AgentRecordState } from "./use-agent-record.ts";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="agents-stat" data-testid="agents-stat" data-accent={accent || undefined}>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function KillControl({ taskId, name, busy }: { taskId: TaskId; name: string; busy: boolean }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="ui-popover-anchor agents-kill">
      <Button
        variant="danger"
        size="sm"
        testId="agents-kill"
        disabled={busy}
        aria-expanded={confirming}
        onClick={() => setConfirming((value) => !value)}
      >
        {t("agents.kill")}
      </Button>
      <Popover
        open={confirming}
        onClose={() => setConfirming(false)}
        kind="confirm"
        align="end"
        label={t("agents.kill")}
      >
        <div data-testid="agents-kill-confirm">
          <p className="ui-pop-title">{t("agents.kill")}</p>
          <p className="ui-pop-body">{t("agents.killConfirm", { name })}</p>
          <div className="ui-pop-actions">
            <Button size="sm" autoFocus onClick={() => setConfirming(false)}>
              {t("agents.killConfirmNo")}
            </Button>
            <Button
              variant="danger-solid"
              size="sm"
              testId="agents-kill-yes"
              onClick={() => {
                setConfirming(false);
                void killAgent(t, taskId, name);
              }}
            >
              {t("agents.killConfirmYes")}
            </Button>
          </div>
        </div>
      </Popover>
    </span>
  );
}

/** text：任务说明原文（带换行的 Markdown）；omp 没给原文时是压成一行、去掉 # 的说明。全文显示，同 omp 的 Hub。 */
function TaskBlock({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="agents-block">
      <SectionHead title={t("agents.task")} />
      <div className="agents-task">
        <Markdown source={text} streaming={false} />
      </div>
    </div>
  );
}

function RecordSection({ taskId, state, live }: { taskId: TaskId; state: AgentRecordState; live: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { record, loading, error, reload } = state;
  const messages = record?.messages ?? null;
  const turns = useMemo(() => (messages !== null ? buildTurns(messages, live) : []), [messages, live]);
  return (
    <div className="agents-record" data-testid="agents-record">
      <SectionHead
        title={
          <Disclosure expanded={open} onToggle={() => setOpen((value) => !value)} testId="agents-record-toggle">
            {t("agents.record")}
          </Disclosure>
        }
        actions={
          open ? (
            <Button variant="quiet" size="sm" onClick={reload}>
              {t("agents.recordRefresh")}
            </Button>
          ) : undefined
        }
      />
      <Reveal open={open}>
        <div className="agents-record-body">
          {loading && record === null && <p className="agents-muted">{t("agents.recordLoading")}</p>}
          {error !== null && <p className="agents-muted">{t("agents.recordError", { message: error })}</p>}
          {(record?.unavailable === "no_session" || record?.unavailable === "no_file") && (
            <p className="agents-muted">{t("agents.recordNoFile")}</p>
          )}
          {record?.unavailable === "error" && (
            <p className="agents-muted">{t("agents.recordError", { message: record.error ?? "" })}</p>
          )}
          {record?.truncated === true && <p className="agents-muted">{t("agents.recordTruncated")}</p>}
          {turns.map((turn) => (
            <div key={turn.key} className="agents-record-turn">
              {turn.steps.length > 0 && <ProcessDetails steps={turn.steps} taskId={taskId} />}
              {turn.answer && <Markdown source={turn.answer} streaming={false} />}
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

export function AgentDetail({ taskId, agent, busy }: { taskId: TaskId; agent: HubAgent; busy: boolean }) {
  const t = useT();
  // 运行中每多一次工具调用重读一次记录（omp 的 Hub 也是实时的"最近活动"）；结束时再读一次拿最终输出。
  // 被唤醒的子代理节点不动（issue #23），按记录文件读到的字节数重读。
  const recordState = useAgentRecord(
    taskId,
    agent.name,
    `${agent.status}:${agent.stats.tools ?? 0}:${agent.revived ?? ""}`,
  );
  const { record } = recordState;
  const thinkingKey = agent.thinking === null ? undefined : thinkingLabel[agent.thinking];
  const output = record?.output?.trim() ?? "";
  const stats = agent.stats;
  const progress = agentProgress(agent);
  const context = agentContextPercent(agent);
  const status = hubStatus(agent);
  const showMeta = agent.model !== null || thinkingKey !== undefined || typeof record?.fallbackModel === "string";
  const showActions = canFocus(status) || canKill(status) || canRevive(status);
  const hasMetrics =
    progress !== null ||
    stats.cost !== null ||
    stats.tokens !== null ||
    stats.requests !== null ||
    stats.tools !== null;
  const hasContext = stats.contextLabel !== null || context !== null;
  const contextValue = [context === null ? null : `${context}%`, stats.contextLabel]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <section
      className="agents-detail ui-data-in"
      data-testid="agents-detail"
      data-name={agent.name}
      aria-label={agent.name}
    >
      <header className="agents-detail-head">
        <div className="agents-detail-id">
          <span className="agents-detail-name" title={agent.name}>
            {agent.name}
          </span>
          {showMeta && (
            <span className="agents-detail-meta">
              {agent.model !== null && (
                <span className="agents-detail-model" title={agent.model}>
                  {shortModel(agent.model)}
                </span>
              )}
              {thinkingKey !== undefined && (
                <span className="agents-detail-thinking" data-testid="agents-detail-thinking">
                  {t(thinkingKey)}
                </span>
              )}
              {typeof record?.fallbackModel === "string" && (
                <Badge
                  tone="warning"
                  testId="agents-fallback-badge"
                  title={t("composer.badge.fallbackTip", { model: record.fallbackModel })}
                >
                  {t("composer.badge.fallback")}
                </Badge>
              )}
            </span>
          )}
        </div>
        {showActions && (
          <div className="agents-detail-actions">
            {canFocus(status) && (
              <Button
                size="sm"
                variant="primary"
                testId="agents-focus"
                disabled={busy}
                onClick={() => void focusAgent(t, taskId, agent.name)}
              >
                {t("agents.focus")}
              </Button>
            )}
            {canKill(status) && <KillControl taskId={taskId} name={agent.name} busy={busy} />}
            {canRevive(status) && (
              <Button
                size="sm"
                testId="agents-revive"
                disabled={busy}
                onClick={() => void reviveAgent(t, taskId, agent.name)}
              >
                {t("agents.revive")}
              </Button>
            )}
          </div>
        )}
      </header>

      {(hasMetrics || hasContext) && (
        <div className="agents-stats">
          {hasMetrics && (
            <dl className="agents-stats-row">
              {progress !== null && <Stat label={t("agents.progress")} value={`${progress}%`} accent />}
              {stats.cost !== null && <Stat label={t("agents.cost")} value={formatCost(stats.cost)} />}
              {stats.tokens !== null && <Stat label={t("agents.tokens")} value={formatCount(stats.tokens)} />}
              {stats.requests !== null && <Stat label={t("agents.requests")} value={String(stats.requests)} />}
              {stats.tools !== null && <Stat label={t("agents.tools")} value={String(stats.tools)} />}
            </dl>
          )}
          {hasContext && (
            <div
              className="agents-ctx-meter"
              data-testid="agents-stat"
              data-high={context !== null && context >= 90 ? "true" : undefined}
            >
              <dl className="agents-ctx-meter-top">
                <dt>{t("agents.context")}</dt>
                <dd title={contextValue}>{contextValue}</dd>
              </dl>
              {context !== null && (
                <span className="agents-ctx-meter-track" aria-hidden="true">
                  <i style={{ width: `${Math.max(context > 0 ? 4 : 0, context)}%` }} />
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {agent.task !== "" && <TaskBlock text={agent.assignment ?? cleanTask(agent.task)} />}

      {output !== "" && (
        <div className="agents-block" data-testid="agents-output">
          <SectionHead title={t("agents.output")} />
          <div className="agents-output">
            <Markdown source={output} streaming={false} />
          </div>
        </div>
      )}

      <RecordSection taskId={taskId} state={recordState} live={isAgentActive(agent.status)} />
    </section>
  );
}
