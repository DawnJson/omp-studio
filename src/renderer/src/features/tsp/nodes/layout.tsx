// 布局类节点：col、row、card、section、rule、spacer（规范 Layout）。
import { useMemo, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { ASK_BUTTON_ROLE, ASK_GATE_ROLE } from "../../../../../shared/tsp/ask-gate.ts";
import type { TspSpace, TspText } from "../../../../../shared/tsp/tsp.generated.ts";
import { ChevronDown } from "../../../icons.tsx";
import { AskGateCol } from "../interactive/AskGate.tsx";
import { Button } from "../interactive/Button.tsx";
import { ERROR_CARD_ROLE } from "../../../../../shared/tsp/error-turn.ts";
import { RetryButton } from "../../session-info/RetryButton.tsx";
import { Clamp } from "../Clamp.tsx";
import { keyboardFocused } from "../../../ui/input-modality.ts";
import { FoldCtx, NO_FOLD, OPEN_FOLD, useFoldState } from "../fold-context.ts";
import { resolveIconName, toolIconName } from "../icon-names.ts";
import { useEntrance } from "../entrance.ts";
import { TspIcon } from "../icons.tsx";
import { labels } from "../labels.ts";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps, TspContext } from "../node-props.ts";
import { TspSpans } from "../spans.tsx";
import { previewToLines } from "../props-util.ts";
import { TspChildren, TspNode } from "../TspChildren.tsx";
import { useFold } from "../use-fold.ts";
import {
  peekTspDocument,
  peekTspNode,
  useBareTurnIndex,
  useIsLatestRecap,
  useTspNoVisibleChild,
  useUsageTurnIndex,
} from "../tsp-store.ts";
import { runOutputSpan } from "../../../../../shared/tsp/run-output.ts";
import { answerText } from "../../../../../shared/tsp/last-answer.ts";
import { useSessionExtras } from "../session-extras-store.ts";
import { useTaskValue } from "../../../store/index.ts";
import { formatTurnFooter, withTurnDetails } from "../turn-footer.ts";
import { copyAnswerPlainText, copyText, showAnswerCopyMenu, TURN_COPY_ROLE } from "../actions.ts";
import { editUserCard, forkAfterAnswer, forkFromUserCard } from "../../conversation/fork-actions.ts";
import { reportErrorNow } from "../../../ui/errors.ts";
import { useT } from "../../../i18n/use-t.ts";

const GAPS: ReadonlySet<TspSpace> = new Set(["none", "xs", "sm", "md", "lg"]);

function stackClasses(p: Readonly<Record<string, unknown>>): string {
  const classes: string[] = [];
  if (typeof p.gap === "string" && GAPS.has(p.gap as TspSpace)) classes.push(`tsp-gap-${p.gap}`);
  if (typeof p.align === "string") classes.push(`tsp-al-${p.align}`);
  if (p.justify === "between" || p.justify === "end") classes.push(`tsp-js-${p.justify}`);
  if (p.wrap === true) classes.push("tsp-wrap");
  return classes.join(" ");
}

/** col / row 没有可显示的子节点（不占位也不产生间距，data-blank）；有 `grow` 的撑开空间，不收起；`extra` = 还有 children 之外的元素。 */
function useBlank({ node, ctx }: NodeProps, extra = false): boolean {
  const grows = typeof node.p.grow === "number" && node.p.grow > 0;
  return useTspNoVisibleChild(ctx.taskId, ctx.sf, node.c, grows || extra ? "off" : "container");
}

/** 搜索来源（omp.tool.files 里是 omp.tool.source 行）：整列排成卡片网格，见 tsp.css。 */
function hasSourceRows({ node, ctx }: NodeProps): boolean {
  if (node.p.role !== "omp.tool.files") return false;
  return node.c.some((id) => {
    const child = peekTspNode(ctx.taskId, ctx.sf, id);
    return child?.k === "row" && child.p.role === "omp.tool.source";
  });
}

/** wait / Task 卡里的作业磁贴（shared/tsp/jobs.ts 的 omp.job.tile）：同一批出现的错开入场。 */
function TileCol(props: NodeProps) {
  const entrance = useEntrance(props.ctx.taskId, props.ctx.sf, props.node.id);
  const blank = useBlank(props);
  return (
    <div
      {...nodeDomProps(props, "tsp-col", {
        className: [stackClasses(props.node.p), entrance?.className].filter(Boolean).join(" "),
        style: entrance?.style,
        blank,
      })}
      data-enter={entrance?.["data-enter"]}
    >
      <TspChildren {...props} />
    </div>
  );
}

export function Col(props: NodeProps) {
  if (props.node.p.role === "omp.job.tile") return <TileCol {...props} />;
  if (props.node.p.role === "omp.assistant") return <AssistantCol {...props} />;
  if (props.node.p.role === ASK_GATE_ROLE) return <GateCol {...props} />;
  if (props.node.p.role === "omp.run") return <RunCol {...props} />;
  return <PlainCol {...props} />;
}

/**
 * eval 的一个 cell：输出被 JSON 视图切成几段时（shared/tsp/run-output.ts），折叠中把这几段合成一段，
 * 一起只露末尾几行（和单段输出一样），里面各段不再各自夹紧。展开、只有一段时照常。
 */
function RunCol(props: NodeProps) {
  const { node, ctx } = props;
  const fold = useFoldState();
  const blank = useBlank(props);
  const span = fold.collapsed === true ? runOutputSpan(node.c.map((id) => peekTspNode(ctx.taskId, ctx.sf, id))) : null;
  if (span === null) return <PlainCol {...props} />;
  const child = (id: string) => <TspNode key={id} id={id} ctx={ctx} />;
  return (
    <div {...nodeDomProps(props, "tsp-col", { className: stackClasses(node.p), blank })}>
      {node.c.slice(0, span.start).map(child)}
      <Clamp lines={span.lines} tail onExpand={fold.expand} className="tsp-run-outputs">
        <FoldCtx.Provider value={OPEN_FOLD}>{node.c.slice(span.start, span.end).map(child)}</FoldCtx.Provider>
      </Clamp>
      {node.c.slice(span.end).map(child)}
    </div>
  );
}

function GateCol(props: NodeProps) {
  const blank = useBlank(props);
  return (
    <AskGateCol {...props} dom={nodeDomProps(props, "tsp-col", { className: stackClasses(props.node.p), blank })} />
  );
}

function PlainCol(props: NodeProps) {
  const blank = useBlank(props);
  return (
    <div
      {...nodeDomProps(props, "tsp-col", { className: stackClasses(props.node.p), blank })}
      data-cards={hasSourceRows(props) ? "" : undefined}
    >
      <TspChildren {...props} />
    </div>
  );
}

/**
 * omp 的助手消息容器。恢复会话时 omp 不重发每轮末尾的用量行（实测 18.12.4），这里在一轮的最后一个助手消息后面
 * 补一行（数据来自会话文件，见 main/tsp/session-extras.ts）；实时的轮 omp 自己带这一行，不补；还在跑的那一轮也不补（useBareTurnIndex）。
 * 补的行和 omp 画的一样以复制回答开头（点击复制这条回答的 markdown，右键可复制纯文本），后面跟着 studio 的 AnswerActions。
 */
function AssistantCol(props: NodeProps) {
  const { taskId, sf } = props.ctx;
  // 只取轮数和自己那一轮的脚注：别的轮的用量刷新了不重画这一列。
  const turnCount = useSessionExtras(taskId, (extras) => extras.turns.length);
  const running = useTaskValue(taskId, (task) => task?.status === "running" || task?.status === "needs_you");
  const index = useBareTurnIndex(taskId, sf, props.node.id, turnCount, running);
  const footer = useSessionExtras(taskId, (extras) => (index >= 0 ? (extras.turns[index] ?? null) : null));
  const text = useMemo(() => (footer === null ? null : formatTurnFooter(footer)), [footer]);
  // 补的用量行是 children 之外的元素，有它就不算空。
  const blank = useBlank(props, text !== null);
  const copyMarkdown = () => {
    const surface = peekTspDocument(taskId)?.surfaces.get(sf);
    const answer = surface === undefined ? "" : answerText(surface, props.node.id);
    if (answer !== "") copyText(answer);
  };
  return (
    <div {...nodeDomProps(props, "tsp-col", { className: stackClasses(props.node.p), blank })}>
      <TspChildren {...props} />
      {text !== null && (
        <div className="tsp-row" data-role="omp.turn.usage" data-restored="" title={text.title}>
          <span
            className="tsp-icon tsp-act"
            data-role={TURN_COPY_ROLE}
            role="button"
            tabIndex={0}
            title={labels.copyAnswer}
            aria-label={labels.copyAnswer}
            onClick={copyMarkdown}
            onContextMenu={(event) => showAnswerCopyMenu(event, props.ctx, copyMarkdown)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              copyMarkdown();
            }}
          >
            <TspIcon name="copy" />
          </span>
          <AnswerActions ctx={props.ctx} anchorId={props.node.id} />
          <div className="tsp-text">{text.text}</div>
        </div>
      )}
    </div>
  );
}

/**
 * 空闲回顾（omp.recap）：omp 终端里是 "※ recap: …"，节点里的图标 `history` 只是 TSP 的占位，tsp.css 里隐藏它、改画 ※。
 * 对话里只显示最新的一条：之后又来了新的回顾，这一条就收起（omp 每条都留着）。和 omp 一样只画 omp 发来的：恢复会话时 omp 不重放回顾，
 * studio 也不补；压缩、恢复这类整段重建对话时 omp 删掉它，这里跟着消失。
 */
function RecapRow(props: NodeProps) {
  const { taskId, sf } = props.ctx;
  const latest = useIsLatestRecap(taskId, sf, props.node.id);
  const blank = useBlank(props);
  if (!latest) return null;
  const dom = nodeDomProps(props, "tsp-row", { className: stackClasses(props.node.p), blank });
  return (
    <div {...dom} title={labels.recapTitle}>
      <TspChildren {...props} />
    </div>
  );
}

export function Row(props: NodeProps) {
  if (props.node.p.role === "omp.recap") return <RecapRow {...props} />;
  if (props.node.p.role === ASK_BUTTON_ROLE) return <Button {...props} />;
  if (props.node.p.role === "omp.turn.usage") return <UsageRow {...props} />;
  if (props.node.p.role === "omp.user.tools") return <UserToolsRow {...props} />;
  return <PlainRow {...props} />;
}

/**
 * omp 实时画的每轮用量行：悬停里补上缓存命中率和回答完成的时刻（会话文件里这一轮的数据，withTurnDetails；轮数对不上时不补）。
 * studio 的 AnswerActions 插在 omp 的复制图标后面（没有复制图标时放在行末）。
 */
function UsageRow(props: NodeProps) {
  const { taskId, sf } = props.ctx;
  const turnCount = useSessionExtras(taskId, (extras) => extras.turns.length);
  const index = useUsageTurnIndex(taskId, sf, props.node.id, turnCount);
  // 内容没变的轮沿用旧对象（session-extras-store.ts 的 share），别的轮刷新不重画这一行。
  const turn = useSessionExtras(taskId, (extras) => (index >= 0 ? (extras.turns[index] ?? null) : null));
  const blank = useBlank(props, true);
  const dom = nodeDomProps(props, "tsp-row", { className: stackClasses(props.node.p), blank });
  const children = props.node.c.map((id) => peekTspNode(taskId, sf, id));
  const copyAt = children.findIndex((child) => child?.p.role === TURN_COPY_ROLE);
  const studio = <AnswerActions ctx={props.ctx} anchorId={props.node.id} />;
  const cut = copyAt < 0 ? props.node.c.length : copyAt + 1;
  return (
    <div {...dom} title={dom.title === undefined ? undefined : withTurnDetails(dom.title, turn)}>
      {props.node.c.slice(0, cut).map((id) => (
        <TspNode key={id} id={id} ctx={props.ctx} />
      ))}
      {studio}
      {props.node.c.slice(cut).map((id) => (
        <TspNode key={id} id={id} ctx={props.ctx} />
      ))}
    </div>
  );
}

/**
 * 回答用量行里 studio 跟在复制图标后面的按钮，一直显示（issue #9，2026-11-09；之前纯文本只在复制图标的右键菜单里，用户发现不了）：
 * 复制纯文本（copyAnswerPlainText，同右键菜单那一项）、从这里分叉（forkAfterAnswer：新任务的对话到这条回答为止，输入框空着；
 * 和用户消息上的分叉一样只在任务空闲时能点）。`anchorId` 是助手容器里的节点（omp 的用量行，或补行时助手容器本身）。
 */
function AnswerActions({ ctx, anchorId }: { ctx: TspContext; anchorId: string }) {
  const t = useT();
  const idle = useTaskValue(ctx.taskId, (task) => task?.status === "idle");
  // 分叉进行中（建任务、等 omp 起来）源任务还是空闲：连点会建出两个分叉，点了以后到结束前不再收。
  const [forking, setForking] = useState(false);
  // Enter / 空格同点击（role="button" 的 span）。
  const activates = (event: KeyboardEvent): boolean => {
    if (event.key !== "Enter" && event.key !== " ") return false;
    event.preventDefault();
    return true;
  };
  const canFork = idle && !forking;
  const runFork = () => {
    if (!canFork) return;
    setForking(true);
    forkAfterAnswer(ctx.taskId, ctx.sf, anchorId)
      .catch((error: unknown) => reportErrorNow(error))
      .finally(() => setForking(false));
  };
  return (
    <>
      <span
        className="tsp-icon tsp-act"
        data-studio-answer="copy-plain"
        data-testid="tsp-answer-copy-plain"
        role="button"
        tabIndex={0}
        title={t("tsp.copyPlainText")}
        aria-label={t("tsp.copyPlainText")}
        onClick={(event) => copyAnswerPlainText(event.currentTarget, ctx)}
        onKeyDown={(event) => {
          if (activates(event)) copyAnswerPlainText(event.currentTarget, ctx);
        }}
      >
        <TspIcon name="doc" />
      </span>
      <span
        className="tsp-icon tsp-act"
        data-studio-answer="fork"
        data-testid="tsp-answer-fork"
        role="button"
        tabIndex={0}
        aria-disabled={canFork ? undefined : true}
        title={t("tsp.forkAfterAnswer")}
        aria-label={t("tsp.forkAfterAnswer")}
        onClick={runFork}
        onKeyDown={(event) => {
          if (activates(event)) runFork();
        }}
      >
        <TspIcon name="branch" />
      </span>
    </>
  );
}

/**
 * 用户消息上方的悬停按钮行（omp 的复制、回退）：studio 在后面加两个按钮。
 * "编辑"：把这条消息的文字放进输入框，改完自己发（editUserCard；不回溯、不删对话，任务在跑时也能点）。
 * "分叉"：从这条消息之前分出新任务（同会话树面板的分叉），和面板一样只在任务空闲时能点（一轮没结束时主进程拒绝分叉）。
 */
function UserToolsRow(props: NodeProps) {
  const t = useT();
  const blank = useBlank(props, true);
  const { taskId, sf } = props.ctx;
  const idle = useTaskValue(taskId, (task) => task?.status === "idle");
  // Enter / 空格同点击（role="button" 的 span）。
  const onActivate = (run: () => void) => (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    run();
  };
  const edit = () => {
    try {
      editUserCard(taskId, sf, props.node.id);
    } catch (error) {
      reportErrorNow(error);
    }
  };
  const fork = () => {
    if (!idle) return;
    forkFromUserCard(taskId, sf, props.node.id).catch((error: unknown) => reportErrorNow(error));
  };
  return (
    <div {...nodeDomProps(props, "tsp-row", { className: stackClasses(props.node.p), blank })}>
      <TspChildren {...props} />
      <span
        className="tsp-icon tsp-act"
        data-role="omp.user.tool"
        data-testid="tsp-user-edit"
        role="button"
        tabIndex={0}
        title={t("tsp.editMessage")}
        aria-label={t("tsp.editMessage")}
        onClick={edit}
        onKeyDown={onActivate(edit)}
      >
        <TspIcon name="pen" />
      </span>
      <span
        className="tsp-icon tsp-act"
        data-role="omp.user.tool"
        data-testid="tsp-user-fork"
        role="button"
        tabIndex={0}
        aria-disabled={idle ? undefined : true}
        title={t("tsp.forkHere")}
        aria-label={t("tsp.forkHere")}
        onClick={fork}
        onKeyDown={onActivate(fork)}
      >
        <TspIcon name="branch" />
      </span>
    </div>
  );
}

function PlainRow(props: NodeProps) {
  const blank = useBlank(props);
  return (
    <div {...nodeDomProps(props, "tsp-row", { className: stackClasses(props.node.p), blank })}>
      <TspChildren {...props} />
    </div>
  );
}

// ───────── card / section 共用：head 可以是文字，也可以是某个子节点的 id ─────────
/** head 是子节点 id 时返回这个 id（该子节点画在头里，不在 body 里）。 */
function headChildId(node: NodeProps["node"]): string | null {
  const { head } = node.p;
  return typeof head === "string" && node.c.includes(head) ? head : null;
}

function HeadContent({ props, headId }: { props: NodeProps; headId: string | null }) {
  const head = props.node.p.head as TspText | undefined;
  if (headId !== null) return <TspNode id={headId} ctx={props.ctx} />;
  return <TspSpans text={head} />;
}

function onHeadKey(toggle: () => void): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
}

/** role → 卡片头图标（规范 Layout/card "Role icon"）：omp.tool.<tool> 按工具，其它按 role 的第二段。 */
function roleIcon(role: unknown): string | null {
  if (typeof role !== "string") return null;
  const parts = role.split(".");
  if (parts[0] === "omp" && parts[1] === "tool" && parts[2]) return toolIconName(parts[2]);
  return parts[1] && resolveIconName(parts[1]) !== null ? parts[1] : null;
}

function StatusChip({ status }: { status: string }) {
  const label = labels.status(status);
  if (label === undefined) return null;
  return (
    <span className="tsp-chip" data-status={status}>
      {status === "running" ? <i className="tsp-chip-dot" /> : <TspIcon name={chipIcon(status)} size={12} />}
      {label}
    </span>
  );
}

function chipIcon(status: string): string {
  return status === "done" ? "check" : status === "error" ? "x" : status === "cancelled" ? "stop" : "clock";
}

/**
 * 用户气泡（omp.user）里有元素被键盘聚焦（ui/input-modality 的 keyboardFocused；鼠标点出来的焦点不算）时给卡片加 data-kbd-focus，
 * tsp.css 据此显示平时只在悬停时出现的工具行。focus / blur 事件里判断，不靠 CSS 的 :has(:focus-visible)。
 */
function useKeyboardFocus(enabled: boolean): {
  "data-kbd-focus"?: "" | undefined;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
} {
  const [focused, setFocused] = useState(false);
  if (!enabled) return {};
  return {
    "data-kbd-focus": focused ? "" : undefined,
    onFocus: (event) => setFocused(keyboardFocused(event.target)),
    onBlur: (event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
        setFocused(false);
    },
  };
}

const USER_BUBBLE_LINES = 12;

export function Card(props: NodeProps) {
  const { node } = props;
  const p = node.p;
  const collapsible = p.collapsible === true;
  const [collapsed, toggle] = useFold(props, collapsible && p.collapsed === true);
  const keyFocus = useKeyboardFocus(p.role === "omp.user");
  const fold = useMemo(() => (collapsible ? { collapsed, expand: toggle } : NO_FOLD), [collapsible, collapsed, toggle]);
  const headId = headChildId(node);
  const hasHead =
    headId !== null || (p.head !== undefined && p.head !== "") || typeof p.status === "string" || collapsible;
  // 用户气泡超过 12 行时收起（studio 加的外观，2026-11-09，issue #9）：同工具输出的 Clamp，点"N more lines"本地展开。
  const lines = collapsed ? previewToLines(p.preview) : p.role === "omp.user" ? USER_BUBBLE_LINES : null;
  const classes = [
    collapsible && "collapsible",
    collapsed && "collapsed",
    collapsed && lines === null && "nopreview",
    p.selected === true && "selected",
    p.inset === true && "inset",
    p.variant === "bare" && "bare",
    !hasHead && "nohead",
  ].filter((c): c is string => typeof c === "string");
  const icon = roleIcon(p.role);
  // 用户气泡悬停时的按钮行（omp.user.tools）画在气泡上方（bottom: 100%）：放进 Clamp 会被它的 mask 裁掉，所以放在 Clamp 外面。
  const isUserTools = (id: string) =>
    p.role === "omp.user" && peekTspNode(props.ctx.taskId, props.ctx.sf, id)?.p.role === "omp.user.tools";
  const bodyIds = node.c.filter((id) => id !== headId);
  const body: ReactNode = (
    <div className="tsp-card-body">
      {bodyIds
        .filter((id) => !isUserTools(id))
        .map((id) => (
          <TspNode key={id} id={id} ctx={props.ctx} />
        ))}
      {p.role === ERROR_CARD_ROLE && <RetryButton taskId={props.ctx.taskId} sf={props.ctx.sf} id={node.id} />}
    </div>
  );
  const outside = bodyIds.filter(isUserTools).map((id) => <TspNode key={id} id={id} ctx={props.ctx} />);
  return (
    <div
      {...nodeDomProps(props, "tsp-card", {
        className: classes.join(" "),
        own: { toggle: collapsible ? toggle : undefined },
      })}
      {...keyFocus}
    >
      {hasHead && (
        <div
          className="tsp-card-head"
          role={collapsible ? "button" : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? !collapsed : undefined}
          onClick={collapsible ? (event) => !event.metaKey && toggle() : undefined}
          onKeyDown={collapsible ? onHeadKey(toggle) : undefined}
        >
          {icon !== null && (
            <span className="tsp-card-ic">
              <TspIcon name={icon} />
            </span>
          )}
          <div className="tsp-head">
            <HeadContent props={props} headId={headId} />
          </div>
          {typeof p.status === "string" && <StatusChip status={p.status} />}
          {collapsible && (
            <span className="tsp-chev" data-collapsed={collapsed || undefined}>
              <ChevronDown size={12} />
            </span>
          )}
        </div>
      )}
      <FoldCtx.Provider value={fold}>
        {collapsed && lines === null && collapsible ? null : lines !== null ? (
          <Clamp
            lines={lines}
            onExpand={collapsed ? toggle : undefined}
            className={p.role === "omp.user" ? "tsp-user-clamp" : undefined}
          >
            {body}
          </Clamp>
        ) : (
          body
        )}
        {outside}
      </FoldCtx.Provider>
    </div>
  );
}

export function Section(props: NodeProps) {
  const { node } = props;
  const p = node.p;
  const collapsible = p.collapsible === true;
  const [collapsed, toggle] = useFold(props, collapsible && p.collapsed === true);
  const headId = headChildId(node);
  const classes = [collapsible && "collapsible", collapsed && "collapsed"].filter(
    (c): c is string => typeof c === "string",
  );
  return (
    <div
      {...nodeDomProps(props, "tsp-section", {
        className: classes.join(" "),
        own: { toggle: collapsible ? toggle : undefined },
      })}
    >
      <div
        className="tsp-section-head"
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        onClick={collapsible ? (event) => !event.metaKey && toggle() : undefined}
        onKeyDown={collapsible ? onHeadKey(toggle) : undefined}
      >
        <span className="tsp-chev" data-collapsed={collapsed || undefined}>
          <ChevronDown size={12} />
        </span>
        <div className="tsp-head">
          <HeadContent props={props} headId={headId} />
        </div>
      </div>
      {!collapsed && (
        <FoldCtx.Provider value={collapsible ? OPEN_FOLD : NO_FOLD}>
          <div className="tsp-section-body">
            {node.c
              .filter((id) => id !== headId)
              .map((id) => (
                <TspNode key={id} id={id} ctx={props.ctx} />
              ))}
          </div>
        </FoldCtx.Provider>
      )}
    </div>
  );
}

export function Rule(props: NodeProps) {
  const label = props.node.p.label as TspText | undefined;
  const bare = label === undefined || label === "";
  return (
    <div {...nodeDomProps(props, "tsp-rule", { className: bare ? "bare" : undefined })} role="separator">
      {!bare && (
        <span className="tsp-rule-label">
          <TspSpans text={label} />
        </span>
      )}
    </div>
  );
}

export function Spacer(props: NodeProps) {
  const size = typeof props.node.p.size === "string" ? props.node.p.size : "md";
  return <div {...nodeDomProps(props, "tsp-spacer", { className: `tsp-sz-${size}` })} aria-hidden="true" />;
}
