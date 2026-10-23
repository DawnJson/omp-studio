// 和会话无关的 omp 内置命令（native-ui-plan I2）：在服务进程或项目 rpc-ui 上发 `prompt`，收集 `command_output` 直到应答。
// 安全网：命令名必须在 get_available_commands 里且 source 是 builtin（实测 `/unpin` 不是内置命令，被当成消息发给了模型）；
// 应答 `agentInvoked: true` 说明漏给了模型，按失败处理。omp 自己报的失败（"Failed to add…"）是普通 command_output，原样返回。
// 执行期间的 extension_error / rpc_frame_error（输出超限被丢等）按失败抛出，原文不改；notice 是提示，附在输出后面。
import { stripAnsi } from "../../shared/ansi.ts";
import { builtinCommandText, commandName, type BuiltinCommand } from "../../shared/omp-output/index.ts";
import type { OmpConnection } from "../omp/omp-connection.ts";

/** 每个连接一条队列：同一进程上的内置命令串行（command_output 帧没有请求 id，并发会串台）。 */
const queues = new WeakMap<OmpConnection, Promise<unknown>>();

export function runCommandText(connection: OmpConnection, text: string): Promise<string> {
  const run = (queues.get(connection) ?? Promise.resolve()).then(
    () => execute(connection, text),
    () => execute(connection, text),
  );
  queues.set(connection, run);
  return run;
}

async function execute(connection: OmpConnection, text: string): Promise<string> {
  const name = commandName(text);
  const { commands } = await connection.request("get_available_commands");
  const known = commands.some(
    (command) => command.source === "builtin" && (command.name === name || command.aliases?.includes(name)),
  );
  if (!known) throw new Error(`/${name} is not an omp builtin command`);
  const output: string[] = [];
  const notices: string[] = [];
  const failures: string[] = [];
  // 监听器里不能抛：抛错会让整个连接被当作致命错误关掉。先记下来，等 prompt 应答后再抛。
  const stop = connection.onFrame((frame) => {
    if (frame.type === "command_output") output.push(stripAnsi(frame.text));
    else if (frame.type === "notice") notices.push(stripAnsi(frame.message));
    else if (frame.type === "extension_error" || frame.type === "rpc_frame_error") failures.push(frame.error);
  });
  try {
    const ack = await connection.request("prompt", { message: text });
    if (ack?.agentInvoked !== false)
      throw new Error(`omp treated ${text} as a message to the model, not a builtin command`);
  } finally {
    stop();
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return [...output, ...notices].join("\n");
}

export function runBuiltinOn(connection: OmpConnection, cmd: BuiltinCommand): Promise<string> {
  return runCommandText(connection, builtinCommandText(cmd));
}
