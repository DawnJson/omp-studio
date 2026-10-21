// 子代理详情：状态和操作（结束 / 恢复）、统计、任务说明、最终输出、对话记录（默认折叠）、插话框。
// 统计来自文档里的 `agent` 节点；最终输出（`.md`）和记录（会话文件）经 IPC 只读 omp 的存档。
import { useMemo, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { isAgentActive, type HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { applyTranscriptEvent, emptyTranscript } from "../../../../shared/transcript.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { Markdown } from "../../markdown/index.ts";
import { formatDuration } from "../conversation/format.ts";
import { buildTurns } from "../conversation/model.ts";
import { ProcessDetails } from "../conversation/ProcessDetails.tsx";
import { formatCost, formatTokens, shortModel } from "./format.ts";
import { agentElapsed, canKill, canRevive, canSteer, dotStatus, statusKey } from "./agent-model.ts";
import { killAgent, reviveAgent } from "./agents-actions.ts";
import { SteerBox } from "./SteerBox.tsx";
import { useAgentRecord, type AgentRecordState } from "./use-agent-record.ts";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lane-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
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
        className="lane-btn"
        data-danger
        data-testid="agents-kill"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {t("agents.kill")}
      </button>
    );
  return (
    <div className="lane-confirm" role="alertdialog" aria-label={t("agents.kill")} data-testid="agents-kill-confirm">
      <span>{t("agents.killConfirm", { name })}</span>
      <button
        type="button"
        className="lane-btn"
        data-danger
        data-testid="agents-kill-yes"
        onClick={() => {
          setConfirming(false);
          void killAgent(t, taskId, name);
        }}
      >
        {t("agents.killConfirmYes")}
      </button>
      <button type="button" className="lane-btn" onClick={() => setConfirming(false)}>
        {t("agents.killConfirmNo")}
      </button>
    </div>
  );
}

function RecordSection({ taskId, state }: { taskId: TaskId; state: AgentRecordState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { record, loading, error, reload } = state;
  const messages = record?.messages ?? null;
  const turns = useMemo(
    () =>
      open && messages !== null
        ? buildTurns(applyTranscriptEvent(emptyTranscript(), { type: "history", messages }))
        : [],
    [open, messages],
  );
  return (
    <details
      className="agents-record"
      data-testid="agents-record"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("agents.record")}</summary>
      {open && (
        <div className="lane-record">
          <button type="button" className="lane-btn" onClick={reload}>
            {t("agents.recordRefresh")}
          </button>
          {loading && record === null && <p className="lane-muted">{t("agents.recordLoading")}</p>}
          {error !== null && <p className="lane-muted">{t("agents.recordError", { message: error })}</p>}
          {record?.unavailable === "no_session" && <p className="lane-muted">{t("agents.recordNoSession")}</p>}
          {record?.unavailable === "no_file" && <p className="lane-muted">{t("agents.recordNoFile")}</p>}
          {record?.unavailable === "error" && (
            <p className="lane-muted">{t("agents.recordError", { message: record.error ?? "" })}</p>
          )}
          {record?.truncated === true && <p className="lane-muted">{t("agents.recordTruncated")}</p>}
          {turns.map((turn) => (
            <div key={turn.key} className="lane-record-turn">
              {turn.steps.length > 0 && <ProcessDetails steps={turn.steps} taskId={taskId} />}
              {turn.answer && (
                <div className="lane-answer">
                  <Markdown source={turn.answer.text} streaming={false} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

export function AgentDetail({
  taskId,
  agent,
  busy,
  onClose,
}: {
  taskId: TaskId;
  agent: HubAgent;
  /** 主进程正在后台驱动 Hub（对任何子代理）：操作都先停用。 */
  busy: boolean;
  onClose(): void;
}) {
  const t = useT();
  const recordState = useAgentRecord(taskId, agent.name, agent.status);
  const { record } = recordState;
  const elapsed = agentElapsed(agent);
  const output = record?.output?.trim() ?? "";
  const stats = agent.stats;
  return (
    <section
      className="lane-detail agents-detail"
      data-testid="agents-detail"
      data-name={agent.name}
      aria-label={agent.name}
    >
      <header className="lane-detail-head">
        <span className="lane-dot" data-status={dotStatus(agent.status)} aria-hidden="true" />
        <span className="lane-detail-name">{agent.name}</span>
        <span className="lane-detail-status" data-status={agent.status === "failed" ? "failed" : undefined}>
          {t(statusKey(agent.status))}
        </span>
        <button type="button" className="lane-icon-btn" aria-label={t("agents.pick")} onClick={onClose}>
          <Close size={14} />
        </button>
      </header>

      <dl className="lane-stats">
        {stats.cost !== null && <Stat label={t("agents.cost")} value={formatCost(stats.cost)} />}
        {stats.tokens !== null && <Stat label={t("agents.tokens")} value={formatTokens(stats.tokens)} />}
        {stats.requests !== null && <Stat label={t("agents.requests")} value={String(stats.requests)} />}
        {stats.tools !== null && <Stat label={t("agents.tools")} value={String(stats.tools)} />}
        {elapsed !== null && <Stat label={t("agents.time")} value={formatDuration(t, elapsed)} />}
        {stats.contextLabel !== null && <Stat label={t("agents.context")} value={stats.contextLabel} />}
        {agent.model !== null && <Stat label={t("agents.model")} value={shortModel(agent.model)} />}
      </dl>

      {agent.task !== "" && (
        <div className="lane-block">
          <h4>{t("agents.task")}</h4>
          <p className="lane-clamp" title={agent.task}>
            {agent.task}
          </p>
        </div>
      )}

      <div className="lane-block" data-testid="agents-output">
        <h4>{t("agents.output")}</h4>
        {output !== "" ? (
          <div className="lane-summary">
            <Markdown source={output} streaming={false} />
          </div>
        ) : (
          <p className="lane-muted">
            {isAgentActive(agent.status) ? t("agents.outputRunning") : t("agents.outputNone")}
          </p>
        )}
      </div>

      <RecordSection taskId={taskId} state={recordState} />

      <footer className="lane-actions agents-actions">
        {canKill(agent.status) && <KillControl taskId={taskId} name={agent.name} busy={busy} />}
        {canRevive(agent.status) && (
          <button
            type="button"
            className="lane-btn"
            data-testid="agents-revive"
            disabled={busy}
            onClick={() => void reviveAgent(t, taskId, agent.name)}
          >
            {t("agents.revive")}
          </button>
        )}
      </footer>
      {canSteer(agent.status) && <SteerBox taskId={taskId} name={agent.name} busy={busy} />}
    </section>
  );
}
