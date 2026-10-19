// 对话流（spec 4 / 5.4）：结果优先，每轮先结论和改动卡片，过程折叠成一行；流式不跳动，粘底与"回到最新"，缩放保位置。
// 数据只从 store 取：useTranscript(taskId)（对话流镜像）、useTask(taskId)（状态、错误、对话框）。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { useLanes, useTask, useTranscript } from "../../store/index.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { pushToast } from "../dialogs/index.ts";
import { onStudioCommand } from "../palette/index.ts";
import { assignLanesToTurns } from "../lanes/lane-model.ts";
import { buildTurns, type Turn } from "./model.ts";
import { ConversationError } from "./ConversationError.tsx";
import { TurnView } from "./TurnView.tsx";
import { ShellRunning } from "./ShellBlock.tsx";
import { GoalStrip } from "../goal/GoalStrip.tsx";
import { SessionTreePanel } from "./SessionTreePanel.tsx";
import { useStickToBottom } from "./use-stick-to-bottom.ts";
import "./conversation.css";

const RECENT_TURNS = 20;
const BUSY: readonly TaskState["status"][] = ["starting", "running", "needs_you"];
const NO_LANES: readonly SubagentLane[] = [];

function firstSentence(text: string): string {
  const match = /^[^。.!?！？\n]+[。.!?！？]?/.exec(text.trim());
  return (match?.[0] ?? text).slice(0, 160);
}

export function ConversationView({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const task = useTask(taskId);
  const transcript = useTranscript(taskId);
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const turnsRef = useRef<Turn[]>([]);
  // 工具参数里的绝对路径相对任务实际的工作目录（worktree 任务是 worktree 根，不是项目目录）。
  const projectPath = task?.cwd ?? null;
  const { showJump, scrollToBottom } = useStickToBottom(taskId, scroller, column);

  // 切任务不重挂载（滚动位置逻辑要保留），只让对话列淡入上移一次；a/b 交替让连续切换也能重放。
  // 渲染期就改状态，这样新内容提交时已带 data-switching，消息自己的进入动画（turn-in）不会叠上去。
  // init = 刚挂载（换页时整个 .conversation 自己淡入，列不再单独动）。
  const [switchedTask, setSwitchedTask] = useState(taskId);
  const [switching, setSwitching] = useState<"init" | "a" | "b" | undefined>("init");
  if (switchedTask !== taskId) {
    setSwitchedTask(taskId);
    setSwitching((current) => (current === "a" ? "b" : "a"));
  }
  // 兜底：动画没触发 animationend 时也要解除，后续新消息才有进入动画。
  useEffect(() => {
    if (switching === undefined) return;
    const timer = setTimeout(() => setSwitching(undefined), 400);
    return () => clearTimeout(timer);
  }, [switching]);

  const turns = useMemo(() => {
    const next = transcript ? buildTurns(transcript, turnsRef.current) : [];
    turnsRef.current = next;
    return next;
  }, [transcript]);

  const lanes = useLanes(taskId);
  const lanesByTurn = useRef<ReadonlyMap<string, readonly SubagentLane[]>>(new Map());
  const turnLanes = useMemo(() => {
    lanesByTurn.current = assignLanesToTurns(turns, lanes, lanesByTurn.current);
    return lanesByTurn.current;
  }, [turns, lanes]);

  const busy = task !== null && BUSY.includes(task.status);
  const lastTurn = turns[turns.length - 1];

  // Ctrl Shift C / 命令面板"复制最后一条回答"。
  useEffect(() => {
    const copyLast = () => {
      const answer = [...turns].reverse().find((turn) => turn.answer !== null)?.answer;
      if (answer)
        void navigator.clipboard.writeText(answer.text).then(
          () => pushToast({ message: t("common.copied") }),
          (cause: unknown) => reportError(t, cause),
        );
    };
    const stop = onStudioCommand((command) => command === "copyLast" && copyLast());
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copyLast();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("keydown", onKey);
    };
  }, [turns, t]);

  // Ctrl O / 命令面板：展开或收起最近一个过程行（点它的按钮，保留以被点击元素为锚的滚动补偿）。
  useEffect(() => {
    const toggle = () => {
      const rows = scroller.current?.querySelectorAll<HTMLButtonElement>(".process-row");
      rows?.item(rows.length - 1)?.click();
    };
    const stop = onStudioCommand((command) => command === "toggleProcess" && toggle());
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // 轮次结束时一次性更新 live region（流式期间不逐字播报）。
  const [announce, setAnnounce] = useState("");
  const wasBusy = useRef(busy);
  const announcedTask = useRef(taskId);
  useEffect(() => {
    // 切换/恢复任务：上一个任务的完成播报不能留在 live region 里，也不能把"忙→闲"的差异算成这个任务刚完成。
    if (announcedTask.current !== taskId) {
      announcedTask.current = taskId;
      wasBusy.current = busy;
      setAnnounce("");
      return;
    }
    if (wasBusy.current && !busy) {
      const answer = lastTurn?.answer?.text;
      if (answer) setAnnounce(t("a11y.done", { summary: firstSentence(answer) }));
    }
    wasBusy.current = busy;
  }, [taskId, busy, lastTurn, t]);

  // 只有最近一轮、任务空闲、且最后一次 prompt 以错误结束时才给"重试"。
  const canRetryLast = !busy && task?.lastTurn?.status === "error";

  const isLive = (turn: Turn): boolean => busy && turn === lastTurn;

  return (
    <div
      className="conversation"
      data-testid="conversation"
      data-task-id={taskId}
      data-switching={switching}
      data-running={busy || undefined}
    >
      <GoalStrip key={taskId} taskId={taskId} goal={task?.goal ?? null} />
      <div
        ref={scroller}
        className="scroller"
        role="log"
        aria-label={t("a11y.chat")}
        aria-busy={busy}
        aria-live="off"
        tabIndex={0}
      >
        <div
          ref={column}
          className="column"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setSwitching(undefined);
          }}
        >
          {turns.map((turn, index) => (
            <TurnView
              key={turn.key}
              turn={turn}
              live={isLive(turn)}
              canRetry={canRetryLast && turn === lastTurn}
              offscreenSkippable={index < turns.length - RECENT_TURNS}
              taskId={taskId}
              projectPath={projectPath}
              lanes={turnLanes.get(turn.key) ?? NO_LANES}
            />
          ))}
          <ShellRunning taskId={taskId} />
          {busy && turns.length === 0 && task?.status === "starting" && (
            <p className="note">{t("conversation.starting")}</p>
          )}
          {task?.error && <ConversationError taskId={taskId} error={task.error} />}
          <div className="column-end" />
        </div>
      </div>
      <OverlayScrollbar target={scroller} />
      <SessionTreePanel taskId={taskId} />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {showJump && (
        <button type="button" className="jump" onClick={scrollToBottom} data-testid="jump-latest">
          {t("scroll.latest")}
        </button>
      )}
    </div>
  );
}
