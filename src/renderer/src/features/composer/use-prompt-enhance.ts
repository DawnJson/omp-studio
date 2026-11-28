// 提示词优化（发送键左边的 ✦，docs/architecture/prompt-enhance.md）：把草稿交给主进程流式改写，回来后一次替换进输入框。
// - 流式期间只展示临时流式层，不改文本框的 value，所以原生撤销栈不受破坏；完成时先清流式层，再用 select() + execCommand("insertText")
//   一次性写进 view 文本，原生 Ctrl+Z 一步回到原文、附件芯片还在。
// - 过期就丢：结果回来时草稿已经不是发起时那段（改过、发出去了、换了任务）就不替换；草稿一变也立刻取消调用（结果反正不会用）。
// - 一个输入框同时只有一次；再点一次 / Esc（排在关菜单和弹层之后、停止任务之前，spec §5.2）= 取消；Alt+E 和命令面板都能触发。失败只提示，不碰草稿。
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ModelKey, TaskId } from "../../../../shared/ipc.ts";
import {
  canEnhance,
  DEFAULT_PROMPT_ENHANCE_SETTINGS,
  sameEnhanceTarget,
  type PromptEnhanceResult,
  type PromptEnhanceSettings,
  type PromptEnhanceTarget,
} from "../../../../shared/prompt-enhance.ts";
import { isLetterKey } from "../../app/platform-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { useSettings } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { emitStudioCommand, onStudioCommand } from "../palette/studio-command.ts";
import { buildView, type ChipLabels } from "./composer-tokens.ts";
import { getDraft, setDraftText } from "./draft-store.ts";
import { useChipLabels } from "./use-draft-view.ts";

interface Run {
  key: TaskId;
  target: PromptEnhanceTarget;
  requestId: string;
  /** 发起时的草稿文字：结果回来时草稿还是它才替换。 */
  snapshot: string;
}

export interface PromptEnhance {
  busy: boolean;
  /** 草稿能不能优化（canEnhance）；优化进行中按钮总是可点（点了是取消）。 */
  ready: boolean;
  /** 正在流式返回的预览文本；还没出字或不处于优化中为 null。 */
  streamText: string | null;
  /** 当前持久化的风格与上下文开关。 */
  settings: PromptEnhanceSettings;
  toggle(): void;
  start(override?: Partial<PromptEnhanceSettings>): void;
  cancel(): void;
  updateSettings(patch: Partial<PromptEnhanceSettings>): void;
}

let nextRequestSeq = 0;

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
  disabled = false,
): PromptEnhance {
  const t = useT();
  const labels = useChipLabels();
  const settings = useSettings()?.promptEnhance ?? DEFAULT_PROMPT_ENHANCE_SETTINGS;
  const current = useRef<Run | null>(null);
  const [busyKey, setBusyKey] = useState<TaskId | null>(null);
  const [streamState, setStreamState] = useState<{ requestId: string; text: string } | null>(null);

  const cancel = useCallback(() => {
    const run = current.current;
    if (run === null) return;
    current.current = null;
    setBusyKey(null);
    setStreamState(null);
    window.studio.cancelEnhancePrompt(run.target).catch(() => undefined);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<PromptEnhanceSettings>) => {
      window.studio.setPromptEnhanceSettings(patch).catch((error: unknown) => reportError(t, error));
    },
    [t],
  );

  const finish = useCallback(
    (run: Run, result: PromptEnhanceResult) => {
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
    },
    [fieldRef, labels, t],
  );

  const start = useCallback(
    async (override?: Partial<PromptEnhanceSettings>) => {
      if (disabled) return;
      const snapshot = getDraft(key).text;
      if (!canEnhance(snapshot)) return;
      const requestId = `pe-${++nextRequestSeq}`;
      const run: Run = { key, target, requestId, snapshot };
      current.current = run;
      setBusyKey(key);
      setStreamState(null);
      const effective: PromptEnhanceSettings = { ...settings, ...override };
      let result: PromptEnhanceResult;
      try {
        // TSP 任务的模型有时只有显示名、没有 provider（omp 只报了名字）：这种拼不出 `provider/model`，不当后备。
        const usable = fallback !== null && fallback.provider !== "" && fallback.modelId !== "" ? fallback : null;
        result = await window.studio.enhancePrompt(target, snapshot, usable, {
          requestId,
          style: effective.style,
          customInstruction: effective.customInstruction,
          includeHistory: effective.includeHistory,
          includeGit: effective.includeGit,
        });
      } catch (error) {
        if (current.current === run) {
          current.current = null;
          setBusyKey(null);
          setStreamState(null);
          reportError(t, error, t("composer.enhance.failed"));
        }
        return;
      }
      // 已经取消（再点、Esc、草稿变了、换了输入框）：结果不用。
      if (current.current !== run) return;
      current.current = null;
      setBusyKey(null);
      setStreamState(null);
      finish(run, result);
    },
    [disabled, fallback, finish, key, settings, t, target],
  );

  // 订阅流式预览：只接当前这一次 requestId 且同一输入框的事件，过期的块一律忽略。
  useEffect(
    () =>
      window.studio.onPromptEnhanceStream((event) => {
        const run = current.current;
        if (run === null || run.requestId !== event.requestId || !sameEnhanceTarget(run.target, event.target)) return;
        setStreamState({ requestId: event.requestId, text: event.text });
      }),
    [],
  );

  // 换了输入框（切任务 / 切项目）或卸载：取消。
  useEffect(() => cancel, [key, cancel]);

  // 草稿变了（编辑、发送后清空、撤回）：结果已经过期，取消调用。
  useEffect(() => {
    if (current.current !== null && current.current.snapshot !== text) cancel();
  }, [text, cancel]);

  const busy = busyKey === key;

  const toggle = useCallback(() => {
    if (busy) cancel();
    else void start();
  }, [busy, cancel, start]);

  // Esc：在 document 上听（冒泡阶段）——菜单、弹层已经在前面处理并 preventDefault 了；输入框的"停止任务"在 window 上，排在这之后。
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

  // 命令面板 / Alt E。
  useEffect(
    () =>
      onStudioCommand((command) => {
        if (command === "enhance") toggle();
      }),
    [toggle],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!isLetterKey(event, "e")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const streamText =
    busy && current.current !== null && streamState?.requestId === current.current.requestId ? streamState.text : null;

  return {
    busy,
    ready: canEnhance(text),
    streamText,
    settings,
    toggle,
    start: (override) => {
      void start(override);
    },
    cancel,
    updateSettings,
  };
}
