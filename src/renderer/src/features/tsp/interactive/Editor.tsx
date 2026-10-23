// `editor` / `input`：文字和光标由 omp 决定，这边是一个透明的 textarea（接键盘、选区、输入法、粘贴）叠在背景层上，
// 背景层按 omp 的 text / decor / ghost / placeholder 画。规范 protocol-input.md「Native editing」：
// - 没有选区时，打字、删除、方向键、Enter 等都按 keys.ts 编码写进伪终端，omp 回新的 text / cursor；
// - Tern 自己的选区（Shift+方向键、拖选、Ctrl+A）上的输入 / 删除 / 粘贴 / 剪切 → `edit` 事件；
// - 点击 / ↑↓ 画出来的行 / Home End 移动光标 → `edit`（from == to）；Ctrl+Z → `undo`；
// - 点击没有焦点的输入框 → `focus`，等 omp 回 focus 操作再拿键盘；
// - 输入法：组合期间交给浏览器（预编辑文字画在光标处），提交时再写进伪终端（有选区则是 edit）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TspEditorProps } from "../../../../../shared/tsp/tsp.generated.ts";
import {
  encodeKey,
  encodePaste,
  isComposingKey,
  routeEditorKey,
  type EditorKeyRoute,
  type EditorKeyState,
} from "../keys.ts";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { spanClass, TspSpans } from "../spans.tsx";
import { useTspSurface } from "../tsp-store.ts";
import { notifyCaretMoved, registerCaretProbe, useCaretOverlayOpen } from "./caret-registry.ts";
import { likeOf } from "./key-event.ts";
import { clampOffset, splitRuns } from "./text-model.ts";

/** 光标在画出来的第一行 / 最后一行？软换行只有渲染这边知道，用同样排版的镜像量。 */
function measureLines(
  mirror: HTMLDivElement,
  field: HTMLTextAreaElement,
  text: string,
  pos: number,
): { firstLine: boolean; lastLine: boolean } {
  const style = getComputedStyle(field);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  mirror.style.width = `${Math.max(0, field.clientWidth - padX)}px`;
  mirror.style.whiteSpace = style.whiteSpace;
  const heightOf = (s: string) => {
    mirror.textContent = `${s}\u200b`;
    return mirror.getBoundingClientRect().height;
  };
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const upToCaret = heightOf(text.slice(0, pos));
  const all = heightOf(text);
  mirror.textContent = "";
  return { firstLine: upToCaret < lineHeight * 1.5, lastLine: Math.abs(all - upToCaret) < lineHeight * 0.5 };
}

export function Editor(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p as TspEditorProps;
  const text = p.text ?? "";
  const cursor = clampOffset(text, p.cursor, text.length);
  const anchor = p.anchor === null || p.anchor === undefined ? null : clampOffset(text, p.anchor, cursor);
  const readonly = p.readonly === true;
  const native = p.mode === undefined && !readonly;
  const single = node.k === "input";

  const surface = useTspSurface(ctx.taskId, ctx.sf);
  const hasFocus = surface?.focus === node.id;
  const overlayOpen = useCaretOverlayOpen(ctx.sf, node.id);

  const field = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const compositionFrom = useRef({ from: 0, to: 0 });
  const moveArmed = useRef(false);
  const knownCursor = useRef(cursor);
  const latest = useRef({ text, cursor, anchor });
  latest.current = { text, cursor, anchor };
  const [composingNow, setComposingNow] = useState(false);
  const [domFocus, setDomFocus] = useState(false);

  /** 把 omp 的 text / cursor / anchor 同步进 textarea（组合期间不动，免得打断输入法）。 */
  const syncFromProps = useCallback(() => {
    const el = field.current;
    if (!el || composing.current) return;
    const { text: t, cursor: c, anchor: a } = latest.current;
    if (el.value !== t) el.value = t;
    const lo = Math.min(a ?? c, c);
    const hi = Math.max(a ?? c, c);
    el.setSelectionRange(lo, hi, a !== null && a > c ? "backward" : "forward");
    knownCursor.current = c;
  }, []);

  useLayoutEffect(() => {
    syncFromProps();
  }, [text, cursor, anchor, syncFromProps]);

  // 高度：随文字长到 maxLines 行后在里面滚；背景层同高同滚动。
  useLayoutEffect(() => {
    const el = field.current;
    const back = backdrop.current;
    if (!el || !back) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const padY = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    const cap = !single && p.maxLines !== undefined && p.maxLines > 0 ? p.maxLines * lineHeight + padY : Infinity;
    const height = Math.min(el.scrollHeight, cap);
    el.style.height = `${height}px`;
    back.style.height = `${height}px`;
    back.scrollTop = el.scrollTop;
  });

  // 光标位置（给锚在它上面的 overlay 量）。
  useEffect(
    () =>
      registerCaretProbe(ctx.sf, node.id, () => {
        const m = marker.current;
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return r.height === 0 ? (m.parentElement?.getBoundingClientRect() ?? null) : r;
      }),
    [ctx.sf, node.id],
  );
  useLayoutEffect(() => {
    notifyCaretMoved();
  }, [text, cursor, p.maxLines]);

  // surface 的 focus 指向这里就拿键盘。
  useEffect(() => {
    if (hasFocus && field.current && document.activeElement !== field.current)
      field.current.focus({ preventScroll: true });
  }, [hasFocus]);

  const sendEdit = useCallback(
    (from: number, to: number, insert: string, caret: number) => {
      ctx.send({
        ev: "edit",
        sf: ctx.sf,
        id: node.id,
        from,
        to,
        text: insert,
        cursor: caret,
        len: latest.current.text.length,
      });
      const el = field.current;
      if (el) el.setSelectionRange(from, from);
      knownCursor.current = caret;
    },
    [ctx, node.id],
  );

  /** 光标换了位置（点击、↑↓、Home/End、折叠选区）→ 一个 from == to 的 edit。 */
  const reportCaret = useCallback(() => {
    const el = field.current;
    if (!el || composing.current || el.selectionStart !== el.selectionEnd) return;
    const pos = el.selectionStart;
    if (pos === knownCursor.current) return;
    sendEdit(pos, pos, "", pos);
  }, [sendEdit]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (!moveArmed.current || document.activeElement !== field.current) return;
      moveArmed.current = false;
      reportCaret();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [reportCaret]);

  // 不经 keydown 的插入（Windows 表情面板、听写）：没有选区写进伪终端，有选区发 edit。
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (composing.current || e.isComposing) return;
      e.preventDefault();
      const data = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
      if (data.length === 0 || e.inputType.startsWith("delete") || readonly) return;
      if (native && el.selectionStart !== el.selectionEnd) {
        sendEdit(el.selectionStart, el.selectionEnd, data, el.selectionStart + data.length);
      } else {
        ctx.keys(data);
      }
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [ctx, native, readonly, sendEdit]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const like = likeOf(e.nativeEvent);
    if (isComposingKey(like)) return;
    const el = e.currentTarget;
    const hasSelection = el.selectionStart !== el.selectionEnd;
    const pasteKey = (e.ctrlKey && e.key.toLowerCase() === "v" && !e.altKey) || (e.shiftKey && e.key === "Insert");
    if (pasteKey) return; // 交给 paste 事件
    moveArmed.current = false;

    let route: EditorKeyRoute = "pty";
    if (native) {
      const wantsLines = e.key === "ArrowUp" || e.key === "ArrowDown";
      const lines = wantsLines && mirror.current ? measureLines(mirror.current, el, el.value, el.selectionStart) : null;
      const state: EditorKeyState = {
        hasSelection,
        empty: el.value.length === 0,
        overlayAtCaret: overlayOpen,
        firstLine: lines?.firstLine ?? false,
        lastLine: lines?.lastLine ?? false,
      };
      route = routeEditorKey(like, state);
    }
    switch (route) {
      case "select":
      case "copy":
      case "cut":
        return; // 浏览器原生：选区扩展、copy / cut 事件（onCut 发 edit）
      case "selectAll":
        e.preventDefault();
        el.select();
        return;
      case "move":
        moveArmed.current = true;
        return;
      case "undo":
        e.preventDefault();
        ctx.send({ ev: "undo", sf: ctx.sf, id: node.id });
        return;
      case "replace": {
        e.preventDefault();
        const from = el.selectionStart;
        const to = el.selectionEnd;
        if (e.key === "Backspace" || e.key === "Delete") sendEdit(from, to, "", from);
        else {
          const insert = e.key === "Enter" ? "\n" : e.key;
          sendEdit(from, to, insert, from + insert.length);
        }
        return;
      }
      case "pty": {
        const data = encodeKey(like);
        if (data === null) return;
        e.preventDefault();
        ctx.keys(data);
        return;
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text/plain");
    const el = e.currentTarget;
    if (pasted.length === 0) {
      // 剪贴板里不是文字（图片）：把 Ctrl+V 交给 omp，由它自己读剪贴板。
      ctx.keys("\x16");
      return;
    }
    if (native && el.selectionStart !== el.selectionEnd) {
      sendEdit(el.selectionStart, el.selectionEnd, pasted, el.selectionStart + pasted.length);
    } else {
      ctx.keys(encodePaste(pasted));
    }
  };

  const onCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    if (!native || el.selectionStart === el.selectionEnd) return;
    e.clipboardData.setData("text/plain", el.value.slice(el.selectionStart, el.selectionEnd));
    sendEdit(el.selectionStart, el.selectionEnd, "", el.selectionStart);
  };

  const onCompositionStart = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = true;
    compositionFrom.current = { from: e.currentTarget.selectionStart, to: e.currentTarget.selectionEnd };
    setComposingNow(true);
  };

  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    const committed = e.data;
    const { from, to } = compositionFrom.current;
    composing.current = false;
    setComposingNow(false);
    if (committed.length > 0 && !readonly) {
      if (native && from !== to) {
        ctx.send({
          ev: "edit",
          sf: ctx.sf,
          id: node.id,
          from,
          to,
          text: committed,
          cursor: from + committed.length,
          len: latest.current.text.length,
        });
        knownCursor.current = from + committed.length;
      } else {
        ctx.keys(committed);
      }
    }
    // 浏览器已把提交的文字写进 textarea：等它的 input 事件过去后恢复成 omp 的文字，真正的文字由 omp 回帧。
    setTimeout(syncFromProps, 0);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readonly || hasFocus) return;
    e.preventDefault();
    ctx.send({ ev: "focus", sf: ctx.sf, id: node.id });
  };

  const onMouseUp = () => {
    if (!native || !hasFocus) return;
    setTimeout(reportCaret, 0);
  };

  const runs = useMemo(() => splitRuns(text.length, p.decor ?? [], cursor), [text.length, p.decor, cursor]);
  const showGhost = !composingNow && (p.ghost ?? "").length > 0 && cursor === text.length;
  const showPlaceholder = text.length === 0 && !composingNow && !showGhost;
  const markerAt = runs.findIndex((r) => r.from >= cursor);

  const caretNode = <span key="caret" ref={marker} className="tspi-caret" aria-hidden="true" />;
  const parts: React.ReactNode[] = [];
  runs.forEach((run, i) => {
    if (i === markerAt) parts.push(caretNode);
    const piece = text.slice(run.from, run.to);
    parts.push(
      run.tokens === "" ? (
        piece
      ) : (
        <span key={`r${run.from}`} className={spanClass(run.tokens)}>
          {piece}
        </span>
      ),
    );
  });
  if (markerAt === -1) parts.push(caretNode);

  const className = [
    "tspi-editor",
    single ? "tspi-input" : "",
    hasFocus ? "focused" : "",
    readonly ? "readonly" : "",
    text.length === 0 ? "empty" : "",
    p.lang !== undefined ? "code" : "",
    composingNow ? "composing" : "",
    domFocus ? "dom-focus" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      {...nodeDomProps(props, className, { pointer: false, noTitle: true })}
      data-mode={p.mode?.toLowerCase()}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
    >
      {p.prompt !== undefined ? (
        <span className="tspi-ed-prompt" aria-hidden="true">
          <TspSpans text={p.prompt} />
        </span>
      ) : null}
      <div className="tspi-ed-box">
        <div ref={backdrop} className="tspi-ed-back" aria-hidden="true">
          {parts}
          {showGhost ? <span className="tspi-ed-ghost">{p.ghost}</span> : null}
          {showPlaceholder ? (
            <span className="tspi-ed-ph">
              <TspSpans text={p.placeholder} />
            </span>
          ) : null}
          {"\u200b"}
        </div>
        <textarea
          ref={field}
          className="tspi-ed-field"
          data-tspi-keys=""
          rows={1}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          readOnly={readonly}
          aria-label={typeof p.placeholder === "string" ? p.placeholder : undefined}
          aria-multiline={!single}
          wrap={single ? "off" : "soft"}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCut={onCut}
          onScroll={(e) => {
            if (!backdrop.current) return;
            backdrop.current.scrollTop = e.currentTarget.scrollTop;
            backdrop.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onFocus={() => setDomFocus(true)}
          onBlur={() => setDomFocus(false)}
        />
        <div ref={mirror} className="tspi-ed-mirror" aria-hidden="true" />
      </div>
      {p.mode !== undefined ? (
        <span className="tspi-ed-mode" data-mode={p.mode.toLowerCase()} title={`Mode: ${p.mode}`}>
          {p.mode}
        </span>
      ) : null}
    </div>
  );
}
