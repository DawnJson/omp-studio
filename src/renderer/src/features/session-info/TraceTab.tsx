// 请求记录页（/trace）：这个会话每次模型请求一行（时间、模型、输入/输出 token、费用、结果），从新到旧。
// 来自 omp 的统计库（messages + tool_calls），所以只含已同步的部分。首字耗时、输出速度、缓存、服务等级、工具调用折在每行的"详情"里（遥测克制）。
import { useId, useState } from "react";
import type { SessionTrace, TraceRequest } from "../../../../shared/ipc.ts";
import { isFailedRequest, stopKind, summarizeTrace, tokensPerSecond } from "../../../../shared/ui/session-trace.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { Button, Disclosure, Notice } from "../../ui/controls.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { formatCount, formatMoney } from "../composer/usage-format.ts";
import type { SyncedRead } from "./use-synced-read.ts";

/** 毫秒 → "5.7s"；不到 1 秒写成 "320ms"。 */
function formatSeconds(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function RequestRow({ request }: { request: TraceRequest }) {
  const t = useT();
  const locale = useLocale();
  const kind = stopKind(request.stopReason);
  const failed = isFailedRequest(request);
  const speed = tokensPerSecond(request);
  const time = new Date(request.timestamp).toLocaleTimeString(locale, { hour12: false });
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const hasDetails =
    request.durationMs !== null ||
    request.ttftMs !== null ||
    request.cacheRead + request.cacheWrite > 0 ||
    request.serviceTier !== null ||
    request.tools.length > 0 ||
    request.errorMessage !== null;
  return (
    <li className="si-trace-item" data-testid="trace-row" data-failed={failed || undefined}>
      <div className="si-trace-row">
        <span className="si-num" title={new Date(request.timestamp).toLocaleString(locale)}>
          {time}
        </span>
        <span title={`${request.provider}/${request.model}`}>
          {request.model}
          {request.agentType !== "main" && (
            <span className="si-note"> · {t("sessionInfo.trace.agent", { name: request.agentType })}</span>
          )}
        </span>
        <span className="si-num">
          {formatCount(request.input)} / {formatCount(request.output)}
        </span>
        <span className="si-num">{formatMoney(request.costUsd)}</span>
        <span className="si-stop" data-kind={failed ? "error" : undefined}>
          {kind === null ? request.stopReason : t(`sessionInfo.stop.${kind}`)}
        </span>
      </div>
      {hasDetails && (
        <div className="si-details">
          <div className="si-details-head">
            <Disclosure
              expanded={open}
              onToggle={() => setOpen((value) => !value)}
              controls={bodyId}
              testId="trace-details-toggle"
            >
              {t("sessionInfo.trace.details")}
            </Disclosure>
          </div>
          <Reveal open={open} id={bodyId}>
            <div className="si-details-body">
              <span>
                {[
                  request.durationMs !== null &&
                    t("sessionInfo.trace.duration", { value: formatSeconds(request.durationMs) }),
                  request.ttftMs !== null && t("sessionInfo.trace.ttft", { value: formatSeconds(request.ttftMs) }),
                  speed !== null && t("sessionInfo.trace.speed", { value: speed.toFixed(1) }),
                ]
                  .filter((part) => typeof part === "string")
                  .join(" · ")}
              </span>
              {request.cacheRead + request.cacheWrite > 0 && (
                <span>
                  {t("sessionInfo.trace.cache", {
                    read: formatCount(request.cacheRead),
                    write: formatCount(request.cacheWrite),
                  })}
                </span>
              )}
              {request.serviceTier !== null && (
                <span>{t("sessionInfo.trace.tier", { tier: request.serviceTier })}</span>
              )}
              {request.tools.length > 0 && (
                <span>
                  {t("sessionInfo.trace.tools")}:{" "}
                  {request.tools
                    .map((tool) => `${tool.name}${tool.isError === true ? t("sessionInfo.trace.toolError") : ""}`)
                    .join(", ")}
                </span>
              )}
              {request.errorMessage !== null && <span className="si-details-error">{request.errorMessage}</span>}
            </div>
          </Reveal>
        </div>
      )}
    </li>
  );
}

export function TraceTab({ read }: { read: SyncedRead<SessionTrace> }) {
  const t = useT();
  const trace = read.data;
  if (read.error !== null && trace === null)
    return <Notice tone="error">{t("sessionInfo.loadFailed", { message: describeError(t, read.error) })}</Notice>;
  if (trace === null) return <p className="si-note">{t("sessionInfo.loading")}</p>;
  const summary = summarizeTrace(trace.requests);
  return (
    <>
      <div className="si-trace-summary">
        <span data-testid="trace-summary">
          {t("sessionInfo.trace.summary", {
            requests: summary.requests,
            failed: summary.failed,
            tools: summary.toolCalls,
            cost: formatMoney(summary.costUsd),
          })}
        </span>
        <Button variant="quiet" size="sm" disabled={read.syncing} onClick={read.refresh}>
          {t("sessionInfo.usage.refresh")}
        </Button>
      </div>
      {read.syncing && <p className="si-note">{t("sessionInfo.usage.syncing")}</p>}
      {read.syncError !== null && (
        <Notice tone="error">{t("sessionInfo.usage.syncFailed", { message: describeError(t, read.syncError) })}</Notice>
      )}
      {trace.requests.length === 0 && !read.syncing && (
        <p className="si-note" data-testid="trace-empty">
          {trace.hasDatabase ? t("sessionInfo.trace.empty") : t("sessionInfo.usage.noDatabase")}
        </p>
      )}
      {trace.requests.length > 0 && (
        <ul className="si-trace" data-testid="trace-list">
          <li className="si-trace-head" aria-hidden="true">
            <span>{t("sessionInfo.trace.col.time")}</span>
            <span>{t("sessionInfo.trace.col.model")}</span>
            <span>{t("sessionInfo.trace.col.tokens")}</span>
            <span>{t("sessionInfo.trace.col.cost")}</span>
            <span>{t("sessionInfo.trace.col.stop")}</span>
          </li>
          {trace.requests.map((request) => (
            <RequestRow key={request.entryId} request={request} />
          ))}
        </ul>
      )}
      {trace.truncated && (
        <p className="si-note">{t("sessionInfo.trace.truncated", { count: trace.requests.length })}</p>
      )}
    </>
  );
}
