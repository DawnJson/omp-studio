// 会话信息的"概览"页：标题、ID、文件、目录、模型、上下文，置顶开关，以及用量汇总。
// 标题、模型、上下文来自任务状态；ID、文件头、置顶、用量来自主进程（getTaskSessionInfo）；用量是会话文件算的，和输入框同口径。
import { useId, useState } from "react";
import type { ModelUsage, SessionModelUsage, TaskSessionInfo, TaskState } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { Button, Notice, SectionHead, Switch } from "../../ui/controls.tsx";
import { formatCount, formatMoney } from "../composer/usage-format.ts";
import { copyText, togglePin } from "./session-info-actions.ts";
import { thinkingLabel } from "../composer/thinking-levels.ts";
import type { Read } from "./use-synced-read.ts";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** 用量：会话文件算的（和输入框同口径，含进行中的会话），按 get_session_stats 的范围（压缩过只算压缩后，另给合计）。 */
function UsageSection({ usage }: { usage: SessionModelUsage }) {
  const t = useT();
  const sum = (pick: (row: ModelUsage) => number) => usage.models.reduce((total, row) => total + pick(row), 0);
  return (
    <section className="si-section" data-testid="si-usage">
      <SectionHead title={t("sessionInfo.usage.title")} />
      {usage.models.length === 0 ? (
        <p className="si-note" data-testid="si-no-usage">
          {t("sessionInfo.usage.none")}
        </p>
      ) : (
        <dl className="si-grid">
          <Row label={t("sessionInfo.usage.requests")}>
            <span data-testid="si-requests">{sum((row) => row.requests)}</span>
          </Row>
          <Row label={t("sessionInfo.usage.tokens")}>
            <span data-testid="si-tokens" className="si-num">
              {formatCount(sum((row) => row.total))}
            </span>
            <span className="si-note">
              {t("sessionInfo.usage.breakdown", {
                input: formatCount(sum((row) => row.input)),
                output: formatCount(sum((row) => row.output)),
                cacheRead: formatCount(sum((row) => row.cacheRead)),
                cacheWrite: formatCount(sum((row) => row.cacheWrite)),
              })}
            </span>
          </Row>
          <Row label={t("sessionInfo.usage.cost")}>
            <span data-testid="si-cost" className="si-num">
              {formatMoney(sum((row) => row.cost))}
            </span>
            {usage.whole !== null && (
              <span className="si-note" data-testid="si-whole">
                {t("sessionInfo.usage.whole", {
                  tokens: formatCount(usage.whole.total),
                  cost: formatMoney(usage.whole.cost),
                })}
              </span>
            )}
          </Row>
          <Row label={t("sessionInfo.usage.models")}>
            {usage.models
              .map((row) => (row.provider === "" ? row.modelId : `${row.provider}/${row.modelId}`))
              .join(", ")}
          </Row>
        </dl>
      )}
    </section>
  );
}

export function InfoTab({ task, read }: { task: TaskState; read: Read<TaskSessionInfo> }) {
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
            <span id={pinId}>{t("sessionInfo.pin.label")}</span>
            <Switch
              checked={info.pinned}
              disabled={pinBusy}
              labelledBy={pinId}
              onChange={() => void onPin()}
              testId="si-pin"
            />
          </div>
          <UsageSection usage={info.usage} />
        </>
      )}
    </>
  );
}
