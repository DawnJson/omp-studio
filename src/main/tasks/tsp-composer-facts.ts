// TaskState.composerMode / extStatuses：模式和扩展状态在 omp 输入框卡片里，卡片被选择器 / 弹窗 / 提问换掉时（文档里没有
// `omp.editor`）不知道，沿用上一次的值；卡片回来再更新（和目标一样，shared/tsp/composer-facts.ts 头部）。
import type { TaskState } from "../../shared/ipc.ts";
import type { ComposerFacts } from "../../shared/tsp/composer-facts.ts";

export class TspComposerFactsTracker {
  #mode: TaskState["composerMode"] = null;
  #extStatuses: readonly string[] = [];

  get mode(): TaskState["composerMode"] {
    return this.#mode;
  }

  get extStatuses(): readonly string[] {
    return this.#extStatuses;
  }

  /** 新进程 / 进程退出：模式和扩展状态是进程里的东西，从头读。 */
  reset(): void {
    this.#mode = null;
    this.#extStatuses = [];
  }

  /** 读一帧文档推出的事实；模式或扩展状态变了返回 true（调用方发布状态）。 */
  observe(facts: ComposerFacts): boolean {
    if (!facts.composer) return false;
    const mode = facts.mode === null || facts.mode.kind === "goal" ? null : facts.mode;
    const modeChanged = JSON.stringify(mode) !== JSON.stringify(this.#mode);
    const extChanged = facts.extStatuses.join("\u0000") !== this.#extStatuses.join("\u0000");
    if (modeChanged) this.#mode = mode;
    if (extChanged) this.#extStatuses = facts.extStatuses;
    return modeChanged || extChanged;
  }
}
