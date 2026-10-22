// "等你确认"系统通知（决策 8）：任务进入 needs_you、窗口没有焦点、开关打开时发一条。
// 窗口隐藏在托盘（或最小化）时，任务跑完 / 出错也发一条：用户看不到窗口，只能靠通知知道；窗口可见时不发，侧栏已经有完成点。
// 任务正常跑完一轮时，"完成提示音"开着就响一声（窗口可见也响：用户可能在看别的任务或别的程序）。
// 同一次等待只通知一次：状态没离开 needs_you 时（第二个门到达）不重复；回到别的状态后再次进入才算新的一次。
// 不 import electron：Notification 和窗口由 runtime.ts 注入，单元测试直接实例化。
import type { DialogRequest, Locale, TaskId, TaskState } from "../../shared/ipc.ts";
import { t } from "../../shared/i18n/index.ts";
import { stripIconGlyphs } from "../../shared/ui/clean-title.ts";

export interface GateNotifierDeps {
  enabled(): Promise<boolean>;
  /** 设置里的"任务完成时响提示音"。 */
  soundEnabled(): Promise<boolean>;
  /** 响一声系统提示音。 */
  playSound(): void;
  locale(): Locale;
  windowFocused(): boolean;
  /** 窗口看不见（隐藏在托盘、最小化或不存在）。 */
  windowHidden(): boolean;
  projectName(task: TaskState): string;
  /** 发系统通知；点击时调用 onClick（由调用方聚焦窗口并发 focusTask）。 */
  show(notification: { title: string; body: string }, onClick: () => void): void;
  onClick(taskId: TaskId): void;
}

/** 通知正文里的"要确认什么"：门标题（提问的问题、审批的"Allow tool: …"）的第一行。 */
export function dialogSummary(dialog: DialogRequest): string {
  return dialog.title.split(/\r?\n/)[0]?.trim() ?? "";
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
  readonly #lastStatus = new Map<TaskId, TaskState["status"]>();

  constructor(deps: GateNotifierDeps) {
    this.#deps = deps;
  }

  async onState(state: TaskState): Promise<void> {
    const previous = this.#lastStatus.get(state.id);
    this.#lastStatus.set(state.id, state.status);
    if (state.status !== "needs_you") {
      this.#waiting.delete(state.id);
      if (previous === "running" || previous === "needs_you") await this.#notifyEnded(state);
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
          task: stripIconGlyphs(state.title) || t(locale, "task.untitled"),
        }),
        body: t(locale, "notify.body.gate", { title: dialogSummary(dialog) }),
      },
      () => this.#deps.onClick(state.id),
    );
  }

  /** 任务从忙碌变成"正常跑完"或"出错"：跑完时按设置响提示音；窗口看不见时发一条结果通知。 */
  async #notifyEnded(state: TaskState): Promise<void> {
    const done = state.status === "idle" && state.lastTurn?.status === "completed";
    if (!done && state.status !== "error") return;
    const notify = this.#deps.windowHidden() && (await this.#deps.enabled());
    // 系统通知自己带提示音，发通知时不再另响一声。
    if (done && !notify && (await this.#deps.soundEnabled())) this.#deps.playSound();
    if (!notify) return;
    const locale = this.#deps.locale();
    this.#deps.show(
      {
        title: t(locale, "notify.title", {
          project: this.#deps.projectName(state),
          task: stripIconGlyphs(state.title) || t(locale, "task.untitled"),
        }),
        body: t(locale, done ? "notify.body.done" : "notify.body.error"),
      },
      () => this.#deps.onClick(state.id),
    );
  }
}
