// 模型 + 思考强度合并成一颗胶囊（spec 4.14）。点开是模型选择对话框（ModelPicker）；Alt M / 命令面板也能打开，Alt T 直接轮换思考强度。
// 思考强度是乐观更新：点下去（或 Alt T）立刻显示新值，omp 的往返（任务里要等会话空闲、草稿里要跑 `omp config`）在后台完成；
// 失败时退回原值并报错。芯片上的强度文字按档位带不同的效果（composer.css 的 [data-level]）。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { onStudioCommand } from "../palette/index.ts";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker.tsx";
import { nextThinkingLevel, thinkingLabel } from "./thinking-levels.ts";
import { speedBadges } from "./speed-limit-format.ts";

/** 写入成功后，新值迟迟没回到 props（omp 改成了别的值、或者事件丢了）时，多久后放弃乐观值。 */
const optimisticTimeoutMs = 2000;

/** 模型胶囊的数据和动作：任务里是 setTask*，草稿（还没有任务）里改的是"新任务默认值"。 */
export interface ModelChipProps extends Omit<ModelPickerProps, "onClose"> {
  /** 没有具体模型时显示什么（缺省"未连接模型"）。 */
  emptyLabel?: string;
}

export function ModelChip(task: ModelChipProps) {
  const t = useT();
  const report = (error: unknown) => reportError(t, error);
  const { emptyLabel, ...pickerProps } = task;
  const [open, setOpen] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<ThinkingLevel | null>(null);
  const inflight = useRef(0);
  const giveUp = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const thinkingLevel = pendingLevel ?? task.thinkingLevel;
  // 调用方已按模型和 omp 的实际能力算好（thinkingLevelOptions）；picker、芯片、Alt T 共用这一份。
  const levels = task.thinkingLevels;
  const supportsThinking = task.model?.reasoning === true && levels.length > 0;
  const levelText =
    thinkingLevel && thinkingLabel[thinkingLevel] ? t(thinkingLabel[thinkingLevel] as MessageKey) : null;
  const name = task.model?.name ?? emptyLabel ?? t("composer.noModel");
  const badges = task.speed ? speedBadges(task.speed.fast, task.speed.slow) : [];

  // 真实值追上乐观值，或者没有在途的写入时外面改了值：以真实值为准。
  useEffect(() => {
    if (pendingLevel !== null && (task.thinkingLevel === pendingLevel || inflight.current === 0)) setPendingLevel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.thinkingLevel]);
  useEffect(() => () => clearTimeout(giveUp.current), []);

  const setThinking = (level: ThinkingLevel): Promise<void> => {
    setPendingLevel(level);
    inflight.current += 1;
    clearTimeout(giveUp.current);
    return task.setThinking(level).then(
      () => {
        inflight.current -= 1;
        if (inflight.current === 0) giveUp.current = setTimeout(() => setPendingLevel(null), optimisticTimeoutMs);
      },
      (error: unknown) => {
        inflight.current -= 1;
        if (inflight.current === 0) setPendingLevel(null);
        throw error;
      },
    );
  };

  function cycleThinking(): void {
    if (!supportsThinking) return;
    const next = nextThinkingLevel(levels, thinkingLevel);
    if (next) setThinking(next).catch(report);
  }

  // 命令面板 / Alt M / Alt T。
  useEffect(() =>
    onStudioCommand((command) => {
      if (command === "model") setOpen(true);
      if (command === "thinking") cycleThinking();
    }),
  );
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        cycleThinking();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const showLevel = (supportsThinking || !task.model) && levelText !== null;
  return (
    <>
      <button
        type="button"
        className="chip"
        data-testid="model-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("composer.modelChip")}
        onClick={() => setOpen(true)}
      >
        <span className="chip-text">{name}</span>
        {showLevel && (
          <span className="chip-level" data-level={thinkingLevel} data-testid="chip-thinking">
            {levelText}
          </span>
        )}
        {badges.map((badge) => (
          <span key={badge} className="chip-badge" data-testid={`speed-badge-${badge}`}>
            {t(badge === "fast" ? "composer.badge.fast" : "composer.badge.slow")}
          </span>
        ))}
      </button>
      <ModelPicker
        {...pickerProps}
        open={open}
        thinkingLevel={thinkingLevel}
        setThinking={setThinking}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
