// 输入框工具行里的"会话开关"菜单（spec 4.14）：工具行里当前文件夹右边一颗滑杆图标按钮，弹出本会话的开关：技能清单、扩展上下文、
// 电脑操作（开启要确认）、顾问模型、浏览器窗口（可见 / 后台）。快速 / 慢速和 Prewalk 在模型选择器里。
// 状态来自 TaskState.sessionToggles（主进程读 omp 的状态 toast，用户自己在输入框敲的命令也同步）；
// 本会话没动过的开关显示配置默认值；和默认值不同的行有小圆点。只对本会话生效的开关改过后标"本会话"；
// 扩展上下文和浏览器窗口 omp 直接写进配置（SAVED_TO_CONFIG），改完重读配置，不标"本会话"。
import { useEffect, useRef, useState } from "react";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import type { TaskCommand } from "../../../../shared/omp-output/index.ts";
import {
  SAVED_TO_CONFIG,
  toggleView,
  type BrowserMode,
  type ToggleName,
} from "../../../../shared/omp-output/toggles.ts";
import { useT } from "../../i18n/use-t.ts";
import { Sliders } from "../../icons.tsx";
import { reportOmpError } from "../../ui/errors.ts";
import { Button, Segmented } from "../../ui/controls.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { ToggleRow } from "./ToggleRow.tsx";
import { ModeSection } from "./ModeSection.tsx";
import { runToggleCommand } from "./toggle-actions.ts";
import { onTogglesMenuRequest } from "./toggle-bus.ts";
import { useToggleDefaults } from "./use-toggle-defaults.ts";
import "./toggles.css";

type SessionToggleName = Exclude<ToggleName, "fast" | "slow">;
const sessionRows: readonly SessionToggleName[] = ["skillful", "extendedContext", "computer", "advisor"];

export function SessionTogglesMenu({ taskId, task }: { taskId: TaskId; task: TaskState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const defaults = useToggleDefaults();
  const menuRef = useRef<HTMLDivElement>(null);
  const toggles = task.sessionToggles;

  // 斜杠命令（/skillful、/computer on）打开菜单。
  useEffect(
    () =>
      onTogglesMenuRequest((request) => {
        if (request.taskId !== taskId) return;
        setOpen(true);
        setConfirming(request.confirmComputer);
      }),
    [taskId],
  );

  // 打开后焦点落进菜单，Esc / ↑↓ 才有起点。
  useEffect(() => {
    if (!open || confirming) return;
    menuRef.current?.querySelector<HTMLElement>('[role="switch"]:not(:disabled)')?.focus();
  }, [open, confirming]);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  // 同一时间只有一条命令在飞：omp 一条一条执行，连点会把状态 toast 搅在一起。
  const run = (key: string, job: () => Promise<void>) => {
    if (busy !== null) return;
    setBusy(key);
    job()
      .catch((error: unknown) => reportOmpError(t, error))
      .finally(() => setBusy(null));
  };
  const runCommand = (key: string, command: TaskCommand) => run(key, () => runToggleCommand(taskId, command));

  const onToggle = (name: SessionToggleName, next: boolean) => {
    if (name === "computer" && next) {
      setConfirming(true);
      return;
    }
    runCommand(name, { kind: "toggle", name, on: next });
  };

  const browser = toggleView<BrowserMode>(toggles.browser, defaults.browser);
  const label = t("toggles.button");
  // 有任何一项和默认值不同：按钮上也亮一个点。
  const anyDiffers = sessionRows.some((name) => toggleView(toggles[name], defaults[name]).differs) || browser.differs;

  return (
    <div className="ui-popover-anchor">
      <button
        type="button"
        className="ui-chip tg-button"
        data-testid="toggles-button"
        data-differs={anyDiffers || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Sliders size={16} />
      </button>
      <Popover
        open={open}
        onClose={close}
        label={t("toggles.title")}
        kind={confirming ? "confirm" : undefined}
        width={confirming ? undefined : 380}
      >
        {confirming ? (
          <div data-testid="toggles-computer-confirm">
            <p className="ui-pop-title">{t("toggles.computerConfirmTitle")}</p>
            <p className="ui-pop-body">{t("toggles.computerConfirmBody")}</p>
            <div className="ui-pop-actions">
              <Button size="sm" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                testId="toggles-computer-confirm-yes"
                onClick={() => {
                  setConfirming(false);
                  runCommand("computer", { kind: "toggle", name: "computer", on: true });
                }}
              >
                {t("toggles.computerConfirmYes")}
              </Button>
            </div>
          </div>
        ) : (
          <div ref={menuRef} className="tg-menu" role="group" aria-label={t("toggles.title")} aria-busy={busy !== null}>
            {sessionRows.map((name) => {
              const view = toggleView(toggles[name], defaults[name]);
              return (
                <ToggleRow
                  key={name}
                  id={name}
                  label={t(`toggles.${name}`)}
                  tip={name === "extendedContext" ? t("toggles.extendedContext.hint") : undefined}
                  checked={view.value ?? false}
                  session={view.session && !SAVED_TO_CONFIG.has(name)}
                  differs={view.differs}
                  busy={busy !== null}
                  onChange={(next) => onToggle(name, next)}
                />
              );
            })}
            <div className="tg-row" data-testid="toggle-browser">
              <div className="tg-text">
                <span id="tg-browser-label" className="tg-label">
                  {t("toggles.browser")}
                  {browser.differs && (
                    <span
                      className="tg-dot"
                      data-testid="toggle-browser-dot"
                      role="img"
                      aria-label={t("toggles.differs")}
                      title={t("toggles.differs")}
                    />
                  )}
                </span>
              </div>
              <Segmented<BrowserMode>
                size="sm"
                value={browser.value ?? "visible"}
                labelledBy="tg-browser-label"
                testId="toggle-browser-mode"
                options={[
                  { value: "visible", label: t("toggles.browser.visible") },
                  { value: "headless", label: t("toggles.browser.headless") },
                ]}
                onChange={(mode) => {
                  if (mode !== (browser.value ?? "visible") && busy === null)
                    runCommand("browser", { kind: "browserMode", mode });
                }}
              />
            </div>
            {task.composerMode === null && <ModeSection taskId={taskId} task={task} />}
          </div>
        )}
      </Popover>
    </div>
  );
}
