// 提示词优化（发送键左边的 ✦，docs/architecture/prompt-enhance.md）：把草稿交给主进程改写，回来后一次替换进输入框。
// - 替换走 select() + execCommand("insertText")：是输入框自己的编辑，原生 Ctrl+Z 一步回到原文（同粘贴文件路径的做法）；
//   插入的是 view 文本（占位符已换成芯片），React 回填的值和文本框里的一样，不会重设 value 把撤销栈清掉。
// - 过期就丢：结果回来时草稿已经不是发起时那段（改过、发出去了、换了任务）就不替换；草稿一变也立刻取消这次调用（结果反正不会用）。
// - 一个输入框同时只有一次；再点一次 / Esc（排在关菜单和弹层之后、停止任务之前，spec §5.2）= 取消。失败只提示，不碰草稿。
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ModelKey, TaskId } from "../../../../shared/ipc.ts";
import { canEnhance, type PromptEnhanceResult, type PromptEnhanceTarget } from "../../../../shared/prompt-enhance.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { emitStudioCommand } from "../palette/studio-command.ts";
import { buildView, type ChipLabels } from "./composer-tokens.ts";
import { getDraft, setDraftText } from "./draft-store.ts";
import { useChipLabels } from "./use-draft-view.ts";

interface Run {
  key: TaskId;
  target: PromptEnhanceTarget;
  /** 发起时的草稿文字：结果回来时草稿还是它才替换。 */
  snapshot: string;
}

export interface PromptEnhance {
  busy: boolean;
  /** 草稿能不能优化（canEnhance）；优化进行中按钮总是可点（点了是取消）。 */
  ready: boolean;
  toggle(): void;
}

/** 把结果替换进输入框：一次 insertText，Ctrl+Z 回到原文。 */
function replaceDraft(key: TaskId, text: string, field: HTMLTextAreaElement | null, labels: ChipLabels): void {
  const view = buildView({ ...getDraft(key), text }, labels).text;
  if (field !== null && !field.disabled) {
    field.focus();
    field.select();
    if (document.execCommand("insertText", false, view)) return;
  }
  setDraftText(key, text);
}

export function usePromptEnhance(
  key: TaskId,
  target: PromptEnhanceTarget,
  text: string,
  fallback: ModelKey | null,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
): PromptEnhance {
  const t = useT();
  const labels = useChipLabels();
  const current = useRef<Run | null>(null);
  const [busyKey, setBusyKey] = useState<TaskId | null>(null);

  const cancel = useCallback(() => {
    const run = current.current;
    if (run === null) return;
    current.current = null;
    setBusyKey(null);
    window.studio.cancelEnhancePrompt(run.target).catch(() => undefined);
  }, []);

  const finish = (run: Run, result: PromptEnhanceResult) => {
    switch (result.kind) {
      case "enhanced":
        if (getDraft(run.key).text === run.snapshot) replaceDraft(run.key, result.text, fieldRef.current, labels);
        return;
      case "no_model":
        pushToast({
          level: "error",
          message: t("composer.enhance.noModel"),
          action: {
            label: t("composer.enhance.setRoles"),
            run: () => emitStudioCommand("model", { query: "", scope: "roles" }),
          },
        });
        return;
      case "markers_lost":
        pushToast({ level: "error", message: t("composer.enhance.markersLost") });
        return;
      case "failed":
        pushToast({ level: "error", message: t("composer.enhance.failed"), title: result.message });
        return;
      case "cancelled":
        return;
    }
  };

  const start = async () => {
    const snapshot = getDraft(key).text;
    if (!canEnhance(snapshot)) return;
    const run: Run = { key, target, snapshot };
    current.current = run;
    setBusyKey(key);
    let result: PromptEnhanceResult;
    try {
      // TSP 任务的模型有时只有显示名、没有 provider（omp 只报了名字）：这种拼不出 `provider/model`，不当后备。
      const usable = fallback !== null && fallback.provider !== "" && fallback.modelId !== "" ? fallback : null;
      result = await window.studio.enhancePrompt(target, snapshot, usable);
    } catch (error) {
      if (current.current === run) {
        current.current = null;
        setBusyKey(null);
        reportError(t, error, t("composer.enhance.failed"));
      }
      return;
    }
    // 已经取消（再点、Esc、草稿变了、换了输入框）：结果不用。
    if (current.current !== run) return;
    current.current = null;
    setBusyKey(null);
    finish(run, result);
  };

  // 换了输入框（切任务 / 切项目）或卸载：取消。
  useEffect(() => cancel, [key, cancel]);

  // 草稿变了（编辑、发送后清空、撤回）：结果已经过期，取消调用。
  useEffect(() => {
    if (current.current !== null && current.current.snapshot !== text) cancel();
  }, [text, cancel]);

  // Esc：在 document 上听（冒泡阶段）——菜单、弹层已经在前面处理并 preventDefault 了；输入框的"停止任务"在 window 上，排在这之后。
  const busy = busyKey === key;
  useEffect(() => {
    if (!busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // 过程区里的 Esc 是写给 omp 的按键。
      if (event.target instanceof Element && event.target.closest('[data-testid="tsp-view"]') !== null) return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, cancel]);

  return {
    busy,
    ready: canEnhance(text),
    toggle: () => {
      if (busy) cancel();
      else void start();
    },
  };
}
