// 布局类节点：col、row、card、section、rule、spacer（规范 Layout）。
import type { KeyboardEvent, ReactNode } from "react";
import type { TspPreview, TspSpace, TspText } from "../../../../../shared/tsp/tsp.generated.ts";
import { ChevronDown } from "../../../icons.tsx";
import { Clamp } from "../Clamp.tsx";
import { FoldCtx } from "../fold-context.ts";
import { TspIcon, resolveIconName, toolIconName } from "../icons.tsx";
import { labels } from "../labels.ts";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { TspSpans } from "../spans.tsx";
import { TspChildren, TspNode } from "../TspChildren.tsx";
import { useFold } from "../use-fold.ts";
import { alignTurnCost, withExactCost } from "../turn-cost.ts";
import { TurnCostCtx } from "../turn-cost-context.ts";
import { useTurnCosts } from "../turn-cost-store.ts";
import { useBareTurnIndex, useIsLatestRecap, useUsageRowFromEnd } from "../tsp-store.ts";
import { useSessionExtras } from "../session-extras-store.ts";
import { formatTurnFooter } from "../turn-footer.ts";

const GAPS: readonly TspSpace[] = ["none", "xs", "sm", "md", "lg"];

function stackClasses(p: Readonly<Record<string, unknown>>): string {
  const classes: string[] = [];
  if (typeof p.gap === "string" && GAPS.includes(p.gap as TspSpace)) classes.push(`tsp-gap-${p.gap}`);
  if (typeof p.align === "string") classes.push(`tsp-al-${p.align}`);
  if (p.justify === "between" || p.justify === "end") classes.push(`tsp-js-${p.justify}`);
  if (p.wrap === true) classes.push("tsp-wrap");
  return classes.join(" ");
}

export function Col(props: NodeProps) {
  if (props.node.p.role === "omp.assistant") return <AssistantCol {...props} />;
  return (
    <div {...nodeDomProps(props, "tsp-col", { className: stackClasses(props.node.p) })}>
      <TspChildren {...props} />
    </div>
  );
}

/**
 * omp 的助手消息容器。恢复会话时 omp 不重发每轮末尾的用量行（实测 18.12.4），这里在一轮的最后一个助手消息后面
 * 补一行（数据来自会话文件，见 main/tsp/session-extras.ts）；实时的轮 omp 自己带这一行，不补。
 */
function AssistantCol(props: NodeProps) {
  const { taskId, sf } = props.ctx;
  const { turns } = useSessionExtras(taskId);
  const index = useBareTurnIndex(taskId, sf, props.node.id, turns.length);
  const footer = index >= 0 ? (turns[index] ?? null) : null;
  const text = footer === null ? null : formatTurnFooter(footer);
  return (
    <div {...nodeDomProps(props, "tsp-col", { className: stackClasses(props.node.p) })}>
      <TspChildren {...props} />
      {text !== null && (
        <div className="tsp-row" data-role="omp.turn.usage" data-restored="" title={text.title}>
          <span className="tsp-icon" aria-hidden="true">
            <TspIcon name="time" />
          </span>
          <div className="tsp-text">{text.text}</div>
        </div>
      )}
    </div>
  );
}

/**
 * 空闲回顾（omp.recap）：omp 终端里是 "※ recap: …"，节点里的图标 `history` 只是 TSP 的占位，tsp.css 里隐藏它、改画 ※。
 * 对话里只显示最新的一条：之后又来了新的回顾，这一条就收起（实时每条回顾 omp 都留在对话里，恢复时一条也不重放）。
 */
function RecapRow(props: NodeProps) {
  const { taskId, sf } = props.ctx;
  const latest = useIsLatestRecap(taskId, sf, props.node.id);
  if (!latest) return null;
  const dom = nodeDomProps(props, "tsp-row", { className: stackClasses(props.node.p) });
  return (
    <div {...dom} title={labels.recapTitle}>
      <TspChildren {...props} />
    </div>
  );
}

export function Row(props: NodeProps) {
  if (props.node.p.role === "omp.turn.usage") return <UsageRow {...props} />;
  if (props.node.p.role === "omp.recap") return <RecapRow {...props} />;
  return (
    <div {...nodeDomProps(props, "tsp-row", { className: stackClasses(props.node.p) })}>
      <TspChildren {...props} />
    </div>
  );
}

/** 每轮用量行：omp 把一分钱以下写成 `<$0.01`，按会话文件里的准确费用换掉（文字和 title）。 */
function UsageRow(props: NodeProps) {
  const { taskId, sf } = props.ctx;
  const fromEnd = useUsageRowFromEnd(taskId, sf, props.node.id);
  const cost = alignTurnCost(useTurnCosts(taskId), fromEnd);
  const dom = nodeDomProps(props, "tsp-row", { className: stackClasses(props.node.p) });
  if (dom.title !== undefined) dom.title = withExactCost(dom.title, cost);
  return (
    <div {...dom}>
      <TurnCostCtx.Provider value={cost}>
        <TspChildren {...props} />
      </TurnCostCtx.Provider>
    </div>
  );
}

// ───────── card / section 共用：head 可以是文字，也可以是某个子节点的 id ─────────

/** head 是子节点 id 时返回这个 id（该子节点画在头里，不在 body 里）。 */
export function headChildId(node: NodeProps["node"]): string | null {
  const { head } = node.p;
  return typeof head === "string" && node.c.includes(head) ? head : null;
}

function HeadContent({ props, headId }: { props: NodeProps; headId: string | null }) {
  const head = props.node.p.head as TspText | undefined;
  if (headId !== null) return <TspNode id={headId} ctx={props.ctx} />;
  return <TspSpans text={head} />;
}

function previewLines(preview: TspPreview | undefined): number | null {
  if (preview === "auto") return 10;
  if (preview && typeof preview === "object" && typeof preview.lines === "number") {
    const lines = Math.floor(preview.lines);
    return lines >= 1 ? lines : null;
  }
  return null;
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

export function Card(props: NodeProps) {
  const { node } = props;
  const p = node.p;
  const collapsible = p.collapsible === true;
  const [collapsed, toggle] = useFold(props, collapsible && p.collapsed === true);
  const headId = headChildId(node);
  const hasHead =
    headId !== null || (p.head !== undefined && p.head !== "") || typeof p.status === "string" || collapsible;
  const lines = collapsed ? previewLines(p.preview as TspPreview | undefined) : null;
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
  const body: ReactNode = (
    <div className="tsp-card-body">
      {node.c
        .filter((id) => id !== headId)
        .map((id) => (
          <TspNode key={id} id={id} ctx={props.ctx} />
        ))}
    </div>
  );
  return (
    <div
      {...nodeDomProps(props, "tsp-card", {
        className: classes.join(" "),
        own: { toggle: collapsible ? toggle : undefined },
      })}
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
      <FoldCtx.Provider value={{ collapsed: collapsible ? collapsed : null, expand: collapsible ? toggle : undefined }}>
        {collapsed && lines === null && collapsible ? null : lines !== null ? (
          <Clamp lines={lines} onExpand={toggle}>
            {body}
          </Clamp>
        ) : (
          body
        )}
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
        <FoldCtx.Provider value={{ collapsed: collapsible ? false : null }}>
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
