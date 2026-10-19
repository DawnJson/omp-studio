// 启动缓存的单例：文件在 userData/startup-cache.json（测试时 STUDIO_USER_DATA 换掉 userData，自然隔离）。
import { app } from "electron";
import path from "node:path";
import { log } from "../log/log.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";
import { StartupCache } from "./startup-cache.ts";

let cache: StartupCache | null = null;

export function startupCache(): StartupCache {
  cache ??= new StartupCache({
    file: path.join(app.getPath("userData"), "startup-cache.json"),
    write: (file, text) => writeFileAtomic(file, text, String(process.pid)),
    warn: (message, error) => log.warn(message, error instanceof Error ? error.message : error),
  });
  return cache;
}
