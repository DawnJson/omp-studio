// `doc`（omp 19）：用户读、就地改（双击，`edit`）、选中文字批注（`comment`）的 Markdown 文档；omp 的计划评审正文就是它。
// 正文用对话里同一个 Markdown 组件画；批注在正文里高亮（CSS Highlight API，不改 React 画的 DOM），文后逐条列出引文和批注，可改可删。
// 选区 ↔ 原文偏移的换算在 doc-model.ts。事件：comment / uncomment / editing / change {text}（规范 tsp.generated.ts 的 TspEvent）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../../i18n/use-t.ts";
import { Markdown } from "../../../markdown/index.ts";
import { Button, IconButton, Textarea } from "../../../ui/controls.tsx";
import { loadImageHref, openHref } from "../actions.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import {
  blockAt,
  blockStarts,
  commentAnchor,
  locateComment,
  locateSelection,
  readComments,
  readJump,
  sortComments,
  type DocComment,
} from "./doc-model.ts";
import "./doc.css";

/** 停止打字多久发一次 change（规范：约 300 ms）。 */
const CHANGE_DEBOUNCE_MS = 300;
/** 选区停下多久才出批注按钮（拖选、键盘选中时不跟着闪）。 */
const SELECTION_SETTLE_MS = 150;

// ───── 批注高亮：整个页面共用两个 Highlight 名字，各个 doc 把自己的范围登记进来 ─────

const HIGHLIGHT = "tsp-doc-comment";
const HIGHLIGHT_ACTIVE = "tsp-doc-comment-active";
const registered = new Map<symbol, { all: Range[]; active: Range[] }>();

function publishHighlights(): void {
  if (typeof Highlight === "undefined") return;
  const all: Range[] = [];
  const active: Range[] = [];
  for (const entry of registered.values()) {
    all.push(...entry.all);
    active.push(...entry.active);
  }
  CSS.highlights.set(HIGHLIGHT, new Highlight(...all));
  CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(...active));
}

/** 不是正文文字的部分（代码块头、KaTeX 给读屏的 MathML）：不参与对位。 */
const NOT_TEXT = ".md-codehead, .katex-mathml, button";

/** 从第 from 块起往后所有块的文字节点和它们连起来的文字。 */
function blockText(blocks: readonly Element[], from: number): { text: string; nodes: { node: Text; start: number }[] } {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (const block of blocks.slice(from)) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.parentElement?.closest(NOT_TEXT)) continue;
      nodes.push({ node: node as Text, start: text.length });
      text += node.nodeValue ?? "";
    }
  }
  return { text, nodes };
}

function rangeOf(nodes: readonly { node: Text; start: number }[], from: number, to: number): Range | null {
  const at = (offset: number, end: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const entry = nodes[i]!;
      if (end ? entry.start < offset : entry.start <= offset) return { node: entry.node, offset: offset - entry.start };
    }
    return null;
  };
  const start = at(from, false);
  const end = at(to, true);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

// ───── jump：同一个评审里 omp 换节点 id 重建正文时会带着上一次的 jump，已经滚过的 n 不再滚 ─────

const appliedJumps = new Map<string, number>();

// ───── 组件 ─────

interface Pending {
  quote: string;
  at: number;
  x: number;
  y: number;
}

export function Doc(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p;
  const t = useT();
  const text = typeof p.text === "string" ? p.text : "";
  const canEdit = p.edit === true;
  const canComment = p.comment === true;
  const comments = useMemo(() => sortComments(text, readComments(p.comments)), [text, p.comments]);
  const jump = readJump(p.jump);
  const jumpHeading = jump?.heading ?? -1;
  const jumpN = jump?.n ?? null;
  const starts = useMemo(() => blockStarts(text), [text]);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const { taskId } = ctx;
  const openFile = useCallback((href: string) => openHref(href, { taskId }), [taskId]);
  const loadImage = useCallback((href: string) => loadImageHref(href, { taskId }), [taskId]);

  // ── 就地编辑 ──
  const [draft, setDraft] = useState<string | null>(null);
  const sent = useRef("");
  const changeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const source = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  const sendChange = useCallback(
    (next: string) => {
      clearTimeout(changeTimer.current);
      if (next === sent.current) return;
      sent.current = next;
      ctx.send({ ev: "change", sf: ctx.sf, id: node.id, text: next });
    },
    [ctx, node.id],
  );
  const startEditing = () => {
    if (!canEdit || editing) return;
    sent.current = text;
    setDraft(text);
    ctx.send({ ev: "editing", sf: ctx.sf, id: node.id, on: true });
  };
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const stopEditing = useCallback(() => {
    const current = draftRef.current;
    if (current === null) return;
    sendChange(current);
    setDraft(null);
    ctx.send({ ev: "editing", sf: ctx.sf, id: node.id, on: false });
  }, [ctx, node.id, sendChange]);
  const edit = (next: string) => {
    setDraft(next);
    clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => sendChange(next), CHANGE_DEBOUNCE_MS);
  };
  useEffect(() => () => clearTimeout(changeTimer.current), []);
  // 在编辑框外按下 = 结束编辑。
  useEffect(() => {
    if (!editing) return undefined;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && source.current?.contains(event.target)) return;
      stopEditing();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing, stopEditing]);
  // 编辑框随内容长高，滚动交给外面的正文区。
  useLayoutEffect(() => {
    const el = source.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  useEffect(() => {
    if (editing) source.current?.focus();
  }, [editing]);
  const onSourceKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    stopEditing();
  };

  // ── 跳到第 N 个标题 ──
  const jumpKey = `${taskId}\u0000${ctx.sf}\u0000${typeof p.role === "string" ? p.role : node.id}`;
  useEffect(() => {
    if (jumpN === null) {
      appliedJumps.delete(jumpKey);
      return;
    }
    if (appliedJumps.get(jumpKey) === jumpN) return;
    appliedJumps.set(jumpKey, jumpN);
    body.current?.querySelectorAll("h1, h2, h3, h4, h5, h6")[jumpHeading]?.scrollIntoView({ block: "start" });
  }, [jumpHeading, jumpN, jumpKey]);

  // ── 选中文字 → 批注按钮 ──
  const [pending, setPending] = useState<Pending | null>(null);
  const [composing, setComposing] = useState<Pending | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const startsRef = useRef(starts);
  startsRef.current = starts;
  useEffect(() => {
    if (!canComment || editing) {
      setPending(null);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    const check = () => {
      const selection = document.getSelection();
      const host = body.current;
      const frame = root.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !host || !frame) {
        setPending(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
        setPending(null);
        return;
      }
      const startNode = range.startContainer;
      const startElement = startNode instanceof Element ? startNode : startNode.parentElement;
      const blocks = [...host.querySelectorAll(":scope > .md > .md-block")];
      const index = blocks.findIndex((block) => block.contains(startElement));
      const located = locateSelection(
        textRef.current,
        selection.toString(),
        startsRef.current[Math.max(0, index)] ?? 0,
      );
      if (!located) {
        setPending(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      setPending({ ...located, x: rect.right - frameRect.left, y: rect.bottom - frameRect.top });
    };
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(check, delay);
    };
    const onSelection = () => {
      if (!pointerDown) schedule(SELECTION_SETTLE_MS);
    };
    const onDown = () => {
      pointerDown = true;
      clearTimeout(timer);
    };
    const onUp = () => {
      pointerDown = false;
      schedule(0);
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  }, [canComment, editing]);

  const addComment = (target: Pending, note: string) => {
    const trimmed = note.trim();
    setComposing(null);
    if (trimmed === "") return;
    document.getSelection()?.removeAllRanges();
    ctx.send({ ev: "comment", sf: ctx.sf, id: node.id, quote: target.quote, at: target.at, note: trimmed });
  };
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const saveNote = (comment: DocComment, note: string) => {
    setEditingNote(null);
    const trimmed = note.trim();
    if (trimmed === "") ctx.send({ ev: "uncomment", sf: ctx.sf, id: node.id, comment: comment.id });
    else if (trimmed !== comment.note)
      ctx.send({ ev: "comment", sf: ctx.sf, id: node.id, comment: comment.id, note: trimmed });
  };

  // ── 批注高亮 ──
  const [active, setActive] = useState<string | null>(null);
  const ranges = useRef(new Map<string, Range>());
  const self = useMemo(() => Symbol("doc"), []);
  useLayoutEffect(() => {
    const host = body.current;
    if (!host || editing) {
      ranges.current.clear();
      registered.delete(self);
      publishHighlights();
      return undefined;
    }
    const place = () => {
      const blocks = [...host.querySelectorAll(":scope > .md > .md-block")];
      const next = new Map<string, Range>();
      for (const comment of comments) {
        const anchor = commentAnchor(text, comment);
        if (anchor < 0) continue;
        const index = blockAt(starts, anchor);
        const rendered = blockText(blocks, index);
        const found = locateComment(text, comment, starts[index] ?? 0, rendered.text);
        const range = found && rangeOf(rendered.nodes, found.from, found.to);
        if (range) next.set(comment.id, range);
      }
      ranges.current = next;
      registered.set(self, {
        all: [...next.values()],
        active: active === null ? [] : [next.get(active)].filter((range): range is Range => range !== undefined),
      });
      publishHighlights();
    };
    place();
    // 代码高亮、KaTeX 之后才换掉文字节点：跟着重新对位。
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    });
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text, comments, starts, editing, active, self]);
  useEffect(
    () => () => {
      registered.delete(self);
      publishHighlights();
    },
    [self],
  );
  const reveal = (id: string) => {
    const range = ranges.current.get(id);
    const anchor = range?.startContainer.parentElement;
    anchor?.scrollIntoView({ block: "center" });
  };

  return (
    <div ref={root} {...nodeDomProps(props, "tsp-doc", { pointer: false })} data-editing={editing || undefined}>
      {draft !== null ? (
        <Textarea
          ref={source}
          className="tsp-doc-source"
          mono
          value={draft}
          onChange={edit}
          onKeyDown={onSourceKey}
          aria-label={t("tsp.docSource")}
        />
      ) : (
        <div
          ref={body}
          className="tsp-doc-body"
          tabIndex={canEdit ? 0 : undefined}
          onMouseDown={(event) => {
            // 双击进编辑，不顺带选中一个词（也就不会触发选中即复制）。
            if (canEdit && event.detail >= 2) event.preventDefault();
          }}
          onDoubleClick={startEditing}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && (event.key === "Enter" || event.key === "F2")) {
              event.preventDefault();
              startEditing();
            }
          }}
        >
          <Markdown source={text} openFile={openFile} loadImage={loadImage} />
        </div>
      )}
      {comments.length > 0 ? (
        <ul className="tsp-doc-notes">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="tsp-doc-note"
              data-testid="tsp-doc-note"
              data-active={active === comment.id || undefined}
              onMouseEnter={() => setActive(comment.id)}
              onMouseLeave={() => setActive(null)}
            >
              <button type="button" className="tsp-doc-quote" onClick={() => reveal(comment.id)}>
                {comment.quote.replace(/\s+/g, " ").trim()}
              </button>
              {editingNote === comment.id ? (
                <NoteEditor
                  initial={comment.note}
                  onSave={(note) => saveNote(comment, note)}
                  onCancel={() => setEditingNote(null)}
                />
              ) : (
                <div className="tsp-doc-note-row">
                  <p className="tsp-doc-note-text">{comment.note}</p>
                  {canComment ? (
                    <span className="tsp-doc-note-actions">
                      <IconButton label={t("tsp.docEditNote")} onClick={() => setEditingNote(comment.id)}>
                        <TspIcon name="pen" />
                      </IconButton>
                      <IconButton
                        label={t("tsp.docDeleteNote")}
                        onClick={() => ctx.send({ ev: "uncomment", sf: ctx.sf, id: node.id, comment: comment.id })}
                      >
                        <TspIcon name="trash" />
                      </IconButton>
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {pending !== null && composing === null ? (
        <div className="tsp-doc-pop" style={{ left: `${pending.x}px`, top: `${pending.y}px` }}>
          <Button
            size="sm"
            icon={<TspIcon name="message" />}
            testId="tsp-doc-comment"
            // 按下不抢走选区。
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setComposing(pending);
              setPending(null);
            }}
          >
            {t("tsp.docComment")}
          </Button>
        </div>
      ) : null}
      {composing !== null ? (
        <div className="tsp-doc-pop tsp-doc-compose" style={{ left: `${composing.x}px`, top: `${composing.y}px` }}>
          <NoteEditor initial="" onSave={(note) => addComment(composing, note)} onCancel={() => setComposing(null)} />
        </div>
      ) : null}
    </div>
  );
}

/** 写 / 改一条批注：Enter 保存，Shift+Enter 换行，Esc 取消。 */
function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave(note: string): void; onCancel(): void }) {
  const t = useT();
  const [note, setNote] = useState(initial);
  return (
    <div className="tsp-doc-editor">
      <Textarea
        value={note}
        onChange={setNote}
        rows={2}
        autoFocus
        testId="tsp-doc-note-input"
        aria-label={t("tsp.docComment")}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSave(note);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <span className="tsp-doc-editor-actions">
        <Button size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" variant="primary" disabled={note.trim() === ""} onClick={() => onSave(note)}>
          {t("tsp.docComment")}
        </Button>
      </span>
    </div>
  );
}
