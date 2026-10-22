// omp 的提问对话框（dock 里 role `omp.editor.ask`）：多题时有 Review 页，那一页没有 list，没人拿键盘，
// Enter / Ctrl+Enter 没人接，Esc 落到 body 上还会被输入框当成"停止任务"。这里让对话框根节点自己接键盘（和 list 一样把
// 按键编码写进伪终端），焦点被换页拆掉时拿回来；底栏按钮（`omp.btn`）画成真按钮。
import { useEffect, useRef } from "react";
import { Button } from "../../../ui/controls.tsx";
import { gateKeyHint } from "../fmt.ts";
import { encodeKey } from "../keys.ts";
import type { NodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { useTspNode } from "../tsp-store.ts";
import { TspChildren, TspNode } from "../TspChildren.tsx";
import { likeOf } from "./key-event.ts";

function isBlankFocus(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

export function AskGateCol(props: NodeProps & { dom: NodeDomProps }) {
  const { ctx, dom } = props;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    if (isBlankFocus() || !document.activeElement?.closest("[data-tspi-keys]")) el.focus({ preventScroll: true });
    // 对话框里最后拿着焦点的元素：它被换页拆掉（焦点掉到 <body>）时才拿回来；用户点到别处（焦点离开又没被拆）不抢。
    let held: Element | null = null;
    const onFocusIn = (e: FocusEvent) => {
      held = e.target instanceof Element ? e.target : null;
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.target === held && e.target instanceof Node && e.target.isConnected && e.relatedTarget !== null)
        held = null;
    };
    const observer = new MutationObserver(() => {
      if (held === null || held.isConnected) return;
      held = null;
      if (isBlankFocus() && el.isConnected) el.focus({ preventScroll: true });
    });
    observer.observe(el, { childList: true, subtree: true });
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      observer.disconnect();
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Esc 是写给 omp 的按键（omp 自己决定取消还是返回），不能冒到 window 上被输入框当成"停止任务"。
    if (e.key === "Escape") e.stopPropagation();
    if (e.defaultPrevented) return;
    // 里面的 list / editor 自己有处理按键的逻辑，只接没人要的键（Review 页、按钮上的键）。
    if (!(e.target instanceof Element) || e.target.closest("[data-tspi-keys]") !== e.currentTarget) return;
    const data = encodeKey(likeOf(e.nativeEvent));
    if (data === null) return;
    e.preventDefault();
    ctx.keys(data);
  };

  return (
    <div
      {...dom}
      ref={root}
      className={`${dom.className} tspi-ask-gate`}
      tabIndex={-1}
      data-tspi-keys=""
      onKeyDown={onKeyDown}
    >
      <TspChildren {...props} />
    </div>
  );
}

/** 按钮里的一个子节点：kbd 画成尾随的淡色快捷键小字（Windows 键名），其余节点照常画。 */
function ButtonPart({ id, ctx }: { id: string; ctx: NodeProps["ctx"] }) {
  const child = useTspNode(ctx.taskId, ctx.sf, id);
  if (child === null) return null;
  if (child.k !== "kbd") return <TspNode id={id} ctx={ctx} />;
  const keys = Array.isArray(child.p["keys"]) ? child.p["keys"].filter((k): k is string => typeof k === "string") : [];
  return keys.length === 0 ? null : <span className="ui-hint">{gateKeyHint(keys)}</span>;
}

/**
 * 提问 / 审批 / omp 弹层的按钮（role `omp.btn`）画成 ui 的 sm 按钮：点一下发节点自己的 `actions.click`（`action` 事件，实录里 submit /
 * note / hide / show 都有效）。点按钮不抢焦点，键盘留在原处（提问对话框根节点）。tone accent 是主按钮，error 是危险按钮；
 * 快捷键是按钮里尾随的小字，不画键帽框。
 */
export function AskButtonRow(props: NodeProps & { dom: NodeDomProps }) {
  const { dom, node, ctx } = props;
  const variant = dom["data-tone"] === "accent" ? "primary" : dom["data-tone"] === "error" ? "danger" : "secondary";
  return (
    <Button
      size="sm"
      variant={variant}
      data-id={dom["data-id"]}
      data-role={dom["data-role"]}
      title={dom.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={dom.onClick}
    >
      {node.c.map((id) => (
        <ButtonPart key={id} id={id} ctx={ctx} />
      ))}
    </Button>
  );
}
