// 把各区域的 handler 拼成完整的 InvokeHandlers，逐个注册成 `studio:<函数名>` 通道。
// 每次调用先校验发送方；参数校验在各 handler 里（./validate.ts）。少一个函数类型检查就失败。
import { ipcMain } from "electron";
import { invokeChannel, type InvokeHandlers } from "../../shared/ipc.ts";
import { accountHandlers } from "./account-handlers.ts";
import { appHandlers } from "./app-handlers.ts";
import { historyHandlers } from "./history-handlers.ts";
import { ompHandlers } from "./omp-handlers.ts";
import { taskHandlers } from "./task-handlers.ts";
import { assertTrustedSender } from "./validate.ts";

const handlers: InvokeHandlers = {
  ...appHandlers,
  ...taskHandlers,
  ...historyHandlers,
  ...accountHandlers,
  ...ompHandlers,
};

export function registerIpcHandlers(): void {
  for (const name of Object.keys(handlers) as (keyof InvokeHandlers)[]) {
    const handler = handlers[name];
    ipcMain.handle(invokeChannel(name), (event, ...args: unknown[]) => {
      assertTrustedSender(event);
      return handler(...args);
    });
  }
}
