// 输入框上方右对齐的一颗药丸 `[👥 2 | ⚡ 2]`：左半段 = 运行中的子代理数（点开右栏的子代理面板），右半段 = 运行中的后台作业数
// （点开 omp 自己的作业弹窗，选中第一个运行中的作业：左边列表、右边输出和"Cancel job"都是 omp 的）。某一段个数为 0 就不画那一段；
// 两段都没有时整颗药丸不画。两段各自点各自的，药丸本身不是按钮。数据：子代理 shared/tsp/agent-hub.ts 的 countActiveAgents，
// 作业 tsp-jobs-store（shared/tsp/jobs.ts）。位置由 ComposerTop 定（见它的说明）。
// 悬停（或键盘聚焦）右半段：上方出一张作业卡片代替悬停提示，标题是个数，下面是 omp hud 作业胶囊的悬停卡片
// （shared/tsp/jobs.ts 的 deriveJobTiles）：每个运行中的作业一块，omp 的作业小部件给了进度就画进度条。卡片挂在 body 上、
// 层级同悬停提示：输入框是 --z-sticky + 1 的层叠上下文，留在里面会被开着的 omp 弹窗（过程区的 layer，--z-popover）盖住。
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { TaskId } from "../../../../shared/ipc.ts";
import { deriveJobTiles, sameJobTiles, type JobTile } from "../../../../shared/tsp/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { Bolt, Users } from "../../icons.tsx";
import { reportOmpError } from "../../ui/errors.ts";
import { toggleAgentsPanel, useAgentsPanel } from "../agents/index.ts";
import { MeterView } from "../tsp/nodes/motion.tsx";
import { useTspDerived } from "../tsp/tsp-store.ts";
import { openTspJobs } from "./tsp-jobs-store.ts";

/** 和 ⓘ 说明（ui/InfoTip.tsx）一样的悬停延迟。 */
const CARD_DELAY_MS = 250;
/** 卡片底边离药丸、右边离窗口的最小距离。 */
const GAP_PX = 8;

export function StatusPills({
  taskId,
  agents,
  running,
}: {
  taskId: TaskId;
  /** 运行中的子代理数。 */
  agents: number;
  /** 运行中的 bash 作业 id。 */
  running: readonly string[];
}) {
  const t = useT();
  const panel = useAgentsPanel();
  const showAgents = agents > 0;
  const agentsLabel = t("composer.pills.agents", { count: agents });
  return (
    <div
      className="status-pills"
      data-testid="status-pills"
      data-empty={(!showAgents && running.length === 0) || undefined}
      role="group"
      aria-label={t("composer.pills.aria")}
    >
      {showAgents && (
        <button
          type="button"
          className="status-pill-seg"
          data-testid="pill-agents"
          data-count={agents}
          aria-label={agentsLabel}
          aria-expanded={panel?.taskId === taskId}
          title={agentsLabel}
          onClick={() => toggleAgentsPanel(taskId)}
        >
          <Users size={13} />
          <span className="status-pill-count">{agents}</span>
        </button>
      )}
      {showAgents && running.length > 0 && <span className="status-pill-sep" aria-hidden="true" />}
      {running.length > 0 && <JobsSegment taskId={taskId} running={running} />}
    </div>
  );
}

function JobsSegment({ taskId, running }: { taskId: TaskId; running: readonly string[] }) {
  const t = useT();
  const cardId = useId();
  const all = useTspDerived(taskId, deriveJobTiles, sameJobTiles);
  const tiles = (all ?? []).filter((tile) => running.includes(tile.id));
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const label = t("composer.pills.jobs", { count: running.length });
  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="status-pill-seg"
        data-testid="pill-jobs"
        data-count={running.length}
        aria-label={label}
        aria-haspopup="dialog"
        aria-describedby={open ? cardId : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") show(CARD_DELAY_MS);
        }}
        onPointerLeave={hide}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) show(0);
        }}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          event.stopPropagation();
          hide();
        }}
        onClick={() => {
          hide();
          openTspJobs(taskId, running[0]!).catch((error: unknown) => reportOmpError(t, error));
        }}
      >
        <Bolt size={13} />
        <span className="status-pill-count">{running.length}</span>
      </button>
      {open && <JobsCard id={cardId} label={label} tiles={tiles} anchor={button} />}
    </>
  );
}

/** 右对齐贴在药丸这一段的上方；omp 还没给出悬停卡片（作业刚起）时只有标题那一行。 */
function JobsCard({
  id,
  label,
  tiles,
  anchor,
}: {
  id: string;
  label: string;
  tiles: readonly JobTile[];
  anchor: RefObject<HTMLElement | null>;
}) {
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPlace({
      right: Math.max(GAP_PX, window.innerWidth - rect.right),
      bottom: window.innerHeight - rect.top + GAP_PX,
    });
  }, [anchor]);
  return createPortal(
    <div id={id} role="tooltip" className="ui-popover jobs-card" data-testid="jobs-card" style={place}>
      <p className="ui-pop-title">{label}</p>
      {tiles.map((tile) => (
        <div key={tile.id} className="jobs-card-tile" data-testid="jobs-card-tile" data-job-id={tile.id}>
          <div className="jobs-card-head">
            <span className="jobs-card-name">{tile.title || tile.id}</span>
            <span className="jobs-card-id">{tile.id}</span>
          </div>
          {tile.meter !== null && (
            <div className="jobs-card-progress">
              <MeterView p={{ value: tile.meter }} />
              {tile.figure !== "" && <span className="jobs-card-figure">{tile.figure}</span>}
            </div>
          )}
          {tile.notes.map((note, index) => (
            <p key={index} className="jobs-card-note">
              {note}
            </p>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
