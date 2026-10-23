// omp 斜杠命令的两个 IPC（native-ui-plan I1/I2）：参数是封闭联合类型，主进程拼命令文本，渲染进程从不传自由文本。
// 会话级（runTaskCommand）在任务自己的 omp 里跑；和会话无关的（runBuiltin）在服务进程（用户范围）或项目目录里的短命 rpc-ui（项目范围）里跑。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { runBuiltinOn } from "../service/builtin-command.ts";
import { projectOmp } from "../service/project-omp-instance.ts";
import { serviceOmp } from "../service/service-omp.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { parseBuiltinScope, parseBuiltinCommandArg, parseTaskCommandArg, parseTaskId } from "./validate.ts";

export const commandHandlers: HandlerGroup<"runTaskCommand" | "runBuiltin"> = {
  runTaskCommand: async (taskId, cmd) => {
    const id = parseTaskId(taskId);
    const command = parseTaskCommandArg(cmd);
    return (await getTaskPool()).runTaskCommand(id, command);
  },
  runBuiltin: async (cmd, scope) => {
    const command = parseBuiltinCommandArg(cmd);
    const parsed = parseBuiltinScope(scope);
    if (parsed === null) return { text: await serviceOmp.use((connection) => runBuiltinOn(connection, command)) };
    // 项目目录取自主进程的项目记录，不用渲染进程传的路径。
    const projectPath = (await getTaskPool()).projectPath(parsed.projectId);
    return { text: await projectOmp.use(projectPath, (connection) => runBuiltinOn(connection, command)) };
  },
};
