// 输入框文字以 `!` / `!!`（Shell）或 `$` / `$$`（Python）开头时，工具行里出现的标签（omp 的输入框边框在这时变色，TSP 里没有这个提示）：
// 这段文字发出去 omp 不交给模型，直接在会话里运行（docs/architecture/composer-attachments.md §5）。点开有"结果进入 context"开关：
// 开 = 单前缀（`!` / `$`，输出也发给模型），关 = 双前缀（`!!` / `$$`，输出只显示）；切换改的是输入框文字的前缀，别的原样。
// 前缀判断和改写在 shared/ui/shell-prefix.ts（照 omp 18.12.6 的 input-controller）；文字归 composer 的 draft-store。
import { useEffect, useId, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { detectShellPrefix, setShellExcluded } from "../../../../shared/ui/shell-prefix.ts";
import { useT } from "../../i18n/use-t.ts";
import { Terminal } from "../../icons.tsx";
import { Switch } from "../../ui/controls.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { getDraft, setDraftText, useDraft } from "./draft-store.ts";

export function ShellTag({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const prefix = detectShellPrefix(useDraft(taskId).text);
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const active = prefix !== null;
  // 前缀没了（发送、清空、改成普通消息）标签消失，浮层跟着收起。
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  if (prefix === null) return null;
  const name = t(prefix.kind === "shell" ? "board.shellTagShell" : "board.shellTagPython");
  const tip = t(prefix.kind === "shell" ? "board.shellTagTipShell" : "board.shellTagTipPython");
  return (
    <div className="ui-popover-anchor">
      <button
        type="button"
        className="ui-chip shell-tag"
        data-testid="shell-tag"
        data-kind={prefix.kind}
        data-excluded={prefix.excluded || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={tip}
        onClick={() => setOpen((value) => !value)}
      >
        <Terminal size={14} />
        {name}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label={t("board.shellOptions")} width={320}>
        <div className="shell-pop" data-testid="shell-pop">
          <div className="shell-pop-row">
            <div className="shell-pop-text" title={t("board.shellInContextTip")}>
              <span id={labelId} className="shell-pop-label">
                {t("board.shellInContext")}
              </span>
              <span className="shell-pop-hint">{t("board.shellInContextHint")}</span>
            </div>
            <Switch
              checked={!prefix.excluded}
              labelledBy={labelId}
              testId="shell-in-context"
              onChange={(next) => setDraftText(taskId, setShellExcluded(getDraft(taskId).text, !next))}
            />
          </div>
        </div>
      </Popover>
    </div>
  );
}
