// 按钮：omp 18.14.2 起声明了 `button` 就发 `button` 节点（文字 / 图标 / 快捷键 / variant / size / on / disabled / busy 都在 props 里，
// role 仍是 `omp.btn`）；更早的 omp 发 role `omp.btn` 的 `row`（子节点是文字、图标、`kbd`）。两种都画成 ui 的按钮（同一个组件）。
// - 点一下执行 `actions.click`（没有就是 `click`，规范 TspButtonProps）：一般是发 `action` 事件；带 href 的 open / copy 由终端自己做（runAction）。
// - disabled / busy 的按钮什么都不发（规范）；disabled 是字符串时它就是悬停提示。旧 row 形状里禁用的按钮本来就不带 actions。
// - 按下不抢焦点，键盘留在原处（提问对话框根节点、输入框）；快捷键是按钮里尾随的淡色小字（Windows 键名），不画键帽框。
// - 尺寸：role `omp.btn`（门、弹窗底栏）一律 sm（omp 不给 size，规范默认的 md 在门里太大）；其它按 omp 给的 size，默认 md。
// 门（gate.ts）、旁路提问（btw.ts）、上下文报告（context-report.ts）只看 role 和 actions，两种形状都认得出。
import type { MouseEvent } from "react";
import { ASK_BUTTON_ROLE } from "../../../../../shared/tsp/ask-gate.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";
import { Button as UiButton, type ButtonVariant } from "../../../ui/controls.tsx";
import { runAction } from "../actions.ts";
import { gateKeyHint } from "../fmt.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { useTspNode } from "../tsp-store.ts";
import { TspNode } from "../TspChildren.tsx";

const VARIANTS: Record<string, ButtonVariant> = { primary: "primary", danger: "danger", quiet: "quiet" };
const TONE_VARIANTS: Record<string, ButtonVariant> = { accent: "primary", error: "danger" };

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
}

/** 旧 row 形状的一个子节点：kbd 画成尾随的快捷键小字，其余节点（文字、图标）照常画。 */
function RowPart({ id, ctx }: { id: string; ctx: NodeProps["ctx"] }) {
  const child = useTspNode(ctx.taskId, ctx.sf, id);
  if (child === null) return null;
  if (child.k !== "kbd") return <TspNode id={id} ctx={ctx} />;
  const keys = stringList(child.p["keys"]);
  return keys.length === 0 ? null : <span className="ui-hint">{gateKeyHint(keys)}</span>;
}

export function Button(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p;
  const legacy = node.k === "row";
  const dom = nodeDomProps(props, "tsp-btn", { pointer: false });
  const actions = isRecord(p.actions) ? p.actions : null;
  const click = typeof actions?.click === "string" ? actions.click : legacy ? null : "click";
  const reason = typeof p.disabled === "string" ? p.disabled : null;
  const inert = p.disabled === true || reason !== null || p.busy === true;
  const variant = legacy
    ? (TONE_VARIANTS[String(p.tone)] ?? "secondary")
    : (VARIANTS[String(p.variant)] ?? "secondary");
  const size = p.role === ASK_BUTTON_ROLE || p.size === "sm" ? "sm" : "md";
  const text = typeof p.text === "string" ? p.text : "";
  const keys = stringList(p.keys);
  const onClick =
    click === null || inert
      ? undefined
      : (event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          runAction(click, node, ctx, undefined, event);
        };
  return (
    <UiButton
      className={dom.className}
      style={dom.style}
      size={size}
      variant={variant}
      data-id={dom["data-id"]}
      data-role={dom["data-role"]}
      data-href={dom["data-href"]}
      title={reason ?? dom.title}
      aria-label={dom["aria-label"] ?? (text === "" && typeof p.title === "string" ? p.title : undefined)}
      aria-pressed={legacy || typeof p.on !== "boolean" ? undefined : p.on}
      disabled={p.disabled === true || reason !== null}
      loading={p.busy === true}
      icon={!legacy && typeof p.icon === "string" ? <TspIcon name={p.icon} size={14} /> : undefined}
      hint={keys.length > 0 ? gateKeyHint(keys) : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {legacy ? node.c.map((id) => <RowPart key={id} id={id} ctx={ctx} />) : text}
    </UiButton>
  );
}
