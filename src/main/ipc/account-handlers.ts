// 占位：切片 E 账号和模型整体替换本文件。类型已完整（HandlerGroup 要求每个函数都在），实现抛 not implemented。
// 参数一律是 unknown：用 ./validate.ts 的 parse* 校验后再用。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { notImplemented } from "./not-implemented.ts";

export const accountHandlers: HandlerGroup<"listModels" | "listLoginProviders" | "startLogin" | "answerLoginInput" | "cancelLogin" | "listAccounts" | "logout" | "saveApiKey" | "clearApiKey" | "listApiKeyProviders"> = {
  listModels: () => notImplemented("listModels"),
  listLoginProviders: () => notImplemented("listLoginProviders"),
  startLogin: () => notImplemented("startLogin"),
  answerLoginInput: () => notImplemented("answerLoginInput"),
  cancelLogin: () => notImplemented("cancelLogin"),
  listAccounts: () => notImplemented("listAccounts"),
  logout: () => notImplemented("logout"),
  saveApiKey: () => notImplemented("saveApiKey"),
  clearApiKey: () => notImplemented("clearApiKey"),
  listApiKeyProviders: () => notImplemented("listApiKeyProviders"),
};
