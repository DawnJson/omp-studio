// 子代理泳道的 IPC handler：校验参数，委托任务池。子代理 id 是否存在、是否在运行由任务运行时查表确认。
import { subagentLimits } from "../../shared/subagents.ts";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { parseInteger, parseString, parseTaskId } from "./validate.ts";

/** omp 给的名字（`Outer-3.Inner`）：不限字符集，只限长度。 */
const subagentIdMaxChars = 256;

export const subagentHandlers: HandlerGroup<"getSubagents" | "getSubagentDetail" | "steerSubagent" | "cancelSubagent"> =
  {
    async getSubagents(taskId) {
      return (await getTaskPool()).getSubagents(parseTaskId(taskId));
    },
    async getSubagentDetail(taskId, subagentId, since) {
      return (await getTaskPool()).getSubagentDetail(
        parseTaskId(taskId),
        parseString(subagentId, "subagentId", subagentIdMaxChars),
        since === undefined ? undefined : parseInteger(since, "since", 0, Number.MAX_SAFE_INTEGER),
      );
    },
    async steerSubagent(taskId, subagentId, text) {
      await (
        await getTaskPool()
      ).steerSubagent(
        parseTaskId(taskId),
        parseString(subagentId, "subagentId", subagentIdMaxChars),
        parseString(text, "text", subagentLimits.steerChars),
      );
    },
    async cancelSubagent(taskId, subagentId) {
      return (await getTaskPool()).cancelSubagent(
        parseTaskId(taskId),
        parseString(subagentId, "subagentId", subagentIdMaxChars),
      );
    },
  };
