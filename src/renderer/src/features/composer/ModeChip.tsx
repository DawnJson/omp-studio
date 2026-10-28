// 工具行里的模式胶囊（spec §4.14）：omp 的状态行"模式"片段（Plan / Plan (paused) / Prewalk / Vibe / Loop，Loop 带剩余次数或时长），
// 只在有模式时出现；点开浮层：当前模式的开关和动作（session-toggles/ModeSection.tsx）。没有模式时开关在"会话开关"菜单里。
// 目标模式不在这里（GoalStrip）。数据是 TaskState.composerMode（主进程读 omp 的状态行，shared/tsp/composer-facts.ts）。
import { useEffect, useState } from "react";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Bolt, MapIcon, Restart, Sparkle } from "../../icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { modeChipLabel } from "../session-toggles/mode-format.ts";
import { ModeSection } from "../session-toggles/ModeSection.tsx";
import "../session-toggles/toggles.css";

const icons = { plan: MapIcon, prewalk: Bolt, vibe: Sparkle, loop: Restart } as const;

export function ModeChip({ taskId, task }: { taskId: TaskId; task: TaskState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const mode = task.composerMode;
  // 模式没了（Loop 停止、Plan 关闭）：浮层跟着关掉，下次出现时从关着开始。
  useEffect(() => {
    if (mode === null) setOpen(false);
  }, [mode]);
  if (mode === null) return null;
  const Icon = icons[mode.kind];
  const paused = mode.kind === "plan" ? mode.paused : mode.kind === "loop" && mode.state === "paused";
  const label = modeChipLabel(t, mode);
  return (
    <div className="ui-popover-anchor">
      <button
        type="button"
        className="ui-chip mode-chip"
        data-testid="mode-chip"
        data-mode={mode.kind}
        data-paused={paused || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("modes.chip")}: ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={14} />
        <span data-testid="mode-chip-label">{label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label={t("modes.title")} width={340}>
        <ModeSection taskId={taskId} task={task} />
      </Popover>
    </div>
  );
}
