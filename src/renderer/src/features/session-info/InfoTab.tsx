// 会话信息的"概览"页：标题、ID、文件、目录、模型、上下文，置顶开关，以及 omp 统计库里的用量汇总。
// 标题、模型、上下文来自任务状态；ID、文件头、置顶、用量来自主进程（getTaskSessionInfo）。
import { useId, useState } from "react";
import type { TaskSessionInfo, TaskState } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { Button, Notice, SectionHead, Switch } from "../../ui/controls.tsx";
import { formatCount, formatMoney } from "../composer/usage-format.ts";
import { copyText, togglePin } from "./session-info-actions.ts";
import { thinkingLabel } from "../composer/thinking-levels.ts";
import type { SyncedRead } from "./use-synced-read.ts";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function UsageSection({ read }: { read: SyncedRead<TaskSessionInfo> }) {
  const t = useT();
  const locale = useLocale();
  const stats = read.data?.stats;
  const rollup = stats?.rollup ?? null;
  const tokens = stats?.tokens ?? null;
  const date = (ms: number) => new Date(ms).toLocaleString(locale);
  return (
    <section className="si-section" data-testid="si-usage">
      <SectionHead title={t("sessionInfo.usage.title")} />
      {rollup !== null && (
        <dl className="si-grid">
          <Row label={t("sessionInfo.usage.requests")}>
            <span data-testid="si-requests">{rollup.requests}</span>
          </Row>
          <Row label={t("sessionInfo.usage.tokens")}>
            <span data-testid="si-tokens" className="si-num">
              {formatCount(rollup.totalTokens)}
            </span>
            {tokens !== null && (
              <span className="si-note">
                {t("sessionInfo.usage.breakdown", {
                  input: formatCount(tokens.input),
                  output: formatCount(tokens.output),
                  cacheRead: formatCount(tokens.cacheRead),
                  cacheWrite: formatCount(tokens.cacheWrite),
                })}
              </span>
            )}
          </Row>
          <Row label={t("sessionInfo.usage.cost")}>
            <span data-testid="si-cost" className="si-num">
              {formatMoney(rollup.costUsd)}
            </span>
            {rollup.unpriced > 0 && (
              <span className="si-note">{t("sessionInfo.usage.unpriced", { count: rollup.unpriced })}</span>
            )}
          </Row>
          <Row label={t("sessionInfo.usage.toolCalls")}>
            <span className="si-num">{rollup.toolCalls}</span>
          </Row>
          {rollup.models.length > 0 && <Row label={t("sessionInfo.usage.models")}>{rollup.models.join(", ")}</Row>}
          <Row label={t("sessionInfo.row.started")}>
            {t("sessionInfo.usage.range", { from: date(rollup.startedAt), to: date(rollup.endedAt) })}
          </Row>
        </dl>
      )}
      {stats !== undefined && !stats.hasDatabase && <p className="si-note">{t("sessionInfo.usage.noDatabase")}</p>}
      {stats?.hasDatabase === true && rollup === null && !read.syncing && (
        <p className="si-note" data-testid="si-no-rollup">
          {t("sessionInfo.usage.noRollup")}
        </p>
      )}
      <div className="si-sync">
        <span>
          {read.syncing
            ? t("sessionInfo.usage.syncing")
            : read.syncError !== null
              ? t("sessionInfo.usage.syncFailed", { message: describeError(t, read.syncError) })
              : t("sessionInfo.usage.note")}
        </span>
        <Button variant="quiet" size="sm" disabled={read.syncing} onClick={read.refresh}>
          {t("sessionInfo.usage.refresh")}
        </Button>
      </div>
    </section>
  );
}

export function InfoTab({ task, read }: { task: TaskState; read: SyncedRead<TaskSessionInfo> }) {
  const t = useT();
  const locale = useLocale();
  const pinId = useId();
  const [pinBusy, setPinBusy] = useState(false);
  const info = read.data;

  if (read.error !== null && info === null)
    return <Notice tone="error">{t("sessionInfo.loadFailed", { message: describeError(t, read.error) })}</Notice>;
  if (info === null) return <p className="si-note">{t("sessionInfo.loading")}</p>;

  const onPin = async () => {
    setPinBusy(true);
    try {
      await togglePin(t, task.id);
      read.reread();
    } finally {
      setPinBusy(false);
    }
  };
  const header = info.header;
  const model =
    task.model === null ? null : [task.model.name, task.model.key.provider].filter((part) => part !== "").join(" · ");
  const thinkingKey = task.thinkingLevel === null ? undefined : thinkingLabel[task.thinkingLevel];
  const context =
    task.contextUsage === null
      ? null
      : `${formatCount(task.contextUsage.tokens)} / ${formatCount(task.contextUsage.contextWindow)} (${Math.round(task.contextUsage.percent)}%)`;
  const dirs = header?.additionalDirectories ?? [];

  return (
    <>
      <dl className="si-grid" data-testid="si-grid">
        <Row label={t("sessionInfo.row.title")}>{task.title === "" ? "—" : task.title}</Row>
        {info.sessionId !== null && (
          <Row label={t("sessionInfo.row.id")}>
            <span className="si-mono" data-testid="si-id">
              {info.sessionId}
            </span>
            <Button variant="quiet" size="sm" onClick={() => copyText(t, info.sessionId ?? "")}>
              {t("sessionInfo.copy")}
            </Button>
          </Row>
        )}
        {info.sessionFile !== null && (
          <Row label={t("sessionInfo.row.file")}>
            <span className="si-mono" data-testid="si-file">
              {info.sessionFile}
            </span>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => window.studio.revealTaskSession(task.id).catch((error: unknown) => reportError(t, error))}
            >
              {t("sessionInfo.reveal")}
            </Button>
          </Row>
        )}
        <Row label={t("sessionInfo.row.project")}>
          <span className="si-mono">{info.projectPath}</span>
        </Row>
        {task.cwd !== info.projectPath && (
          <Row label={t("sessionInfo.row.cwd")}>
            <span className="si-mono">{task.cwd}</span>
          </Row>
        )}
        {info.worktree !== null && (
          <Row label={t("sessionInfo.row.worktree", { branch: info.worktree.branch, base: info.worktree.base })}>
            <span className="si-mono">{info.worktree.path}</span>
          </Row>
        )}
        {model !== null && <Row label={t("sessionInfo.row.model")}>{model}</Row>}
        {task.thinkingLevel !== null && (
          <Row label={t("sessionInfo.row.thinking")}>
            {thinkingKey === undefined ? task.thinkingLevel : t(thinkingKey)}
          </Row>
        )}
        {context !== null && <Row label={t("sessionInfo.row.context")}>{context}</Row>}
        {header?.timestamp != null && (
          <Row label={t("sessionInfo.row.started")}>{new Date(header.timestamp).toLocaleString(locale)}</Row>
        )}
        {header?.parentSession != null && (
          <Row label={t("sessionInfo.row.parent")}>
            <span className="si-mono">{header.parentSession}</span>
          </Row>
        )}
        {dirs.length > 0 && (
          <Row label={t("sessionInfo.row.dirs")}>
            <span className="si-mono">{dirs.join("\n")}</span>
          </Row>
        )}
      </dl>
      {info.sessionId === null ? (
        <p className="si-note" data-testid="si-no-file">
          {t("sessionInfo.noSessionFile")}
        </p>
      ) : (
        <>
          <div className="si-pin-row">
            <span id={pinId}>
              {t("sessionInfo.pin.label")}
              <span className="si-pin-hint">{t("sessionInfo.pin.hint")}</span>
            </span>
            <Switch
              checked={info.pinned}
              disabled={pinBusy}
              labelledBy={pinId}
              onChange={() => void onPin()}
              testId="si-pin"
            />
          </div>
          <UsageSection read={read} />
        </>
      )}
    </>
  );
}
