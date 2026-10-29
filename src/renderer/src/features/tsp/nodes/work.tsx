// 工作类节点：tool、agent、checklist（规范 Tool, Agent and Task Kinds）。
import { finished, phaseMarkKind, readPhases, type Item, type ItemStatus, type Phase } from "./checklist-model.ts";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { TspPickerAction, TspText } from "../../../../../shared/tsp/tsp.generated.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";
import { labels } from "../labels.ts";
import { Check, ChevronDown, CopyIcon } from "../../../icons.tsx";
import { copyText, openHref, runAction } from "../actions.ts";
import { Clamp } from "../Clamp.tsx";
import { FoldCtx, NO_FOLD, OPEN_FOLD, type FoldState } from "../fold-context.ts";
import { clamp01, formatCost, formatCount, formatElapsed } from "../fmt.ts";
import { toolIconName } from "../icon-names.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { asArray, asNumber, asString } from "../props-util.ts";
import { tokenizeCommand } from "../shell-tokens.ts";
import { resolveLanguage } from "../../../markdown/highlight-languages.ts";
import { useHighlighted } from "../../../markdown/highlight.ts";
import { Tokens } from "../use-highlighted.tsx";
import { plainText, semanticOf, TspSpans } from "../spans.tsx";
import { TspNode } from "../TspChildren.tsx";
import { peekTspNode } from "../tsp-store.ts";
import { useFold } from "../use-fold.ts";
import { useEntrance } from "../entrance.ts";
import { useAge } from "../use-clock.ts";
import { useTspEnded } from "../tsp-context.ts";

// ───────── tool ─────────

const KNOWN_STATUS = ["pending", "running", "done", "error", "cancelled"] as const;
type ToolStatus = (typeof KNOWN_STATUS)[number];

function toolStatus(value: unknown): ToolStatus {
  return KNOWN_STATUS.find((status) => status === value) ?? "pending";
}

/** `+8 −1` 这样的 meta 字符串：`+N` 着添加色，`-N` / `−N` 着删除色。 */
function MetaText({ text }: { text: TspText }) {
  if (typeof text !== "string") return <TspSpans text={text} />;
  return (
    <>
      {text.split(/(\s+)/).map((word, index) =>
        /^\+\d+$/.test(word) ? (
          <span key={index} className="add">
            {word}
          </span>
        ) : /^[-−]\d+$/.test(word) ? (
          <span key={index} className="del">
            {word}
          </span>
        ) : (
          <Fragment key={index}>{word}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * 命令行着色：bash（含没给 lang）走手写的 shell 分词，其它 lang（用户用 `!` / `$` 跑的 python / js 等）走 highlight()。
 * bash 不走 highlight()：Shiki 的 bash 语法把子命令、选项、普通参数都标成 string，`$VAR` 不着色，
 * 比 shell-tokens.ts 的 程序词 / 选项 / 字符串 / 变量 / 运算符 差，而且要等语言包异步加载，列表里会闪一下。
 */
function CommandText({ text, lang }: { text: string; lang: string | undefined }) {
  const resolved = lang === undefined ? "bash" : resolveLanguage(lang);
  const shell = resolved === "bash";
  const tokens = useHighlighted(text, shell ? null : resolved);
  if (!shell) {
    if (!tokens) return <>{text}</>;
    return (
      <>
        {tokens.map((line, index) => (
          <Fragment key={index}>
            {index > 0 && "\n"}
            <Tokens tokens={line} fallback="" />
          </Fragment>
        ))}
      </>
    );
  }
  return (
    <>
      {tokenizeCommand(text).map((token, index) =>
        token.kind === "text" ? (
          <Fragment key={index}>{token.text}</Fragment>
        ) : (
          <span key={index} className={token.kind}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

function Target({ p }: { p: Readonly<Record<string, unknown>> }) {
  const target = p.target as TspText | undefined;
  if (target === undefined) return null;
  const kind = asString(p.targetKind) ?? "text";
  let body: ReactNode;
  if (typeof target !== "string") body = <TspSpans text={target} />;
  else if (kind === "command") body = <CommandText text={target} lang={asString(p.lang)} />;
  else if (kind === "path") {
    const match = /^(.*?)(:\d+(?:[-:]\d+)?)?$/.exec(target);
    const path = match?.[1] ?? target;
    const position = match?.[2];
    const cut = path.lastIndexOf("/") + 1;
    body = (
      <>
        <span className="dir">{path.slice(0, cut)}</span>
        <span className="name">{path.slice(cut)}</span>
        {position && <span className="ln">{position}</span>}
      </>
    );
  } else if (kind === "pattern" || kind === "query") {
    body = (
      <>
        <span className="q">“</span>
        {target}
        <span className="q">”</span>
      </>
    );
  } else body = target;
  return (
    <span className={`tsp-tool-target ${kind}`} title={asString(p.href)}>
      {body}
    </span>
  );
}

/**
 * 这次渲染里从运行中变成完成：true 到 `settle()` 为止（卡片重挂载也清零）。
 * 工具卡的 ✓ 只在这段时间里画出、停一下再淡出（omp 的完成卡本来没有 ✓，淡出后和重新打开时看到的一样）；子代理行的 ✓ 常驻，只是这次画出来。
 */
function useJustFinished(running: boolean): [boolean, () => void] {
  const [finished, setFinished] = useState(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setFinished(true);
    else if (running) setFinished(false);
    wasRunning.current = running;
  }, [running]);
  return [finished, () => setFinished(false)];
}

function ToolStatusGlyph({ status, fresh, settle }: { status: ToolStatus; fresh: boolean; settle(): void }) {
  if (status === "running") return <i className="tsp-tool-spin" />;
  if (status === "error") return <TspIcon name="x-circle" />;
  if (status === "cancelled") return <TspIcon name="slash-circle" />;
  if (status === "done" && fresh)
    return (
      <span
        className="tsp-draw-check"
        data-testid="tsp-tool-check"
        onAnimationEnd={(event) => {
          if (event.animationName === "tsp-check-out") settle();
        }}
      >
        <TspIcon name="check" />
      </span>
    );
  return null;
}

/** 折叠时怎么处理 body：{lines} 头、{tail} 尾、"children" 整体保留由子节点自己夹紧、其它隐藏。 */
type ToolPreview = { mode: "lines"; n: number } | { mode: "tail"; n: number } | { mode: "children" } | { mode: "none" };

function toolPreview(preview: unknown): ToolPreview {
  if (preview === "children") return { mode: "children" };
  if (isRecord(preview)) {
    const tail = asNumber(preview.tail);
    const lines = asNumber(preview.lines);
    if (tail !== undefined && tail >= 1) return { mode: "tail", n: Math.floor(tail) };
    if (lines !== undefined && lines >= 1) return { mode: "lines", n: Math.floor(lines) };
  }
  return { mode: "none" };
}

function ToolTime({ status, age, took }: { status: ToolStatus; age: number | undefined; took: number | undefined }) {
  const live = status === "running" || status === "pending";
  const value = useAge(age, live && age !== undefined);
  if (live ? age === undefined : took === undefined && age === undefined) return null;
  const shown = live ? value : (took ?? age ?? 0);
  return (
    <span className={!live && shown < 1000 ? "tsp-tool-time fast" : "tsp-tool-time"} role="timer">
      {formatElapsed(shown)}
    </span>
  );
}

export function Tool(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p;
  const reported = toolStatus(p.status);
  // 进程不在了：还在跑的卡片画成已取消（和 `/jobs kill` 之后 omp 自己画的一样），计时停在进程结束那一刻（ToolTime 仍按运行中算）。
  const ended = useTspEnded();
  const status = ended && (reported === "running" || reported === "pending") ? "cancelled" : reported;
  const [justFinished, settleFinished] = useJustFinished(status === "running");
  const collapsible = p.collapsible === true;
  const [collapsed, toggle] = useFold(props, collapsible && p.collapsed === true);
  const preview = toolPreview(p.preview);
  const inline = p.frame === "inline";
  const exit = asNumber(p.exit);
  const command =
    asString(p.command) ?? (p.targetKind === "command" && typeof p.target === "string" ? p.target : undefined);
  const badges = asArray(p.badges).filter(isRecord);
  const meta = asArray(p.meta) as TspText[];
  const tools = asArray(p.tools).filter(isRecord) as unknown as TspPickerAction[];
  const note = p.note as TspText | undefined;
  const href = asString(p.href);
  const own = { toggle: collapsible ? toggle : undefined };
  const previewFold = useMemo<FoldState>(() => ({ collapsed: true, expand: toggle }), [toggle]);

  // body：折叠时按 preview 处理；展开或不可折叠时完整显示。
  // ask 完成后 body 第一块 md 是卡片头 target 里那句问题的原样重复：头上已经完整显示（允许折行），body 里不再画第二遍。
  const duplicateId =
    p.name === "ask" && typeof p.target === "string"
      ? node.c.find((id) => {
          const child = peekTspNode(ctx.taskId, ctx.sf, id);
          return child?.k === "md" && child.p.text === p.target;
        })
      : undefined;
  const childIds = node.c.filter((id) => id !== duplicateId);
  const kinds: string[] = childIds.map((id) => peekTspNode(ctx.taskId, ctx.sf, id)?.k ?? "");
  const bodyNodes = childIds.map((id, index) => (
    <Fragment key={id}>
      {index > 0 && kinds[index] !== kinds[index - 1] && <div className="tsp-tool-hr" aria-hidden="true" />}
      <TspNode id={id} ctx={ctx} />
    </Fragment>
  ));
  const body = <div className="tsp-tool-body">{bodyNodes}</div>;
  let content: ReactNode = null;
  let fold = collapsible ? OPEN_FOLD : NO_FOLD;
  const hasBody = childIds.length > 0;
  if (!hasBody) content = null;
  else if (!collapsed) content = body;
  else if (preview.mode === "children") {
    fold = previewFold;
    content = body;
  } else if (preview.mode === "none") content = null;
  else {
    fold = OPEN_FOLD;
    content = (
      <Clamp className="tsp-tool-clamp" lines={preview.n} tail={preview.mode === "tail"} onExpand={toggle}>
        {body}
      </Clamp>
    );
  }

  const classes = [
    inline ? "inline" : "card",
    collapsible && "collapsible",
    collapsed && "collapsed",
    collapsed && (preview.mode === "none" || !hasBody) && "nopreview",
    `st-${status}`,
  ].filter((c): c is string => typeof c === "string");

  const onHeadClick = (event: ReactMouseEvent): void => {
    if (event.metaKey || event.ctrlKey) {
      if (href !== undefined) openHref(href, ctx);
      return;
    }
    if (collapsible) toggle();
  };
  const onHeadKey = (event: KeyboardEvent): void => {
    if (collapsible && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <div
      {...nodeDomProps(props, "tsp-tool", { className: classes.join(" "), own, noTitle: true })}
      data-tk={asString(p.targetKind) ?? "text"}
      data-name={asString(p.name)}
    >
      <i className="tsp-tool-bar" />
      <div
        className="tsp-tool-head"
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        title={asString(p.intent)}
        onClick={onHeadClick}
        onKeyDown={onHeadKey}
      >
        <span className="tsp-tool-ic">
          <TspIcon name={toolIconName(asString(p.name) ?? "")} />
        </span>
        <span className="tsp-tool-line">
          <span className="tsp-tool-title">
            <TspSpans text={p.title as TspText | undefined} />
          </span>
          <Target p={p} />
          {meta.map((m, index) => (
            <span key={index} className="tsp-tool-meta">
              <MetaText text={m} />
            </span>
          ))}
          {badges.map((badge, index) => (
            <span key={index} className="tsp-badge" data-tone={asString(badge.tone)} title={asString(badge.title)}>
              {asString(badge.text)}
            </span>
          ))}
          <span className="tsp-tool-sp" />
          {note !== undefined && (
            <span className="tsp-tool-note">
              <TspSpans text={note} />
            </span>
          )}
          {exit !== undefined && exit !== 0 && (
            <span className="tsp-chip tsp-tool-exit" data-status="error">
              exit {exit}
            </span>
          )}
        </span>
        <ToolTime status={reported} age={asNumber(p.age)} took={asNumber(p.took)} />
        <span className="tsp-tool-st">
          <ToolStatusGlyph status={status} fresh={justFinished} settle={settleFinished} />
        </span>
        {collapsible && (
          <span className="tsp-chev" data-collapsed={collapsed || undefined}>
            <ChevronDown size={12} />
          </span>
        )}
        <span className="tsp-tool-acts" onClick={(event) => event.stopPropagation()}>
          {command !== undefined && (
            <button
              type="button"
              className="tsp-tool-act"
              title={labels.copyCommand}
              aria-label={labels.copyCommand}
              onClick={() => copyText(command)}
            >
              <CopyIcon size={12} />
            </button>
          )}
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className="tsp-tool-act"
              onClick={(event) => runAction(tool.id, node, ctx, own, event)}
            >
              {tool.label ?? tool.id}
              {asArray(tool.keys).map((key, index) => (
                <kbd key={index} className="tsp-key">
                  {String(key)}
                </kbd>
              ))}
            </button>
          ))}
        </span>
      </div>
      <FoldCtx.Provider value={fold}>{content}</FoldCtx.Provider>
    </div>
  );
}

// ───────── agent ─────────

const AGENT_STATUS = ["pending", "running", "done", "failed", "aborted", "idle", "parked"] as const;

function AgentGlyph({ status, fresh }: { status: string; fresh: boolean }) {
  if (status === "running") return <i className="live" />;
  if (status === "done")
    return (
      <span className={fresh ? "tsp-draw-check" : undefined}>
        <TspIcon name="check" size={12} />
      </span>
    );
  if (status === "failed") return <TspIcon name="x" size={12} />;
  if (status === "aborted") return <TspIcon name="slash-circle" size={12} />;
  return <i className="hollow" />;
}

function SmallTime({
  age,
  running,
  fallback,
}: {
  age: number | undefined;
  running: boolean;
  fallback?: number | undefined;
}) {
  const value = useAge(age, running && age !== undefined);
  const shown = running ? (age === undefined ? undefined : value) : (fallback ?? age);
  if (shown === undefined) return null;
  return (
    <span className="time" role="timer">
      {formatElapsed(shown)}
    </span>
  );
}

export function Agent(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p;
  const statusRaw = asString(p.status);
  const reported = AGENT_STATUS.find((s) => s === statusRaw) ?? "pending";
  const running = reported === "running" || reported === "pending";
  // 进程不在了：同工具卡，还在跑的子代理画成已中止，计时停住。
  const ended = useTspEnded();
  const status = ended && running ? "aborted" : reported;
  const collapsible = p.collapsible === true;
  const [collapsed, toggle] = useFold(props, collapsible && p.collapsed === true);
  const stats = isRecord(p.stats) ? p.stats : {};
  const tool = isRecord(p.tool) ? p.tool : null;
  const retry = isRecord(p.retry) ? p.retry : null;
  const model = asString(p.model);
  const thinking = asString(p.thinking);
  const thinkingTone = thinking !== undefined ? semanticOf(thinking) : null;
  const badges = asArray(p.badges).filter(isRecord);
  const depth = Math.min(6, Math.max(0, Math.floor(asNumber(p.depth) ?? 0)));
  const [justFinished] = useJustFinished(status === "running");
  const entrance = useEntrance(ctx.taskId, ctx.sf, node.id);
  const doneFraction = asNumber(stats.done);
  const context = asNumber(stats.context);
  const contextFraction = context === undefined ? undefined : context > 1 ? clamp01(context / 100) : clamp01(context);
  const contextLabel =
    asString(stats.contextLabel) ??
    (contextFraction === undefined ? "" : labels.agentContext(Math.round(contextFraction * 100)));
  const tools = asNumber(stats.tools);
  const requests = asNumber(stats.requests);
  const tokens = asNumber(stats.tokens);
  const cost = asNumber(stats.cost);
  const retryAt = retry ? asNumber(retry.age) : undefined;
  const hasKids = node.c.length > 0;
  const own = { toggle: collapsible ? toggle : undefined };
  const intent = tool ? (tool.intent as TspText | undefined) : undefined;
  return (
    <div
      {...nodeDomProps(props, "tsp-agent", {
        className: [`st-${status}`, collapsible && "collapsible", collapsed && "collapsed", entrance?.className]
          .filter((c): c is string => typeof c === "string")
          .join(" "),
        own,
        style: { "--tsp-depth": depth, ...entrance?.style } as CSSProperties,
      })}
      data-enter={entrance?.["data-enter"]}
    >
      <div
        className="tsp-agent-row"
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        onClick={collapsible ? (event) => !event.metaKey && toggle() : undefined}
        onKeyDown={
          collapsible
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
      >
        <span className="tsp-agent-g">
          <AgentGlyph status={status} fresh={justFinished} />
        </span>
        <span className="tsp-agent-name">{asString(p.name) ?? ""}</span>
        {asString(p.agent) !== undefined && <span className="tsp-badge">{asString(p.agent)}</span>}
        {badges.map((badge, index) => (
          <span key={index} className="tsp-badge" data-tone={asString(badge.tone)}>
            {asString(badge.text)}
          </span>
        ))}
        <span className="tsp-agent-task" title={plainText(p.task as TspText | undefined)}>
          <TspSpans text={p.task as TspText | undefined} />
        </span>
        <span className="tsp-sp" />
        <span className="tsp-agent-stats">
          {model !== undefined && (
            <span className="model" title={model}>
              <i className="dot" style={{ background: thinkingTone ? `var(--tsp-c-${thinkingTone})` : undefined }} />
              {model.slice(model.lastIndexOf("/") + 1)}
            </span>
          )}
          {tools !== undefined && tools > 0 && (
            <span className="tools" title={labels.agentTools(tools)}>
              <TspIcon name="wrench" size={11} />
              {tools}
            </span>
          )}
          {requests !== undefined && requests > 0 && <span className="req">{labels.agentRequests(requests)}</span>}
          {status === "running" && doneFraction !== undefined && (
            <span className="done">
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                <circle className="tr" cx="8" cy="8" r="5.5" />
                <circle
                  className="fl"
                  cx="8"
                  cy="8"
                  r="5.5"
                  strokeDasharray={`${clamp01(doneFraction) * 34.56} 34.56`}
                />
              </svg>
              {Math.round(clamp01(doneFraction) * 100)}%
            </span>
          )}
          {contextFraction !== undefined ? (
            <span
              className={
                contextFraction >= 0.9
                  ? "tsp-agent-meter bad"
                  : contextFraction >= 0.75
                    ? "tsp-agent-meter warn"
                    : "tsp-agent-meter"
              }
              title={contextLabel}
              aria-label={contextLabel}
            >
              <i className="fill" style={{ width: `${contextFraction * 100}%` }} />
            </span>
          ) : (
            tokens !== undefined && <span className="tok">{formatCount(tokens)}</span>
          )}
          {cost !== undefined && cost > 0 && <span className="cost">{formatCost(cost)}</span>}
          {Object.keys(stats).length > 0 && (
            <SmallTime age={asNumber(stats.age)} running={running} fallback={asNumber(stats.took)} />
          )}
        </span>
        {collapsible && (
          <span className="tsp-chev" data-collapsed={collapsed || undefined}>
            <ChevronDown size={12} />
          </span>
        )}
      </div>
      {retry !== null ? (
        <div className="tsp-agent-now" title={asString(retry.error)}>
          <span className="retry">
            {labels.agentRetry(
              asNumber(retry.attempt) ?? 1,
              asNumber(retry.max) ?? 1,
              formatElapsed(Math.max(0, (asNumber(retry.delay) ?? 0) - (retryAt ?? 0)), "clock"),
            )}
          </span>
        </div>
      ) : (
        status === "running" &&
        tool !== null && (
          <div className="tsp-agent-now">
            <span className="ic">
              <TspIcon name={toolIconName(asString(tool.name) ?? "")} size={12} />
            </span>
            <span className="tn">{asString(tool.name)}</span>
            {intent !== undefined && (
              <span className="intent">
                <TspSpans text={intent} />
              </span>
            )}
            <SmallTime age={asNumber(tool.age)} running />
          </div>
        )
      )}
      {hasKids && !collapsed && (
        <FoldCtx.Provider value={OPEN_FOLD}>
          <div className="tsp-agent-kids">
            {node.c.map((id) => (
              <TspNode key={id} id={id} ctx={ctx} />
            ))}
          </div>
        </FoldCtx.Provider>
      )}
    </div>
  );
}

// ───────── checklist ─────────

/** 阶段行最前面的标记：做完是对勾（和待办板一致），否则是进度环（phaseMarkKind）。 */
function PhaseMark({ done, total }: { done: number; total: number }) {
  if (phaseMarkKind(done, total) === "check")
    return (
      <span className="tsp-ck-phase-done" aria-hidden="true">
        <Check size={12} />
      </span>
    );
  const C = 2 * Math.PI * 5.5;
  const fraction = total === 0 ? 0 : done / total;
  return (
    <svg className="tsp-ring" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle className="tr" cx="8" cy="8" r="5.5" />
      <circle className="fl" cx="8" cy="8" r="5.5" strokeDasharray={`${C * fraction} ${C}`} />
    </svg>
  );
}

function ItemGlyph({ status }: { status: ItemStatus }) {
  if (status === "done") return <Check size={12} />;
  if (status === "dropped") return <TspIcon name="minus" size={12} />;
  if (status === "blocked") return <TspIcon name="warn" size={12} />;
  if (status === "active") return <i className="dot" />;
  return <i className="hollow" />;
}

function ChecklistItems({ items, fresh }: { items: readonly Item[]; fresh: ReadonlySet<string> }) {
  return (
    <div className="tsp-ck-items">
      {items.map((item) => (
        <div
          key={item.id}
          className={fresh.has(item.id) ? `tsp-ck-item st-${item.status} fresh` : `tsp-ck-item st-${item.status}`}
        >
          <span className="tsp-ck-g">
            <ItemGlyph status={item.status} />
          </span>
          <span className="tsp-ck-t">
            <TspSpans text={item.text} />
          </span>
          {item.note !== undefined && (
            <div className="tsp-ck-note">
              <TspSpans text={item.note} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FullList({ phases, fresh }: { phases: readonly Phase[]; fresh: ReadonlySet<string> }) {
  // 阶段的折叠是本地的：点阶段行翻转，记在阶段 id 上（规范 Work/checklist）。
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const single = phases.length === 1 && (phases[0]?.title === undefined || plainText(phases[0].title) === "");
  return (
    <>
      {phases.map((phase) => {
        const done = phase.items.filter(finished).length;
        const complete = phase.items.length > 0 && done === phase.items.length;
        const defaultFolded = phase.collapsed ?? complete;
        const folded = flipped.has(phase.id) ? !defaultFolded : defaultFolded;
        const flip = (): void =>
          setFlipped((prev) => {
            const next = new Set(prev);
            if (next.has(phase.id)) next.delete(phase.id);
            else next.add(phase.id);
            return next;
          });
        return (
          <div
            key={phase.id}
            className={["tsp-ck-phase", complete && "done", folded && "folded"].filter(Boolean).join(" ")}
          >
            {!single && (
              <div
                className="tsp-ck-ph"
                role="button"
                tabIndex={0}
                aria-expanded={!folded}
                onClick={flip}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    flip();
                  }
                }}
              >
                <PhaseMark done={done} total={phase.items.length} />
                <span className="t">
                  <TspSpans text={phase.title} />
                </span>
                <span className="n">
                  {done}/{phase.items.length}
                </span>
              </div>
            )}
            {(!folded || single) && <ChecklistItems items={phase.items} fresh={fresh} />}
          </div>
        );
      })}
    </>
  );
}

export function Checklist(props: NodeProps) {
  const { node, ctx } = props;
  const phases = readPhases(node.p.phases);
  const mode = node.p.mode === "hud" || node.p.mode === "reminder" ? node.p.mode : "full";
  // reminder 按规范是"列出未完成条目的提示"：默认展开（omp 不给它 collapsed）；hud 的弹层默认收起。
  const [open, setOpen] = useState(mode === "reminder");
  const all = phases.flatMap((phase) => phase.items);
  const done = all.filter(finished).length;
  // 刚变成 done 的条目带 fresh（勾选和删除线的入场动画只放一次）。
  const previous = useRef<ReadonlyMap<string, ItemStatus>>(new Map());
  const fresh = new Set(
    all
      .filter(
        (item) =>
          item.status === "done" &&
          previous.current.get(item.id) !== undefined &&
          previous.current.get(item.id) !== "done",
      )
      .map((item) => item.id),
  );
  useEffect(() => {
    previous.current = new Map(all.map((item) => [item.id, item.status]));
  });
  const dom = nodeDomProps(props, "tsp-checklist", { className: `${mode}${open && mode !== "full" ? " open" : ""}` });
  if (mode === "hud") {
    const lead = all.find((item) => item.status === "active") ?? all.find((item) => item.status === "pending");
    const label: TspText | undefined = lead ? lead.text : all.length === 0 ? labels.todos : labels.allDone;
    return (
      <div {...dom}>
        <button
          type="button"
          className="tsp-ck-pill"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            ctx.send({ ev: "activate", sf: ctx.sf, id: node.id, item: "hud" });
          }}
        >
          <PhaseMark done={done} total={all.length} />
          <span className="t">
            <TspSpans text={label} />
          </span>
          <span className="n">
            {done}/{all.length}
          </span>
        </button>
        {open && (
          <div className="tsp-ck-pop">
            <FullList phases={phases} fresh={fresh} />
          </div>
        )}
      </div>
    );
  }
  if (mode === "reminder") {
    const openItems = all.filter(
      (item) => item.status === "pending" || item.status === "active" || item.status === "blocked",
    );
    return (
      <div {...dom}>
        <div
          className="tsp-ck-rh"
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen((v) => !v);
            }
          }}
        >
          <span className="ic">
            <TspIcon name="warn" size={12} />
          </span>
          <span className="t">{labels.todosOpen(openItems.length)}</span>
          {node.p.note !== undefined && (
            <span className="n">
              <TspSpans text={node.p.note as TspText} />
            </span>
          )}
          <span className="tsp-chev" data-collapsed={!open || undefined}>
            <ChevronDown size={12} />
          </span>
        </div>
        {open && <ChecklistItems items={openItems} fresh={fresh} />}
      </div>
    );
  }
  return (
    <div {...dom} role="group" aria-label={labels.todosDone(done, all.length)}>
      <FullList phases={phases} fresh={fresh} />
    </div>
  );
}
