// TSP 任务的"过程区"：画 omp 发来的活 surface。输入框不在这里：下面紧接着的是 studio 的 Composer（App.tsx），
// omp 自己的输入框卡片（role omp.editor）不画（TspChildren.tsx）。
//   inline（omp.session）：main 在可滚动的对话区（贴底跟随，用户上滚后不跟随），dock（HUD、排队、提问/审批）紧跟在对话后面
//   （对话长过视口时停在底部、Composer 正上方），
//   layer 是盖在整块上的浮层容器（选择器等）；
//   screen（如 /settings）：盖住整个过程区（连 dock，不含 Composer），自己的 main 自己滚。
// 对话列宽度按等宽字符数算成列数，变化时通知 omp（resize）。
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { useStickToBottom } from "../conversation/use-stick-to-bottom.ts";
import { ConversationLine } from "./ConversationLine.tsx";
import type { TspContext } from "./node-props.ts";
import { TspHosts } from "./TspHosts.tsx";
import { TspChildren } from "./TspChildren.tsx";
import { MainFlow } from "./MainFlow.tsx";
import { StudioHeader } from "../empty/StudioHeader.tsx";
import { useTaskValue } from "../../store/index.ts";
import { GoalStrip } from "../goal/GoalStrip.tsx";
import { TspCtx, TspEndedAtCtx, TspParkedCtx } from "./tsp-context.ts";
import {
  ensureTspDocument,
  useTspHasUserMessage,
  useTspNode,
  useTspNoVisibleChild,
  useTspSurface,
  useTspSurfaces,
  useTspDrive,
  useTspTurnCount,
} from "./tsp-store.ts";
import { useForwardOmpKeys } from "./use-forward-omp-keys.ts";
import { useTaskCommands } from "./use-task-commands.ts";
import { clearFirstPrompt, useFirstPrompt } from "./first-prompt-store.ts";
import { refreshSessionExtras } from "./session-extras-store.ts";
import "./tsp.css";

// ───────── 列数 ─────────

const lastCols = new Map<TaskId, number>();
const charWidths = new Map<string, number>();

/** 等宽字（--font-mono，--fs-code）一个字符的宽度。 */
function monoCharWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const font = `${style.getPropertyValue("--fs-code").trim() || "13px"} ${style.getPropertyValue("--font-mono").trim() || "monospace"}`;
  const cached = charWidths.get(font);
  if (cached !== undefined) return cached;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return 8;
  context.font = font;
  const width = context.measureText("0".repeat(40)).width / 40;
  if (width > 0) charWidths.set(font, width);
  return width > 0 ? width : 8;
}

/** 量 column 的宽度算列数，写进 --tsp-cw，变化时 resizeTsp。 */
function useColumns(
  taskId: TaskId,
  column: RefObject<HTMLElement | null>,
  surface: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const el = column.current;
    const root = surface.current;
    if (!el || !root) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const cw = monoCharWidth(el);
      root.style.setProperty("--tsp-cw", `${cw}px`);
      const cols = Math.max(20, Math.floor(el.clientWidth / cw));
      if (lastCols.get(taskId) === cols) return;
      lastCols.set(taskId, cols);
      window.studio.resizeTsp(taskId, cols).catch((error: unknown) => reportErrorNow(error));
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [taskId, column, surface]);
}

// ───────── reveal ─────────

/** 程序要求把某个节点滚进视野（reveal 操作）：滚过去以后不清，靠 seq 判断是不是新的。 */
function useReveal(taskId: TaskId, sf: string, root: RefObject<HTMLElement | null>): void {
  const view = useTspSurface(taskId, sf);
  const seen = useRef(view?.reveal?.seq ?? 0);
  const reveal = view?.reveal ?? null;
  useEffect(() => {
    if (!reveal || reveal.seq <= seen.current) return;
    seen.current = reveal.seq;
    const frame = requestAnimationFrame(() => {
      const target = root.current?.querySelector(`[data-id="${CSS.escape(reveal.id)}"]`);
      target?.scrollIntoView({
        block: reveal.where === "start" ? "start" : reveal.where === "end" ? "end" : "nearest",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, root]);
}

// ───────── surface ─────────

function useSurfaceContext(taskId: TaskId, sf: string): TspContext {
  return useMemo(
    () => ({
      taskId,
      sf,
      send: (event) => {
        window.studio.sendTspEvent(taskId, event).catch((error: unknown) => reportErrorNow(error));
      },
      keys: (data) => {
        window.studio.sendTspKeys(taskId, data).catch((error: unknown) => reportErrorNow(error));
      },
    }),
    [taskId, sf],
  );
}

interface SurfaceParts {
  taskId: TaskId;
  sf: string;
  ctx: TspContext;
  scroller: RefObject<HTMLDivElement | null>;
  column: RefObject<HTMLDivElement | null>;
  surface: RefObject<HTMLDivElement | null>;
  jump?: ReactNode;
  /** 盖在对话区右侧的对话线（只有 inline 有）。 */
  line?: ReactNode;
  /** 对话列最上面、随对话滚动的内容（inline 的 studio 标题块）。 */
  header?: ReactNode;
  /** main 后面、对话列末尾的内容（首发气泡，omp 回显前占位）。 */
  tail?: ReactNode;
  mode: "inline" | "screen";
}

const NO_IDS: readonly string[] = [];

/** layer：盖在整块上的浮层容器；子代理面板驱动期间不画。 */
function Layer({ taskId, sf, ctx }: { taskId: TaskId; sf: string; ctx: TspContext }) {
  const node = useTspNode(taskId, sf, "layer");
  const driving = useTspDrive(taskId) !== null;
  if (node === null || driving) return null;
  return <TspChildren node={node} ctx={ctx} />;
}

/** dock：没有可显示的子节点（全是 hidden 或空 col）时整块收起（data-blank），免得留一条空的间距。 */
function Dock({ taskId, sf, ctx }: { taskId: TaskId; sf: string; ctx: TspContext }) {
  const node = useTspNode(taskId, sf, "dock");
  const blank = useTspNoVisibleChild(taskId, sf, node?.c ?? NO_IDS, "dock") || node === null;
  return (
    <div className="tsp-dock" data-blank={blank ? "" : undefined}>
      <div className="tsp-dock-in">{node !== null && <TspChildren node={node} ctx={ctx} />}</div>
    </div>
  );
}

function SurfaceBody({ taskId, sf, ctx, scroller, column, surface, jump, line, header, tail, mode }: SurfaceParts) {
  const t = useT();
  const main = useTspNode(taskId, sf, "main");
  // 子代理面板在后台驱动 omp 的 Agent Hub（插话 / 结束 / 恢复）：期间过程区压暗（聚焦模式里它暂时显示那个子代理的记录）。
  const driving = useTspDrive(taskId)?.kind === "hub";
  const role = typeof main?.p.role === "string" ? main.p.role : undefined;
  useReveal(taskId, sf, surface);
  return (
    <TspCtx.Provider value={ctx}>
      <div
        ref={surface}
        className="tsp-surface"
        data-mode={mode}
        data-testid={`tsp-surface-${mode}`}
        data-sf={sf}
        data-driving={driving ? "" : undefined}
      >
        <div ref={scroller} className="tsp-scroller" role="log" aria-label={t("tsp.layoutRegion")} tabIndex={0}>
          <div ref={column} className="tsp-column tsp-main" data-role={role}>
            {header}
            <MainFlow taskId={taskId} sf={sf} ctx={ctx} />
            {tail}
            <div className="tsp-column-end" />
          </div>
        </div>
        <OverlayScrollbar target={scroller} />
        <Dock taskId={taskId} sf={sf} ctx={ctx} />
        <div className="tsp-layer">
          <Layer taskId={taskId} sf={sf} ctx={ctx} />
        </div>
        {line}
        {jump}
      </div>
    </TspCtx.Provider>
  );
}

/** 版式照抄 omp 回显的用户消息：前面两个 sm 间隔、正文按 Markdown 段落排，换上真节点时气泡不跳。 */
function PendingUser({ text }: { text: string }) {
  return (
    <>
      <div className="tsp-spacer tsp-sz-sm" aria-hidden="true" />
      <div className="tsp-spacer tsp-sz-sm" aria-hidden="true" />
      <div className="tsp-card nohead" data-role="omp.user" data-pending="" data-testid="tsp-pending-user">
        <div className="tsp-card-body">
          <div className="tsp-md">
            <div className="md">
              <div className="md-block">
                <p>{text}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** `sf` 为 null：omp 还没建 surface，只画标题块和刚发出的那句话（版式和有 surface 时一致）。 */
function InlineSurface({
  taskId,
  sf,
  pendingText,
}: {
  taskId: TaskId;
  sf: string | null;
  pendingText?: string | undefined;
}) {
  const t = useT();
  const surfaceId = sf ?? "";
  const ctx = useSurfaceContext(taskId, surfaceId);
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  // 一轮结束的时刻（lastTurn 每个事件都是新对象，取它的数字）。
  const lastTurnAt = useTaskValue(taskId, (task) => task?.lastTurn?.endedAt ?? null);
  const hasUser = useTspHasUserMessage(taskId, surfaceId);
  const { showJump, scrollToBottom } = useStickToBottom(taskId, scroller, column);
  useColumns(taskId, column, surface);
  // 恢复会话时 omp 不重发的用量脚注和回顾：挂载时取一次，一轮结束或新增一轮时再取。
  const turnCount = useTspTurnCount(taskId, surfaceId);
  useEffect(() => refreshSessionExtras(taskId), [taskId, lastTurnAt, turnCount]);
  // omp 回显了用户消息：首发的文字用完了。
  useEffect(() => {
    if (hasUser) clearFirstPrompt(taskId);
  }, [taskId, hasUser]);
  return (
    <SurfaceBody
      taskId={taskId}
      sf={surfaceId}
      ctx={ctx}
      scroller={scroller}
      column={column}
      surface={surface}
      mode="inline"
      header={<StudioHeader compact />}
      tail={pendingText !== undefined && !hasUser ? <PendingUser text={pendingText} /> : null}
      line={<ConversationLine taskId={taskId} scroller={scroller} />}
      jump={
        showJump && (
          <button type="button" className="tsp-jump" onClick={scrollToBottom} data-testid="jump-latest">
            {t("scroll.latest")}
          </button>
        )
      }
    />
  );
}

function ScreenSurface({ taskId, sf }: { taskId: TaskId; sf: string }) {
  const ctx = useSurfaceContext(taskId, sf);
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  useColumns(taskId, column, surface);
  return (
    <SurfaceBody
      taskId={taskId}
      sf={sf}
      ctx={ctx}
      scroller={scroller}
      column={column}
      surface={surface}
      mode="screen"
    />
  );
}

/** 进程不在了（ended）的时刻：第一次看到时记下，再起进程时清掉。 */
function useEndedAt(ended: boolean): number | null {
  const [at, setAt] = useState(() => (ended ? Date.now() : null));
  useLayoutEffect(() => {
    setAt((current) => (ended ? (current ?? Date.now()) : null));
  }, [ended]);
  return ended ? at : null;
}

/** parked：设置页盖着当前任务（spec §4.19）：节点和 effect 都留着、只停画（content-visibility），键盘和 omp 的弹层、通知不再作用。 */
// memo：App 每次重渲染（切任务、开关面板）时，留着的几个对话区 props 没变就不重渲染（props 只有 id 和布尔值）。
export const TspView = memo(function TspView({ taskId, parked }: { taskId: TaskId; parked: boolean }) {
  const surfaces = useTspSurfaces(taskId);
  const firstPrompt = useFirstPrompt(taskId);
  const status = useTaskValue(taskId, (task) => task?.status);
  const endedAt = useEndedAt(status === "error" || status === "stopped");
  useEffect(() => ensureTspDocument(taskId), [taskId]);
  useForwardOmpKeys(taskId, parked);
  useTaskCommands(taskId, parked);
  // 任务出错 / 退出：首发的文字不再等 omp 回显。
  useEffect(() => {
    if (status === "error" || status === "stopped") clearFirstPrompt(taskId);
  }, [taskId, status]);

  // 会话本体是最后一个 inline surface（关掉以后留着的也画，对话还要能读）；screen 只画活的，盖在上面。
  const inline = surfaces.findLast((s) => s.mode === "inline");
  const firstInline = surfaces.find((s) => s.mode === "inline");
  const screen = surfaces.findLast((s) => s.mode === "screen" && s.live);
  // 还没有 inline surface 但有刚发出的话：画和最终一样的版式（标题块 + 气泡），surface 出现时同一个组件原地接上，不重挂载。
  const showInline = inline !== undefined || firstPrompt !== undefined;
  const inlineKey = inline === undefined || inline.id === firstInline?.id ? "first" : inline.id;
  return (
    <div
      className="tsp-view"
      data-testid="tsp-view"
      data-task-id={taskId}
      data-covered={screen ? "" : undefined}
      data-parked={parked ? "" : undefined}
      data-ended={endedAt !== null ? "" : undefined}
    >
      <TspParkedCtx.Provider value={parked}>
        <TspEndedAtCtx.Provider value={endedAt}>
          {/* 目标条（`/goal`）：数据是主进程从输入框卡片上的"Goal …"行和会话文件得到的 TaskState.goal；omp 自己的输入框卡片（含那一行）不画。 */}
          <GoalStrip key={`goal:${taskId}`} taskId={taskId} />
          {showInline ? (
            <InlineSurface
              key={`${taskId}:${inlineKey}`}
              taskId={taskId}
              sf={inline?.id ?? null}
              pendingText={firstPrompt?.text}
            />
          ) : (
            <div className="tsp-empty" role="status" />
          )}
          {screen && <ScreenSurface key={`${taskId}:${screen.id}`} taskId={taskId} sf={screen.id} />}
          <TspHosts />
        </TspEndedAtCtx.Provider>
      </TspParkedCtx.Provider>
    </div>
  );
});
