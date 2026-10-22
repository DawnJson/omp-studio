// 子代理详情（列表下方，不再套一层卡片）：头行 = 名字 + 模型 + 结束 / 恢复；一排统计（数字在上、标签在下）；
// 任务说明（Markdown，默认四行，可展开）；最终输出；对话记录（默认折叠）。状态在选中的那一行上，这里不重复。
// 统计来自文档里的 `agent` 节点；最终输出（`.md`）和记录（会话文件）经 IPC 只读 omp 的存档。插话框在面板底部（AgentsPanel）。
import { useMemo, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { isAgentActive, type HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight } from "../../icons.tsx";
import { Markdown } from "../../markdown/index.ts";
import { formatDuration } from "../conversation/format.ts";
import { buildTurns } from "../conversation/model.ts";
import { ProcessDetails } from "../conversation/ProcessDetails.tsx";
import { formatCost, formatTokens, shortModel } from "./format.ts";
import { agentElapsed, agentProgress, canKill, canRevive, cleanTask } from "./agent-model.ts";
import { killAgent, reviveAgent } from "./agents-actions.ts";
import { useAgentRecord, type AgentRecordState } from "./use-agent-record.ts";

/** 任务说明超过这么多字才折叠成四行、给"展开"：短的直接显示全文。 */
const TASK_CLAMP_CHARS = 240;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="agents-stat">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function KillControl({ taskId, name, busy }: { taskId: TaskId; name: string; busy: boolean }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button
        type="button"
        className="agents-btn"
        data-danger
        data-testid="agents-kill"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {t("agents.kill")}
      </button>
    );
  return (
    <div className="agents-confirm" role="alertdialog" aria-label={t("agents.kill")} data-testid="agents-kill-confirm">
      <span>{t("agents.killConfirm", { name })}</span>
      <span className="agents-confirm-actions">
        <button type="button" className="agents-btn" onClick={() => setConfirming(false)}>
          {t("agents.killConfirmNo")}
        </button>
        <button
          type="button"
          className="agents-btn"
          data-danger
          data-testid="agents-kill-yes"
          onClick={() => {
            setConfirming(false);
            void killAgent(t, taskId, name);
          }}
        >
          {t("agents.killConfirmYes")}
        </button>
      </span>
    </div>
  );
}

/** text：任务说明原文（带换行的 Markdown）；omp 没给原文时是压成一行、去掉 # 的说明。 */
function TaskBlock({ text }: { text: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > TASK_CLAMP_CHARS;
  return (
    <div className="agents-block">
      <h4>{t("agents.task")}</h4>
      <div className="agents-task" data-clamped={long && !expanded ? "" : undefined}>
        <Markdown source={text} streaming={false} />
      </div>
      {long && (
        <button type="button" className="agents-link" onClick={() => setExpanded((value) => !value)}>
          {t(expanded ? "common.collapse" : "common.expand")}
        </button>
      )}
    </div>
  );
}

function RecordSection({ taskId, state, live }: { taskId: TaskId; state: AgentRecordState; live: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { record, loading, error, reload } = state;
  const messages = record?.messages ?? null;
  const turns = useMemo(() => (open && messages !== null ? buildTurns(messages, live) : []), [open, messages, live]);
  return (
    <div className="agents-record" data-testid="agents-record">
      <div className="agents-record-head">
        <button
          type="button"
          className="agents-disclosure"
          aria-expanded={open}
          data-testid="agents-record-toggle"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight size={14} className="icon agents-chevron" data-open={open || undefined} />
          {t("agents.record")}
        </button>
        {open && (
          <button type="button" className="agents-link" onClick={reload}>
            {t("agents.recordRefresh")}
          </button>
        )}
      </div>
      {open && (
        <div className="agents-record-body">
          {loading && record === null && <p className="agents-muted">{t("agents.recordLoading")}</p>}
          {error !== null && <p className="agents-muted">{t("agents.recordError", { message: error })}</p>}
          {record?.unavailable === "no_session" && <p className="agents-muted">{t("agents.recordNoSession")}</p>}
          {record?.unavailable === "no_file" && <p className="agents-muted">{t("agents.recordNoFile")}</p>}
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
      )}
    </div>
  );
}

export function AgentDetail({ taskId, agent, busy }: { taskId: TaskId; agent: HubAgent; busy: boolean }) {
  const t = useT();
  // 运行中每多一次工具调用重读一次记录（omp 的 Hub 也是实时的"最近活动"）；结束时再读一次拿最终输出。
  const recordState = useAgentRecord(taskId, agent.name, `${agent.status}:${agent.stats.tools ?? 0}`);
  const { record } = recordState;
  const elapsed = agentElapsed(agent);
  const output = record?.output?.trim() ?? "";
  const stats = agent.stats;
  const progress = agentProgress(agent);
  return (
    <section className="agents-detail" data-testid="agents-detail" data-name={agent.name} aria-label={agent.name}>
      <header className="agents-detail-head">
        <span className="agents-detail-title">
          <span className="agents-detail-name">{agent.name}</span>
          {agent.model !== null && (
            <span className="agents-detail-model" title={agent.model}>
              {shortModel(agent.model)}
            </span>
          )}
        </span>
        {canKill(agent.status) && <KillControl taskId={taskId} name={agent.name} busy={busy} />}
        {canRevive(agent.status) && (
          <button
            type="button"
            className="agents-btn"
            data-testid="agents-revive"
            disabled={busy}
            onClick={() => void reviveAgent(t, taskId, agent.name)}
          >
            {t("agents.revive")}
          </button>
        )}
      </header>

      <dl className="agents-stats">
        {progress !== null && <Stat label={t("agents.progress")} value={`${progress}%`} />}
        {stats.cost !== null && <Stat label={t("agents.cost")} value={formatCost(stats.cost)} />}
        {stats.tokens !== null && <Stat label={t("agents.tokens")} value={formatTokens(stats.tokens)} />}
        {stats.requests !== null && <Stat label={t("agents.requests")} value={String(stats.requests)} />}
        {stats.tools !== null && <Stat label={t("agents.tools")} value={String(stats.tools)} />}
        {elapsed !== null && <Stat label={t("agents.time")} value={formatDuration(t, elapsed)} />}
        {stats.contextLabel !== null && <Stat label={t("agents.context")} value={stats.contextLabel} />}
      </dl>

      {agent.task !== "" && <TaskBlock text={agent.assignment ?? cleanTask(agent.task)} />}

      <div className="agents-block" data-testid="agents-output">
        <h4>{t("agents.output")}</h4>
        {output !== "" ? (
          <div className="agents-output">
            <Markdown source={output} streaming={false} />
          </div>
        ) : (
          <p className="agents-muted">
            {isAgentActive(agent.status) ? t("agents.outputRunning") : t("agents.outputNone")}
          </p>
        )}
      </div>

      <RecordSection taskId={taskId} state={recordState} live={isAgentActive(agent.status)} />
    </section>
  );
}
