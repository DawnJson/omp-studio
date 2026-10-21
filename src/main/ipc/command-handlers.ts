// omp 斜杠命令的两个 IPC（native-ui-plan I1/I2）：参数是封闭联合类型，主进程拼命令文本，渲染进程从不传自由文本。
// 会话级（runTaskCommand）在任务自己的 omp 里跑；和会话无关的（runBuiltin）在服务进程（用户范围）或项目目录里的短命 rpc-ui（项目范围）里跑。
import { pathKey } from "../tasks/task-registry.ts";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { buildOmpLaunch } from "../omp/launch.ts";
import { assignToAppJob } from "../platform/win32/job-object.ts";
import { runBuiltinOn } from "../service/builtin-command.ts";
import { PROJECT_IDLE_CLOSE_MS, ProjectOmpPool } from "../service/project-omp.ts";
import { serviceOmp } from "../service/service-omp.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { parseBuiltinScope, parseBuiltinCommandArg, parseTaskCommandArg, parseTaskId } from "./validate.ts";

const projectOmp = new ProjectOmpPool(
  { launch: (cwd) => buildOmpLaunch({ cwd, noSession: true }), assignJob: assignToAppJob },
  PROJECT_IDLE_CLOSE_MS,
  pathKey,
);
// 退出：项目里的 rpc-ui 全部关掉（主进程被强杀时由 Job Object 兜底）。
registerShutdownHook(() => projectOmp.close());

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
    const project = (await getTaskPool()).listProjects().find((candidate) => candidate.id === parsed.projectId);
    if (!project) throw new Error(`unknown project ${parsed.projectId}`);
    return { text: await projectOmp.use(project.path, (connection) => runBuiltinOn(connection, command)) };
  },
};
