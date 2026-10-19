// 把各区域的 handler 拼成完整的 InvokeHandlers，逐个注册成 `studio:<函数名>` 通道。
// 每次调用先校验发送方；参数校验在各 handler 里（./validate.ts）。少一个函数类型检查就失败。
import { ipcMain } from "electron";
import { invokeChannel, type InvokeHandlers } from "../../shared/ipc.ts";
import { accountHandlers } from "./account-handlers.ts";
import { customModelHandlers } from "./custom-model-handlers.ts";
import { appHandlers } from "./app-handlers.ts";
import { fileHandlers } from "./file-handlers.ts";
import { draftHandlers } from "./draft-handlers.ts";
import { gitHandlers } from "./git-handlers.ts";
import { historyHandlers } from "./history-handlers.ts";
import { ompHandlers } from "./omp-handlers.ts";
import { subagentHandlers } from "./subagent-handlers.ts";
import { taskHandlers } from "./task-handlers.ts";
import { terminalHandlers } from "./terminal-handlers.ts";
import { updateHandlers } from "./update-handlers.ts";
import { usageHandlers } from "./usage-handlers.ts";
import { registerDropFolder } from "./drop-folder.ts";
import { assertTrustedSender } from "./validate.ts";
import { log } from "../log/log.ts";

const handlers: InvokeHandlers = {
  ...appHandlers,
  ...taskHandlers,
  ...historyHandlers,
  ...accountHandlers,
  ...customModelHandlers,
  ...ompHandlers,
  ...draftHandlers,
  ...gitHandlers,
  ...updateHandlers,
  ...usageHandlers,
  ...subagentHandlers,
  ...terminalHandlers,
  ...fileHandlers,
};

export function registerIpcHandlers(): void {
  for (const name of Object.keys(handlers) as (keyof InvokeHandlers)[]) {
    const handler = handlers[name];
    ipcMain.handle(invokeChannel(name), async (event, ...args: unknown[]) => {
      assertTrustedSender(event);
      try {
        return await handler(...args);
      } catch (error) {
        // 错误照常传回界面；这里只是留一份，界面上的提示消失后还能查。
        log.warn(`ipc ${name} failed`, error);
        throw error;
      }
    });
  }
  registerDropFolder();
}
