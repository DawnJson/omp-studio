// 输入框本体（Composer 和 DraftComposer 共用）：顶部附件卡片、文本区、顶边拖拽条。
// 文本区里的 `[Image #N, WxH]` / `[Paste #N, +X lines]` 占位符显示成 `#N` 芯片（composer-tokens.ts 的 view）：
// 文本框里放的是 view 文本（芯片是几个零宽控制字符夹着 `#N`），它下面垫一层同字体同宽的底，只给芯片画底色。
// 芯片不能被拆开：光标和选区贴到芯片边上，Backspace / Delete / ← / → 一步越过整个芯片，删掉芯片就删掉对应的附件。
import {
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Attachments } from "./Attachments.tsx";
import { takeCaretRequest, requestCaret } from "./caret-request.ts";
import {
  buildView,
  chipTouching,
  insertPaste,
  removeAttachment,
  snapSelection,
  textToViewOffset,
  viewToText,
  viewToTextOffset,
  type Draft,
  type DraftView,
} from "./composer-tokens.ts";
import { getDraft, setDraft, setDraftText } from "./draft-store.ts";
import { clampFieldHeight, FIELD_KEY_STEP, maxFieldHeight } from "./field-height.ts";
import { commitFieldHeight, previewFieldHeight, useFieldHeight } from "./field-height-store.ts";
import { useChipLabels } from "./use-draft-view.ts";
import "./composer-input.css";

export interface ComposerInputProps {
  draftKey: TaskId;
  draft: Draft;
  view: DraftView;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  disabled?: boolean;
  controls?: string | undefined;
  activeDescendant?: string | undefined;
  addFiles(files: Iterable<File>): Promise<void>;
  /** 用户改了文字（view 里的光标位置）：菜单跟踪光标、历史游标复位。 */
  onEdit(caret: number): void;
  /** 光标移动（view 里的位置）。 */
  onCaret(caret: number): void;
  /** 芯片相关的键处理完之后才轮到它（发送、菜单、历史……）。 */
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
}

const isRawPasteKey = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey || event.altKey) && event.shiftKey && event.key.toLowerCase() === "v";

function renderBackdrop(view: DraftView): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const span of view.spans) {
    if (span.viewStart > cursor) nodes.push(view.text.slice(cursor, span.viewStart));
    nodes.push(
      <span key={span.viewStart} className="composer-chip" data-kind={span.kind}>
        {view.text.slice(span.viewStart, span.viewEnd)}
      </span>,
    );
    cursor = span.viewEnd;
  }
  nodes.push(view.text.slice(cursor));
  return nodes;
}

export function ComposerInput(props: ComposerInputProps) {
  const { draftKey, draft, view, fieldRef, addFiles } = props;
  const t = useT();
  const labels = useChipLabels();
  const backdropRef = useRef<HTMLDivElement>(null);
  const rawPaste = useRef(false);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const userHeight = useFieldHeight();
  const [bounds, setBounds] = useState({ min: 0, max: Number.POSITIVE_INFINITY });
  const [shownHeight, setShownHeight] = useState(0);

  // 主区（<main>）高度变了重新算上限：窗口缩小后输入框不能把对话区挤没。
  useLayoutEffect(() => {
    const field = fieldRef.current;
    const main = field?.closest("main") ?? field?.closest(".composer-stack")?.parentElement;
    if (!field || !main) return;
    const measure = () => {
      const min = Number.parseFloat(getComputedStyle(field).minHeight) || 0;
      setBounds({ min, max: maxFieldHeight(main.clientHeight, min) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    return () => observer.disconnect();
  }, [fieldRef]);

  // 高度：没拖过时 CSS 按内容自动增高（field-sizing: content，上下限是 .composer-field 的 min/max-height），按键时不用脚本量 scrollHeight；
  // 拖过之后是定高（data-sized），夹到 [一行, 主区 60%]。
  const sizedHeight = userHeight === null ? null : clampFieldHeight(userHeight, bounds.min, bounds.max);
  // 文本框排版后的实际高度（拖拽条的起点和 aria-valuenow）、底层的宽度（要扣掉滚动条）和滚动位置都在尺寸变化时从 ResizeObserver 取：
  // 回调在排版之后，读尺寸不会再强制排一次版；内容区宽度变了（滚动条出现、窗口变窄）也会触发。
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const observer = new ResizeObserver(() => {
      setShownHeight(field.offsetHeight);
      const backdrop = backdropRef.current;
      if (backdrop) {
        backdrop.style.width = `${field.clientWidth}px`;
        backdrop.scrollTop = field.scrollTop;
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [fieldRef]);

  // 程序改了文字之后的光标落点。
  useLayoutEffect(() => {
    const field = fieldRef.current;
    const request = takeCaretRequest(draftKey);
    if (!field || request === null) return;
    const position = textToViewOffset(view, request);
    field.setSelectionRange(position, position);
  }, [view, draftKey, fieldRef]);

  const replaceView = (next: string, caretInText: number) => {
    setDraftText(draftKey, viewToText(next, getDraft(draftKey)));
    requestCaret(draftKey, caretInText);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isRawPasteKey(event)) rawPaste.current = true;
    const field = event.currentTarget;
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    const collapsed = field.selectionStart === field.selectionEnd;
    if (!composing && collapsed && !event.shiftKey) {
      const caret = field.selectionStart;
      const before = chipTouching(view, caret, "before");
      const after = chipTouching(view, caret, "after");
      if (event.key === "Backspace" && before !== null) {
        event.preventDefault();
        replaceView(view.text.slice(0, before.viewStart) + view.text.slice(before.viewEnd), before.start);
        return;
      }
      if (event.key === "Delete" && after !== null) {
        event.preventDefault();
        replaceView(view.text.slice(0, after.viewStart) + view.text.slice(after.viewEnd), after.start);
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "ArrowLeft" && before !== null) {
          event.preventDefault();
          field.setSelectionRange(before.viewStart, before.viewStart);
          props.onCaret(before.viewStart);
          return;
        }
        if (event.key === "ArrowRight" && after !== null) {
          event.preventDefault();
          field.setSelectionRange(after.viewEnd, after.viewEnd);
          props.onCaret(after.viewEnd);
          return;
        }
      }
    }
    props.onKeyDown(event);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const raw = rawPaste.current;
    rawPaste.current = false;
    // 资源管理器里复制的文件路径由 preload 处理（已经 preventDefault）。
    if (event.defaultPrevented || raw) return;
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (images.length > 0) {
      event.preventDefault();
      void addFiles(images);
      return;
    }
    const pasted = event.clipboardData.getData("text/plain");
    if (pasted === "") return;
    const field = event.currentTarget;
    const current = getDraft(draftKey);
    const start = viewToTextOffset(view, field.selectionStart);
    const end = viewToTextOffset(view, field.selectionEnd);
    const without = { ...current, text: current.text.slice(0, start) + current.text.slice(end) };
    const inserted = insertPaste(without, pasted, start);
    // 不算大：交给文本框按原样粘贴。Ctrl+Shift+V 永远走这条（omp 的 pasteTextRaw）。
    if (inserted === null) return;
    event.preventDefault();
    setDraft(draftKey, inserted.draft);
    requestCaret(draftKey, inserted.caret);
    props.onEdit(textToViewOffset(buildView(inserted.draft, labels), inserted.caret));
  };

  // 复制 / 剪切选中的芯片：剪贴板里放占位符文字（view 里的零宽字符不外泄）。
  const onCopyCut = (event: ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    const field = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = field;
    if (start === end) return;
    const selected = view.text.slice(start, end);
    if (!view.spans.some((span) => span.viewStart >= start && span.viewEnd <= end)) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", viewToText(selected, getDraft(draftKey)));
    if (cut) replaceView(view.text.slice(0, start) + view.text.slice(end), viewToTextOffset(view, start));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: shownHeight };
  };
  // 向上拖 = 变高。
  const dragged = (event: PointerEvent<HTMLDivElement>) =>
    clampFieldHeight(
      drag.current ? drag.current.startHeight + drag.current.startY - event.clientY : shownHeight,
      bounds.min,
      bounds.max,
    );

  return (
    <div className="composer-body composer-input" data-testid="composer-body">
      <div
        className="composer-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("composer.resize")}
        aria-valuemin={bounds.min}
        aria-valuemax={Number.isFinite(bounds.max) ? bounds.max : undefined}
        aria-valuenow={shownHeight}
        title={t("composer.resize")}
        tabIndex={0}
        data-testid="composer-resize"
        onPointerDown={onPointerDown}
        onPointerMove={(event) => {
          if (drag.current) previewFieldHeight(dragged(event));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          commitFieldHeight(dragged(event));
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => commitFieldHeight(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          commitFieldHeight(
            clampFieldHeight(
              shownHeight + (event.key === "ArrowUp" ? FIELD_KEY_STEP : -FIELD_KEY_STEP),
              bounds.min,
              bounds.max,
            ),
          );
        }}
      />
      <Attachments
        images={draft.images}
        files={draft.files}
        onRemove={(kind, n) => setDraft(draftKey, removeAttachment(getDraft(draftKey), kind, n))}
      />
      <div className="composer-field-wrap">
        <div ref={backdropRef} className="composer-backdrop" aria-hidden="true">
          {renderBackdrop(view)}
        </div>
        <textarea
          ref={fieldRef}
          className="composer-field"
          data-composer-input
          data-testid="composer-input"
          data-sized={sizedHeight !== null || undefined}
          style={sizedHeight === null ? undefined : { height: sizedHeight }}
          rows={1}
          spellCheck={false}
          value={view.text}
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          disabled={props.disabled}
          aria-controls={props.controls}
          aria-activedescendant={props.activeDescendant}
          onChange={(event) => {
            setDraftText(draftKey, viewToText(event.target.value, getDraft(draftKey)));
            props.onEdit(event.target.selectionStart);
          }}
          onSelect={(event) => {
            const field = event.currentTarget;
            const [start, end] = snapSelection(view, field.selectionStart, field.selectionEnd);
            if (start !== field.selectionStart || end !== field.selectionEnd) {
              field.setSelectionRange(start, end, field.selectionDirection ?? undefined);
              return;
            }
            props.onCaret(start);
          }}
          onScroll={(event) => {
            if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => {
            if (rawPaste.current && event.key.toLowerCase() === "v") rawPaste.current = false;
          }}
          onPaste={onPaste}
          onCopy={(event) => onCopyCut(event, false)}
          onCut={(event) => onCopyCut(event, true)}
        />
      </div>
    </div>
  );
}
