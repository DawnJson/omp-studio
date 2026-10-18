// 应用自身的更新：状态查询、手动检查、安装已下载的更新。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { checkForUpdate, getUpdateState, installUpdate } from "../update/instance.ts";

export const updateHandlers: HandlerGroup<"getUpdateState" | "checkForUpdate" | "installUpdate"> = {
  getUpdateState: async () => getUpdateState(),
  checkForUpdate: async () => {
    await checkForUpdate();
  },
  installUpdate: async () => {
    await installUpdate();
  },
};
