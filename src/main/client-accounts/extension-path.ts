// studio 自带的账号型 provider 扩展在磁盘上的位置：启动时部署一次，之后所有 omp 进程都带 `-e`。
// 部署失败不阻塞任何功能（任务照跑，只是设置里看不到那些 provider），所以这里只记日志、返回空。
import { app } from "electron";
import { log } from "../log/log.ts";
import { deployAccountExtension } from "./deploy.ts";

let entryPath: string | null = null;

/** 应用就绪后调用一次；重复调用无副作用。 */
export async function prepareAccountExtension(): Promise<void> {
  try {
    entryPath = await deployAccountExtension(app.getPath("userData"));
  } catch (error) {
    log.error("account provider extension: deploy failed", error);
    entryPath = null;
  }
}

/** 部署好的入口绝对路径；还没部署或部署失败时为 null。 */
export function accountExtensionPath(): string | null {
  return entryPath;
}

/** 给 `omp` 命令行追加的参数（`omp models`、`omp usage` 这些也要看到那些 provider）。 */
export function accountExtensionArgs(): string[] {
  return entryPath ? ["-e", entryPath] : [];
}

/** 只在测试里用：直接指向一个准备好的入口。 */
export function setAccountExtensionPathForTest(value: string | null): void {
  entryPath = value;
}
