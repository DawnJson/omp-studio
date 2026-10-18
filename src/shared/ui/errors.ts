// 错误怎么翻译给用户（纯逻辑，渲染进程的 reportError 在 renderer/src/ui/errors.ts）：
// - 去掉 Electron 给主进程错误加的 "Error invoking remote method …: Error:" 前缀；
// - 已知错误（TaskError.kind、主进程里可预期的几句）映射成当前语言的文案；
// - 未知错误显示本地化的通用句，原文只放在悬停提示（toast 的 title / 详情）里。
import type { TFunction } from "../i18n/index.ts";
import type { TaskError } from "../ipc.ts";

const taskErrorKinds: Record<TaskError["kind"], Parameters<TFunction>[0]> = {
  omp_unavailable: "error.startFailed",
  spawn_failed: "error.startFailed",
  handshake_failed: "error.startFailed",
  restore_model_failed: "error.modelUnavailable",
  exited: "error.exitedNoCode",
  protocol: "error.protocol",
  too_many_tasks: "error.tooManyTasks",
};

/** 主进程里可预期错误的措辞 → 文案。主进程改了措辞只会退化成通用句，不会显示错的内容。 */
const knownMessages: [RegExp, Parameters<TFunction>[0]][] = [
  [/too many tasks/i, "error.tooManyTasks"],
  [/executable files are not opened directly/i, "error.executableBlocked"],
  [/project still has tasks/i, "project.removeBlocked"],
  [/^unknown (task|project) /i, "error.notFound"],
];

/** 错误原文：去掉 IPC 前缀和 "Error:" 前缀。 */
export function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
  return text.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "").replace(/^(\w*Error):\s*/, "");
}

function isTaskError(error: unknown): error is TaskError {
  return typeof error === "object" && error !== null && "kind" in error && typeof error.kind === "string" && error.kind in taskErrorKinds;
}

/** 给用户看的一句话（当前语言）。 */
export function describeError(t: TFunction, error: unknown): string {
  if (isTaskError(error)) return t(taskErrorKinds[error.kind]);
  const detail = errorDetail(error);
  const known = knownMessages.find(([pattern]) => pattern.test(detail));
  return t(known ? known[1] : "error.generic");
}
