// 上下文提示（spec 4.14）：percent ≥ 70 才出现，≥ 90 变琥珀；永不显示 token 数。点击弹出"压缩上下文"。
import { useState } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { compactContext } from "./actions.ts";
import { Popover } from "./Popover.tsx";

export function ContextHint({ task }: { task: TaskState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const percent = task.contextUsage?.percent;
  if (percent === undefined || percent < 70) return null;
  const shown = Math.min(100, Math.round(percent));
  return (
    <div className="pop-anchor">
      <button type="button" className="context-hint" data-high={percent >= 90 || undefined} title={t("composer.context.tip")} aria-haspopup="dialog" aria-expanded={open} data-testid="context-hint" onClick={() => setOpen((value) => !value)}>
        {t("composer.context", { p: shown })}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={240} align="end" label={t("composer.context", { p: shown })}>
        <div className="pop-section">
          <button
            type="button"
            className="gate-btn"
            data-primary
            disabled={task.status === "running" || task.status === "needs_you"}
            onClick={() => {
              setOpen(false);
              void compactContext(task.id, t);
            }}
          >
            {t("composer.compact")}
          </button>
        </div>
      </Popover>
    </div>
  );
}
