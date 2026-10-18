// 子代理详情（泳道下方就地展开）：费用 / token / 摘要、完整记录、只看它的改动，以及 steer / cancel。
// 完整记录来自 get_subagent_messages，用和主对话同一套 model.ts 整理成"轮"，复用 ProcessDetails 渲染工具行。
import { useMemo, useState, type KeyboardEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import { applyTranscriptEvent, emptyTranscript } from "../../../../shared/transcript.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { Markdown } from "../../markdown/index.ts";
import { reportError } from "../../ui/errors.ts";
import { ChangeCard } from "../conversation/ChangeCard.tsx";
import { formatDuration } from "../conversation/format.ts";
import { buildTurns } from "../conversation/model.ts";
import { ProcessDetails } from "../conversation/ProcessDetails.tsx";
import { useNow } from "../conversation/use-now.ts";
import type { FileChange } from "../conversation/tool-info.ts";
import { pushToast } from "../dialogs/index.ts";
import { formatCost, formatTokens, modelLine, statusLabel } from "./format.ts";
import { useSubagentDetail } from "./use-subagent-detail.ts";

type Tab = "record" | "changes";

/** 多轮记录里同一个文件的改动合并（行数累加；任何一处未知则保持未知）。 */
function mergeChanges(lists: readonly (readonly FileChange[])[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const change of lists.flat()) {
    const old = byPath.get(change.path);
    byPath.set(
      change.path,
      old
        ? {
            path: change.path,
            added: old.added === null || change.added === null ? null : old.added + change.added,
            removed: old.removed === null || change.removed === null ? null : old.removed + change.removed,
          }
        : change,
    );
  }
  return [...byPath.values()];
}

function Stat({ label, value, title }: { label: string; value: string; title?: string | undefined }) {
  return (
    <div className="lane-stat" title={title}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SteerForm({ taskId, lane }: { taskId: TaskId; lane: SubagentLane }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = () => {
    const message = text.trim();
    if (message === "" || sending) return;
    setSending(true);
    window.studio.steerSubagent(taskId, lane.id, message).then(
      () => {
        setText("");
        setSending(false);
        pushToast({ level: "info", message: t("lanes.steerSent", { name: lane.id }) });
      },
      (error: unknown) => {
        setSending(false);
        reportError(t, error, t("lanes.steerFailed"));
      },
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <div className="lane-steer" data-testid="lane-steer">
      <input
        className="lane-steer-input"
        value={text}
        placeholder={t("lanes.steerPlaceholder")}
        aria-label={t("lanes.steerLabel", { name: lane.id })}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="lane-btn" disabled={sending || text.trim() === ""} onClick={send}>
        {t("lanes.steerSend")}
      </button>
    </div>
  );
}

function CancelControl({ taskId, lane }: { taskId: TaskId; lane: SubagentLane }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    setBusy(true);
    window.studio.cancelSubagent(taskId, lane.id).then(
      (cancelled) => {
        setBusy(false);
        setConfirming(false);
        if (!cancelled) pushToast({ level: "warning", message: t("lanes.cancelNotDone") });
      },
      (error: unknown) => {
        setBusy(false);
        setConfirming(false);
        reportError(t, error, t("lanes.cancelFailed"));
      },
    );
  };
  if (!confirming)
    return (
      <button
        type="button"
        className="lane-btn"
        data-danger
        data-testid="lane-cancel"
        onClick={() => setConfirming(true)}
      >
        {t("lanes.cancelAgent")}
      </button>
    );
  return (
    <div
      className="lane-confirm"
      role="alertdialog"
      aria-label={t("lanes.cancelAgent")}
      data-testid="lane-cancel-confirm"
    >
      <span>{t("lanes.cancelConfirm", { name: lane.id })}</span>
      <button
        type="button"
        className="lane-btn"
        data-danger
        disabled={busy}
        data-testid="lane-cancel-yes"
        onClick={cancel}
      >
        {t("lanes.cancelConfirmYes")}
      </button>
      <button type="button" className="lane-btn" disabled={busy} onClick={() => setConfirming(false)}>
        {t("lanes.cancelConfirmNo")}
      </button>
    </div>
  );
}

export function SubagentDetailPanel({
  taskId,
  lane,
  projectPath,
  onClose,
}: {
  taskId: TaskId;
  lane: SubagentLane;
  projectPath: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("record");
  const { detail, loading, error } = useSubagentDetail(taskId, lane);
  const now = useNow(lane.status === "running");
  const messages = detail?.messages ?? null;
  const turns = useMemo(
    () => (messages === null ? [] : buildTurns(applyTranscriptEvent(emptyTranscript(), { type: "history", messages }))),
    [messages],
  );
  const changes = useMemo(
    () =>
      messages === null
        ? lane.touched.map((path) => ({ path, added: null, removed: null }))
        : mergeChanges(turns.map((turn) => turn.changes)),
    [messages, turns, lane.touched],
  );
  const answer = [...turns].reverse().find((turn) => turn.answer !== null)?.answer?.text ?? null;
  const model = modelLine(lane);
  const duration = lane.durationMs ?? (lane.endedAt ?? now) - lane.startedAt;
  const context =
    lane.contextTokens !== null
      ? lane.contextWindow !== null
        ? `${formatTokens(lane.contextTokens)} / ${formatTokens(lane.contextWindow)}`
        : formatTokens(lane.contextTokens)
      : null;

  return (
    <section className="lane-detail" data-testid="lane-detail" data-lane={lane.id} aria-label={lane.id}>
      <header className="lane-detail-head">
        <span className="lane-dot" data-status={lane.status} aria-hidden="true" />
        <span className="lane-detail-name">{lane.id}</span>
        <span className="lane-detail-status" data-status={lane.status}>
          {statusLabel(t, lane.status)}
        </span>
        <button type="button" className="lane-icon-btn" aria-label={t("lanes.close")} onClick={onClose}>
          <Close size={14} />
        </button>
      </header>

      <dl className="lane-stats">
        <Stat label={t("lanes.cost")} value={formatCost(lane.cost)} />
        <Stat label={t("lanes.tokens")} value={formatTokens(lane.tokens)} title={lane.tokens.toLocaleString("en-US")} />
        <Stat label={t("lanes.requests")} value={String(lane.requests)} />
        <Stat label={t("lanes.tools")} value={String(lane.toolCount)} />
        <Stat label={t("lanes.duration")} value={formatDuration(t, duration)} />
        {context !== null && <Stat label={t("lanes.context")} value={context} />}
        {model !== null && (
          <Stat
            label={t("lanes.model")}
            value={lane.modelIsFallback ? `${model} (${t("lanes.fallback")})` : model}
            title={lane.model ?? undefined}
          />
        )}
      </dl>

      {(lane.task !== null || lane.assignment !== null) && (
        <div className="lane-block">
          <h4>{t("lanes.task")}</h4>
          <p className="lane-clamp" title={lane.assignment ?? lane.task ?? undefined}>
            {lane.task ?? lane.assignment}
          </p>
        </div>
      )}
      <div className="lane-block" data-testid="lane-summary">
        <h4>{t("lanes.summary")}</h4>
        {answer !== null ? (
          <div className="lane-summary">
            <Markdown source={answer} streaming={false} />
          </div>
        ) : (
          <p className="lane-muted">{lane.lastIntent ?? t("lanes.noSummary")}</p>
        )}
      </div>

      <div className="segments lane-tabs" role="tablist">
        {(["record", "changes"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="segment"
            aria-selected={tab === id}
            data-checked={tab === id || undefined}
            data-testid={`lane-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {t(id === "record" ? "lanes.tabRecord" : "lanes.tabChanges")}
            {id === "changes" && changes.length > 0 ? ` · ${changes.length}` : ""}
          </button>
        ))}
      </div>

      {tab === "record" && (
        <div className="lane-record" data-testid="lane-record">
          {loading && detail === null && <p className="lane-muted">{t("lanes.loading")}</p>}
          {error !== null && <p className="lane-muted">{t("lanes.recordError", { message: error })}</p>}
          {detail?.unavailable === "no_process" && <p className="lane-muted">{t("lanes.noProcess")}</p>}
          {detail?.unavailable === "error" && (
            <p className="lane-muted">{t("lanes.recordError", { message: detail.error ?? "" })}</p>
          )}
          {detail?.truncated === true && <p className="lane-muted">{t("lanes.truncated")}</p>}
          {turns.map((turn) => (
            <div key={turn.key} className="lane-record-turn">
              {turn.steps.length > 0 && <ProcessDetails steps={turn.steps} />}
              {turn.answer && (
                <div className="lane-answer">
                  <Markdown source={turn.answer.text} streaming={false} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "changes" && (
        <div className="lane-changes" data-testid="lane-changes">
          {messages === null && changes.length > 0 && <p className="lane-muted">{t("lanes.changesFromTools")}</p>}
          {changes.length === 0 ? (
            <p className="lane-muted">{t("lanes.noChanges")}</p>
          ) : (
            <ChangeCard changes={changes} taskId={taskId} projectPath={projectPath} review={false} />
          )}
        </div>
      )}

      {lane.status === "running" && (
        <footer className="lane-actions">
          <SteerForm taskId={taskId} lane={lane} />
          <CancelControl taskId={taskId} lane={lane} />
        </footer>
      )}
    </section>
  );
}
