// `@` 文件菜单：光标前的 `@词`、候选、高亮行、Esc 关闭、↑↓/Tab/Enter 键处理、插入后的光标落点。
// Composer 和 DraftComposer 共用；调用方只需要在 onKeyDown 最前面问一句 `menu.onKeyDown(event)`。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { ProjectFilesTarget } from "../../../../shared/ipc.ts";
import { applyFileCompletion, atReference, type AtReference } from "./file-complete.ts";

const debounceMs = 80;

/**
 * 取 `@` 补全的候选；查询词变了就重新取，过期的结果丢弃，失败当作没有候选。
 * 只返回和当前查询词对应的结果：新结果到达前菜单是关的，免得 Enter/Tab 插进一个和刚敲的字不符的文件。
 */
function useProjectFiles(target: ProjectFilesTarget, reference: AtReference | null): readonly string[] {
  const [result, setResult] = useState<{ key: string; files: readonly string[] }>({ key: "", files: [] });
  const query = reference?.query ?? null;
  const targetKey =
    target.kind === "task"
      ? `task:${target.taskId}`
      : target.kind === "project"
        ? `project:${target.projectId}`
        : "defaultFolder";
  const key = query === null ? "" : `${targetKey}\0${query}`;

  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      window.studio.listProjectFiles(target, query).then(
        (files) => {
          if (!cancelled) setResult({ key, files });
        },
        () => {
          if (!cancelled) setResult({ key, files: [] });
        },
      );
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // target 由 targetKey 完整表示。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return query !== null && result.key === key ? result.files : [];
}

export interface FileMenu {
  open: boolean;
  files: readonly string[];
  active: number;
  setActive(index: number): void;
  /** 点选某一行：把文件插进文本并聚焦输入框。 */
  pick(file: string): void;
  /**
   * 菜单开着时处理 ↑↓（移动）、Esc（关到这个 `@词` 变化为止）、Tab / Enter（补全）；返回 true 表示按键已消耗。
   * 输入法组合态不处理。已经敲完整个文件名时 Enter 不再补全（放行给发送），Tab 仍补全。
   */
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean;
  /** 记下光标位置（onChange / onSelect 时调）。 */
  trackCaret(position: number): void;
  /** 文本被程序换掉后（翻历史等），下一次提交时把光标放到 position。 */
  placeCaret(position: number): void;
}

/**
 * field 是输入框；setText 写回草稿。enabled 为 false 时（比如刚用 ↑ 翻出一条历史）菜单不开，免得抢走后面的 ↑↓。
 */
export function useFileMenu(
  target: ProjectFilesTarget,
  text: string,
  enabled: boolean,
  field: RefObject<HTMLTextAreaElement | null>,
  setText: (text: string) => void,
): FileMenu {
  const [caret, setCaret] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  const reference: AtReference | null = enabled ? atReference(text, Math.min(caret, text.length)) : null;
  const refKey = reference === null ? null : `${reference.start}:${reference.query}`;
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const files = useProjectFiles(target, closedFor === refKey ? null : reference);
  const open = reference !== null && closedFor !== refKey && files.length > 0;
  const active = Math.min(index, Math.max(files.length - 1, 0));

  useEffect(() => setIndex(0), [refKey]);

  // 补全 / 翻历史后把光标放到约定位置（文本换掉后浏览器会把光标甩到末尾或开头）。
  useLayoutEffect(() => {
    const input = field.current;
    if (!input || pendingCaret.current === null) return;
    input.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text, field]);

  const placeCaret = (position: number) => {
    pendingCaret.current = position;
    setCaret(position);
  };

  const complete = (file: string | undefined, at: number): boolean => {
    const chosen = file ?? files[active];
    if (!open || reference === null || chosen === undefined) return false;
    const done = applyFileCompletion(text, Math.min(at, text.length), reference, chosen);
    placeCaret(done.caret);
    setText(done.text);
    field.current?.focus();
    return true;
  };

  return {
    open,
    files,
    active,
    setActive: setIndex,
    pick: (file) => void complete(file, caret),
    trackCaret: setCaret,
    placeCaret,
    onKeyDown: (event) => {
      if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((active + (event.key === "ArrowDown" ? 1 : -1) + files.length) % Math.max(files.length, 1));
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setClosedFor(refKey);
        return true;
      }
      const plainEnter = event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (plainEnter && reference !== null && reference.query === files[active]) return false;
      if ((event.key === "Tab" || plainEnter) && complete(undefined, event.currentTarget.selectionStart)) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  };
}
