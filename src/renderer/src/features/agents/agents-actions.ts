// 子代理面板的三个操作：插话 / 结束 / 恢复。主进程在后台驱动 omp 的 Agent Hub（tasks/tsp-hub-driver.ts），
// 调用期间标记"正在驱动"（tsp-store.beginTspDrive）：过程区不画 omp 的 Hub、面板显示"正在发给 <名字>"。结果用 toast 说一声，失败带 omp 的原文。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { reportOmpError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { beginTspDrive, endTspDrive, type TspDrive } from "../tsp/tsp-store.ts";

async function drive(
  t: TFunction,
  taskId: TaskId,
  name: string,
  op: TspDrive["op"],
  run: () => Promise<void>,
  doneKey: "agents.steered" | "agents.killed" | "agents.revived",
): Promise<boolean> {
  beginTspDrive(taskId, { name, op });
  try {
    await run();
    pushToast({ level: "info", message: t(doneKey, { name }) });
    return true;
  } catch (error) {
    reportOmpError(t, error);
    return false;
  } finally {
    endTspDrive(taskId);
  }
}

/** 给子代理插一句话；成功返回 true（调用方清空输入框），失败原文提示、返回 false（文字留着）。 */
export function steerAgent(t: TFunction, taskId: TaskId, name: string, text: string): Promise<boolean> {
  return drive(t, taskId, name, "steer", () => window.studio.steerTspSubagent(taskId, name, text), "agents.steered");
}

export function killAgent(t: TFunction, taskId: TaskId, name: string): Promise<boolean> {
  return drive(t, taskId, name, "kill", () => window.studio.killTspSubagent(taskId, name), "agents.killed");
}

export function reviveAgent(t: TFunction, taskId: TaskId, name: string): Promise<boolean> {
  return drive(t, taskId, name, "revive", () => window.studio.reviveTspSubagent(taskId, name), "agents.revived");
}
