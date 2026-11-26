// MCP 登录的单例和它的 Electron 接线：起 rpc-ui（放进 Job Object）、授权地址推给渲染进程、退出时关进程。逻辑在 mcp-reauth.ts。
import { emitEvent } from "../ipc/events.ts";
import { buildOmpLaunch } from "../omp/launch.ts";
import { OmpConnection, OmpExitedError } from "../omp/omp-connection.ts";
import { assignToAppJob } from "../platform/win32/job-object.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { McpReauth } from "./mcp-reauth.ts";

let instance: McpReauth | null = null;

export function mcpReauth(): McpReauth {
  if (instance) return instance;
  const reauth = new McpReauth({
    spawn: async (cwd) => {
      const connection = OmpConnection.spawn(await buildOmpLaunch({ cwd, noSession: true }));
      try {
        // 同一个同步段里放进 Job Object：主进程被强杀时由系统回收。
        assignToAppJob(connection.pid);
        await connection.ready;
      } catch (error) {
        await connection.close(1_000);
        // 起不来时带上 omp 自己说的最后几行（和终端登录一样）：只说 "exited with code 1" 用户没法处理。
        const tail =
          error instanceof OmpExitedError ? error.exit.stderrTail.trim().split(/\r?\n/).slice(-4).join("\n") : "";
        throw tail === "" ? error : new Error(`${(error as Error).message}\n${tail}`);
      }
      return {
        onFrame: (listener) => connection.onFrame(listener),
        prompt: async (message) => (await connection.request("prompt", { message }))?.agentInvoked,
        exited: connection.exited,
        close: (timeoutMs) => connection.close(timeoutMs),
      };
    },
    onUrl: (url) => emitEvent("mcpReauthUrl", url),
  });
  instance = reauth;
  registerShutdownHook(() => reauth.cancel());
  return reauth;
}
