// 模型 + 思考强度的胶囊（spec 4.14）：左边是模型名（点开模型选择对话框 ModelPicker；Alt M / 命令面板也能打开），右边是
// 档位刻度（点它或 Alt T 轮换思考强度）。刻度的格数是这个模型的档位数，亮几格是第几档，颜色和运行中的动效按档位
// 加强（composer.css 的 .chip-effort[data-level]）；快速模式在模型名后面加一个闪电。
// 思考强度是乐观更新：点下去（或 Alt T）立刻显示新值，omp 的往返（任务里要等会话空闲）在后台完成；
// 失败时退回原值并报错。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Bolt } from "../../icons.tsx";
import { onStudioCommand } from "../palette/index.ts";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker.tsx";
import { nextThinkingLevel, thinkingLabel } from "./thinking-levels.ts";
import { speedBadges } from "./speed-limit-format.ts";

/** 写入成功后，新值迟迟没回到 props（omp 改成了别的值、或者事件丢了）时，多久后放弃乐观值。 */
const optimisticTimeoutMs = 2000;

/** 模型胶囊的数据和动作：任务里是 setTask*，草稿（还没有任务）里改的是即将建的这个任务的选择（draft-model-choice.ts）。 */
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
  // 刻度只数 effort（不算"关"）：关 = 全灭，最高档 = 全亮。
  const efforts: readonly ThinkingLevel[] = levels.filter((level) => level !== "off");
  const lit = thinkingLevel === null ? 0 : efforts.indexOf(thinkingLevel) + 1;
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

  const showEffort = supportsThinking && efforts.length > 0 && levelText !== null;
  const effortText = t("composer.effort", { level: levelText ?? "", n: lit, total: efforts.length });
  const fastText = badges.includes("fast") ? t("composer.badge.fast") : null;
  // 快速模式的闪电：有刻度时做成刻度左上角的角标（填在矮竖条上方的空角里），没有刻度时跟在模型名后面。
  const fastBolt = fastText !== null && (
    <span className="chip-fast" data-testid="speed-badge-fast">
      <Bolt />
    </span>
  );
  // 两颗按钮按下时不抢焦点：鼠标点开对话框，关掉后焦点回到原来的输入框，胶囊上不留焦点框。键盘 Tab 过来的照常有焦点框。
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  return (
    <>
      <div className="chip-model" data-testid="model-chip-group">
        <button
          type="button"
          className="ui-chip chip-name"
          data-testid="model-chip"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("composer.modelChip")}
          title={fastText === null ? name : `${name} · ${fastText}`}
          onMouseDown={keepFocus}
          onClick={() => setOpen(true)}
        >
          <span className="chip-text">{name}</span>
          {!showEffort && fastBolt}
          {badges.includes("slow") && (
            <span className="chip-badge" data-testid="speed-badge-slow">
              {t("composer.badge.slow")}
            </span>
          )}
        </button>
        {showEffort && (
          <button
            type="button"
            className="ui-chip chip-effort"
            data-testid="chip-thinking"
            data-level={thinkingLevel}
            data-running={task.running || undefined}
            aria-label={fastText === null ? effortText : `${effortText} · ${fastText}`}
            title={`${fastText === null ? effortText : `${effortText} · ${fastText}`} (Alt T)`}
            onMouseDown={keepFocus}
            onClick={cycleThinking}
          >
            {fastBolt}
            <EffortBars total={efforts.length} lit={lit} />
          </button>
        )}
      </div>
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

/** 档位刻度：每档一根 2px 宽的竖条、间隔 2px，从低到高 4 → 12px（取整，落在整像素上不发虚）；前 `lit` 根亮着。
 *  `--i` 给逐根点亮和波动错开用，`--t`（0-1）给 xhigh / max 的渐变取色。 */
function EffortBars({ total, lit }: { total: number; lit: number }) {
  const step = 4;
  const width = total * step - 2;
  return (
    <svg viewBox={`0 0 ${width} 12`} width={width} height={12} aria-hidden="true" focusable="false">
      {Array.from({ length: total }, (_, i) => {
        const height = total === 1 ? 12 : Math.round(4 + (8 * i) / (total - 1));
        const style = { "--i": i, "--t": total === 1 ? 1 : i / (total - 1) } as CSSProperties;
        return (
          <rect
            key={i}
            x={i * step}
            y={12 - height}
            width={2}
            height={height}
            rx={1}
            data-lit={i < lit || undefined}
            style={style}
          />
        );
      })}
    </svg>
  );
}
