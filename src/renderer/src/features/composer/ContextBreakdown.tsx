// 点上下文圆环弹出的构成（照 omp 的 /context）：头部已用 / 窗口 · 百分比，一条按类别分段的横条 + 每类的 token 和占窗口的比例。
// 任务里（TaskContextBreakdown）：打开时请 omp 现算（readTspContext：主进程点 omp 输入框上的上下文 meter、读它弹出的报告），
// 行和数字和 omp 的 /context 一致；算好之前显示这个任务上次读到的，从没读到过时头部用输入框上的用量，行的位置是一句说明。
// 构成下面是压缩一栏（ContextCompact：omp 的自动压缩触发点、摘要状态、立即压缩 / 交接）。
// 新任务草稿（DraftContextBreakdown）：还没有 omp 进程，已用 0，窗口取所选模型的，只有剩余空间和自动压缩预留
// （窗口 - omp 的压缩触发点，compaction.* 设置，读不到就不画这一段）。
import { useEffect, useState, type ReactNode } from "react";
import { compactionTrigger } from "../../../../shared/compaction-trigger.ts";
import type {
  CompactionSettings,
  ContextReport,
  ContextReportRow,
  ModelKey,
  ProjectId,
  TaskId,
  TaskState,
} from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import { beginTspDrive, endTspDrive, isTspDriving, type TspDrive } from "../tsp/tsp-store.ts";
import { ContextCompact } from "./ContextCompact.tsx";
import { draftContextRows } from "./context-rows.ts";
import { formatCount, formatPercent } from "./usage-format.ts";

type ContextUsage = NonNullable<TaskState["contextUsage"]>;

/** 压缩设置（和模型无关，按项目读，`omp config list` 要零点几秒到一秒）：按项目记住，草稿的圆环一出现就预读，打开构成时直接有，再在后台重读。读不到就不画预留段。 */
const compactionCache = new Map<string, CompactionSettings | null>();
const compactionInflight = new Map<string, Promise<CompactionSettings | null>>();

function loadCompaction(projectId: ProjectId | null): Promise<CompactionSettings | null> {
  const key = projectId ?? "";
  const pending = compactionInflight.get(key);
  if (pending !== undefined) return pending;
  const job = window.studio
    .getModelInsights(projectId, [])
    .then(
      (insights) => insights.compaction,
      () => compactionCache.get(key) ?? null,
    )
    .then((settings) => {
      compactionCache.set(key, settings);
      return settings;
    })
    .finally(() => compactionInflight.delete(key));
  compactionInflight.set(key, job);
  return job;
}

/** 草稿的圆环挂上时调：还没读过这个项目的压缩设置就先读。 */
export function prefetchCompaction(projectId: ProjectId | null): void {
  if (!compactionCache.has(projectId ?? "")) void loadCompaction(projectId);
}

function useCompaction(projectId: ProjectId | null): CompactionSettings | null {
  const [settings, setSettings] = useState<CompactionSettings | null>(
    () => compactionCache.get(projectId ?? "") ?? null,
  );
  useEffect(() => {
    let current = true;
    setSettings(compactionCache.get(projectId ?? "") ?? null);
    void loadCompaction(projectId).then((next) => current && setSettings(next));
    return () => {
      current = false;
    };
  }, [projectId]);
  return settings;
}

/** omp 的类别 id（加上剩余空间、预留）：有自己的名称和颜色；别的（omp 新加的类别）显示 omp 的英文名。 */
const KNOWN_PARTS = ["systemPrompt", "systemTools", "systemContext", "skills", "messages", "free", "buffer"] as const;
type KnownPart = (typeof KNOWN_PARTS)[number];
const isKnownPart = (key: string): key is KnownPart => (KNOWN_PARTS as readonly string[]).includes(key);

interface BreakdownProps {
  used: number;
  window: number;
  percent: number;
  /** null：还没有行（omp 还在算、读不到），换成 note 这一句。 */
  rows: readonly ContextReportRow[] | null;
  note?: string;
  /** 构成下面的一栏（任务里是压缩）。 */
  footer?: ReactNode;
}

function Breakdown({ used, window, percent, rows, note, footer }: BreakdownProps) {
  const t = useT();
  const share = (tokens: number) => (window > 0 ? (tokens / window) * 100 : 0);
  const label = (row: ContextReportRow) => (isKnownPart(row.key) ? t(`composer.context.${row.key}`) : row.label);
  return (
    <div className="ctx" data-testid="context-breakdown">
      <div className="ctx-head">
        <strong>{t("composer.context.title")}</strong>
        <span className="ctx-num">
          {formatCount(used)} / {formatCount(window)} · {formatPercent(percent)}%
        </span>
      </div>
      {rows === null ? (
        <p className="ctx-note" data-testid="context-note">
          {note}
        </p>
      ) : (
        <>
          <div className="ctx-bar" aria-hidden="true">
            {rows.map((row) =>
              row.tokens > 0 ? (
                <span
                  key={row.key}
                  className="ctx-seg"
                  data-part={row.key}
                  style={{ flexBasis: `${share(row.tokens)}%` }}
                />
              ) : null,
            )}
          </div>
          <dl className="ctx-rows">
            {rows.map((row) => (
              <div key={row.key} className="ctx-row" data-testid="context-row" data-part={row.key}>
                <dt>
                  <span className="ctx-swatch" data-part={row.key} aria-hidden="true" />
                  {label(row)}
                </dt>
                <dd className="ctx-num">{formatCount(row.tokens)}</dd>
                <dd className="ctx-num ctx-share">{formatPercent(share(row.tokens))}%</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {footer}
    </div>
  );
}

/** 每个任务最近一次读到的报告：再打开构成时先显示它，omp 现算的到了再换。 */
const reports = new Map<TaskId, ContextReport>();

/** 任务的构成；挂载 = 构成打开：请 omp 现算一次（调用期间不画 omp 的 layer，报告不会闪出来）。 */
export function TaskContextBreakdown({
  taskId,
  context,
  task,
}: {
  taskId: TaskId;
  context: ContextUsage;
  /** 压缩一栏（ContextCompact）要读的任务状态。 */
  task: TaskState;
}) {
  const t = useT();
  const [report, setReport] = useState(() => reports.get(taskId) ?? null);
  const [reading, setReading] = useState(true);
  useEffect(() => {
    // 主进程正在驱动 omp（子代理面板的插话 / 结束 / 恢复）：不排在它后面等，显示上次的。
    if (isTspDriving(taskId)) {
      setReading(false);
      return undefined;
    }
    let alive = true;
    const drive: TspDrive = { kind: "context" };
    beginTspDrive(taskId, drive);
    window.studio
      .readTspContext(taskId)
      .then(
        (next) => {
          if (next === null) return;
          reports.set(taskId, next);
          if (alive) setReport(next);
        },
        (error: unknown) => reportErrorNow(error),
      )
      .finally(async () => {
        await endTspDrive(taskId, drive);
        if (alive) setReading(false);
      });
    return () => {
      alive = false;
    };
    // 只跟着任务走：浮层开着时换界面语言（t 变了）不再请 omp 重算一次。
  }, [taskId]);
  const footer = <ContextCompact task={task} />;
  if (report === null)
    return (
      <Breakdown
        used={context.tokens}
        window={context.contextWindow}
        percent={context.percent}
        rows={null}
        note={t(reading ? "composer.context.reading" : "composer.context.unavailable")}
        footer={footer}
      />
    );
  const total = report.window ?? context.contextWindow;
  return (
    <Breakdown
      used={report.used}
      window={total}
      percent={total > 0 ? (report.used / total) * 100 : 0}
      rows={report.rows}
      footer={footer}
    />
  );
}

/** 新任务草稿的构成：已用 0，窗口取所选模型的。 */
export function DraftContextBreakdown({
  window,
  modelKey,
  projectId,
}: {
  window: number;
  modelKey: ModelKey | null;
  projectId: ProjectId | null;
}) {
  const settings = useCompaction(projectId);
  const trigger = settings !== null && modelKey !== null ? compactionTrigger(settings, modelKey, window).tokens : null;
  return <Breakdown used={0} window={window} percent={0} rows={draftContextRows(window, trigger)} />;
}
