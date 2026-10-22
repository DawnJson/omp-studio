// omp 的提问对话框（dock 里 role `omp.editor.ask`）：多题时有 Review 页，那一页没有 list，没人拿键盘，
// Enter / Ctrl+Enter 没人接，Esc 落到 body 上还会被输入框当成"停止任务"。这里让对话框根节点自己接键盘（和 list 一样把
// 按键编码写进伪终端），焦点被换页拆掉时拿回来；底栏按钮（`omp.btn`）画成真按钮。
import { useEffect, useRef } from "react";
import { encodeKey } from "../keys.ts";
import type { NodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { TspChildren } from "../TspChildren.tsx";
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

/**
 * 提问 / 审批的按钮（role `omp.btn`）画成真按钮：点一下发节点自己的 `actions.click`（`action` 事件，实录里 submit / note /
 * hide / show 都有效）。点按钮不抢焦点，键盘留在原处（提问对话框根节点）。
 */
export function AskButtonRow(props: NodeProps & { dom: NodeDomProps }) {
  const { dom } = props;
  return (
    <button
      type="button"
      className={`${dom.className} tspi-ask-btn`}
      data-id={dom["data-id"]}
      data-role={dom["data-role"]}
      data-tone={dom["data-tone"]}
      title={dom.title}
      style={dom.style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={dom.onClick}
    >
      <TspChildren {...props} />
    </button>
  );
}
