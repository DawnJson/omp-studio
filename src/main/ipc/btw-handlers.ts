// 旁路提问（/btw）的 IPC handler：校验参数，委托任务池。话题 id 是否存在由任务运行时查表确认。
import { btwLimits } from "../../shared/btw.ts";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { parseString, parseTaskId } from "./validate.ts";

/** omp 给的话题 id（十六进制短串）：不限字符集，只限长度。 */
const recordIdMaxChars = 64;

export const btwHandlers: HandlerGroup<"askBtw" | "cancelBtw" | "getBtw"> = {
  async askBtw(taskId, question, recordId) {
    return (await getTaskPool()).askBtw(
      parseTaskId(taskId),
      parseString(question, "question", btwLimits.questionChars),
      recordId === undefined ? undefined : parseString(recordId, "recordId", recordIdMaxChars),
    );
  },
  async cancelBtw(taskId, recordId) {
    return (await getTaskPool()).cancelBtw(
      parseTaskId(taskId),
      recordId === undefined ? undefined : parseString(recordId, "recordId", recordIdMaxChars),
    );
  },
  async getBtw(taskId) {
    return (await getTaskPool()).getBtw(parseTaskId(taskId));
  },
};
