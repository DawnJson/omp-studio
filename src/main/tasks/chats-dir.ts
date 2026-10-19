// 没有项目时直接发送用的目录：第一次发送时创建并作为项目加入（omp 的 cwd 就是它，会话文件按它分桶）。
// 不用用户主目录：omp 在主目录里默认会换到临时目录（--allow-home），搜索也会扫整个主目录。
// 未打包且设了 STUDIO_USER_DATA（测试）时放进 userData，测试不碰真实用户目录。
import { app } from "electron";
import path from "node:path";

export function chatsDir(): string {
  if (!app.isPackaged && process.env["STUDIO_USER_DATA"]) return path.join(app.getPath("userData"), "chats");
  return path.join(app.getPath("home"), "omp-studio", "chats");
}
