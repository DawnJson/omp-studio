// "等你确认"系统通知（决策 8）：任务进入 needs_you、窗口没有焦点、开关打开时发一条。
// 同一次等待只通知一次：状态没离开 needs_you 时（第二个对话框到达）不重复；回到别的状态后再次进入才算新的一次。
// 不 import electron：Notification 和窗口由 runtime.ts 注入，单元测试直接实例化。
import type { DialogRequest, Locale, TaskId, TaskState } from "../../shared/ipc.ts";
import { t } from "../../shared/i18n/index.ts";

export interface GateNotifierDeps {
  enabled(): Promise<boolean>;
  locale(): Locale;
  windowFocused(): boolean;
  projectName(task: TaskState): string;
  /** 发系统通知；点击时调用 onClick（由调用方聚焦窗口并发 focusTask）。 */
  show(notification: { title: string; body: string }, onClick: () => void): void;
  onClick(taskId: TaskId): void;
}

/** 通知正文里的"要确认什么"：审批/select/confirm/input/editor 取标题第一行，ask 取第一题。 */
export function dialogSummary(dialog: DialogRequest): string {
  const text = dialog.kind === "ask" ? (dialog.questions[0]?.question ?? "") : dialog.title;
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

/** Electron 的 Notification 对象没人引用就可能被回收，之后 click 不再触发：持有到点击或关闭。 */
export function retainNotification<T extends { on(event: "click" | "close", listener: () => void): unknown }>(
  held: Set<T>,
  notification: T,
): void {
  held.add(notification);
  const release = () => held.delete(notification);
  notification.on("click", release);
  notification.on("close", release);
}

export class GateNotifier {
  readonly #deps: GateNotifierDeps;
  readonly #waiting = new Set<TaskId>();

  constructor(deps: GateNotifierDeps) {
    this.#deps = deps;
  }

  async onState(state: TaskState): Promise<void> {
    if (state.status !== "needs_you") {
      this.#waiting.delete(state.id);
      return;
    }
    if (this.#waiting.has(state.id)) return;
    this.#waiting.add(state.id);
    const dialog = state.dialogs[0];
    if (!dialog || this.#deps.windowFocused() || !(await this.#deps.enabled())) return;
    const locale = this.#deps.locale();
    this.#deps.show(
      {
        title: t(locale, "notify.title", {
          project: this.#deps.projectName(state),
          task: state.title || t(locale, "task.untitled"),
        }),
        body: t(locale, "notify.body.gate", { title: dialogSummary(dialog) }),
      },
      () => this.#deps.onClick(state.id),
    );
  }
}
