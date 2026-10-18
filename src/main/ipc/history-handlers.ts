// 占位：切片 D 侧栏和历史整体替换本文件。类型已完整（HandlerGroup 要求每个函数都在），实现抛 not implemented。
// 参数一律是 unknown：用 ./validate.ts 的 parse* 校验后再用。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { notImplemented } from "./not-implemented.ts";

export const historyHandlers: HandlerGroup<"listSessions" | "resumeSession"> = {
  listSessions: () => notImplemented("listSessions"),
  resumeSession: () => notImplemented("resumeSession"),
};
