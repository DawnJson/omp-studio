// 选中即复制（设置项 copyOnSelect，默认开）：鼠标松开时，页面上有选中的文字就写进剪贴板，并短暂提示“已复制”。
// 只认鼠标选中（拖选、双击选词、三击选段），和终端一样；键盘选中（Shift+方向键、Ctrl+A）不自动复制，照常 Ctrl+C。
// 输入框、可编辑区和内置终端除外：在输入框里选中多半是要改写或粘贴覆盖，不能顺手把剪贴板换掉；终端有自己的复制。
import { useEffect } from "react";
import type { TFunction } from "../../../shared/i18n/index.ts";
import { pushToast } from "../features/dialogs/toast-store.ts";
import { reportError } from "../ui/errors.ts";

const excluded = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-terminal-host]";

function inExcluded(node: Node | null | undefined): boolean {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(excluded) != null;
}

export function useCopyOnSelect(enabled: boolean, t: TFunction): void {
  useEffect(() => {
    if (!enabled) return;
    // 同一段选区只复制一次：在选区里再点一下不重复提示；选区收起后清掉，重新选同样的文字照样复制。
    let last = "";
    let timer: number | undefined;
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0 || inExcluded(event.target instanceof Node ? event.target : null)) return;
      // 等这次点击把选区定下来再读（点在选区里时，选区要到 mouseup 之后才收起）。
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const selection = window.getSelection();
        if (selection === null || selection.isCollapsed) {
          last = "";
          return;
        }
        if (inExcluded(selection.anchorNode) || inExcluded(document.activeElement)) return;
        const text = selection.toString();
        if (text.trim() === "" || text === last) return;
        last = text;
        navigator.clipboard.writeText(text).then(
          () => pushToast({ message: t("common.copied"), durationMs: 1200 }),
          (cause: unknown) => reportError(t, cause),
        );
      }, 0);
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [enabled, t]);
}
