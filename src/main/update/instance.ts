// 更新服务的 Electron 接线：electron-updater 的 autoUpdater、更新源解析、把状态推给界面、安装前跑退出流程。
// 更新源优先级：STUDIO_UPDATE_URL（本地测试/临时切换）> 打包时写入的 app-update.yml 的 url > 未配置（设置页显示原因）。
// 更新源可以是 http(s) 地址，也可以是本机目录（file:// 或绝对路径，local-feed.ts 在 127.0.0.1 上提供）；本机目录不存在时按未配置处理。
// 只有安装版才检查：免安装目录（win-unpacked）没有安装器，开发版没有 app-update.yml。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import type { AppUpdater } from "electron-updater";
import { parse } from "yaml";
import type { UpdateState } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import { log } from "../log/log.ts";
import { finishShutdown } from "../window/shutdown.ts";
import { localFeedDir, serveFeedDir } from "./local-feed.ts";
import { UpdateService, type Updater } from "./service.ts";

// electron-updater 是 CJS，主进程打出来是 ESM；Node 的具名导出探测认不出 autoUpdater
// （实测 import { autoUpdater } 会让应用启动即崩），所以用 require 拿。
const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater") as { autoUpdater: AppUpdater };

let service: UpdateService | undefined;
let latest: UpdateState = {
  currentVersion: app.getVersion(),
  latestVersion: null,
  phase: "idle",
  percent: 0,
  lastCheckedAt: null,
  error: null,
  disabledReason: null,
};

/** 设置页随时可能读到；服务启动前返回初始状态。 */
export function getUpdateState(): UpdateState {
  return latest;
}

/** 配置的更新源原文：环境变量优先，其次是打包时写入的 app-update.yml；开发版一律没有。 */
function configuredSource(): string | null {
  if (!app.isPackaged) return null;
  const override = process.env["STUDIO_UPDATE_URL"];
  if (override !== undefined && override !== "") return override;
  const builtIn = path.join(process.resourcesPath, "app-update.yml");
  if (!existsSync(builtIn)) return null;
  const config: unknown = parse(readFileSync(builtIn, "utf8"));
  return typeof config === "object" && config !== null && "url" in config && typeof config.url === "string"
    ? config.url
    : null;
}

export async function startUpdates(): Promise<void> {
  const source = process.platform === "darwin" ? null : configuredSource();
  let feedUrl = source;
  const dir = source === null ? null : localFeedDir(source);
  if (dir !== null) {
    if (existsSync(dir)) {
      feedUrl = (await serveFeedDir(dir)).url;
      autoUpdater.disableDifferentialDownload = true;
      log.info(`update feed: local directory ${dir} served at ${feedUrl}`);
    } else {
      feedUrl = null;
      log.info(`update feed: local directory ${dir} does not exist; updates off`);
    }
  }

  if (feedUrl !== null) {
    // 一律写到 userData 再指过去：本机目录要换成上面的回环地址；electron-updater 还要从配置里读
    // updaterCacheDirName（下载缓存目录），只给地址时检查能过、开始下载时 ENOENT。
    const written = path.join(app.getPath("userData"), "app-update.yml");
    writeFileSync(
      written,
      `provider: generic\nurl: ${JSON.stringify(feedUrl)}\nupdaterCacheDirName: omp-studio-updater\n`,
      "utf8",
    );
    autoUpdater.updateConfigPath = written;
  }

  // mac：不签名（ad-hoc）的应用 Squirrel.Mac 装不了更新，所以不给 autoUpdater 任何更新源，服务处于 disabled（未在 mac 上实测）。
  const macManual = process.platform === "darwin";
  const enabled = feedUrl !== null && !macManual;

  // electron-updater 的 AppUpdater 是 EventEmitter 子类；Updater 只描述服务用到的部分，测试用假实现。
  const updater = autoUpdater as unknown as Updater;
  service = new UpdateService({
    currentVersion: app.getVersion(),
    enabled,
    disabledReason: macManual ? "manual-only" : app.isPackaged ? "no-feed" : "not-packaged",
    updater,
    emit: (state) => {
      latest = state;
      emitEvent("updateState", state);
    },
    prepareInstall: () => finishShutdown(),
    log: (message) => log.info(message),
  });
  latest = service.state();
  service.start();
}

/** 手动检查（设置页的"检查更新"）。没启用时什么也不做，界面按 getUpdateState 显示原因。 */
export async function checkForUpdate(): Promise<void> {
  await service?.check(true);
}

/** 安装已下载的更新；没有已下载的更新时抛错，界面显示失败原因。 */
export async function installUpdate(): Promise<void> {
  if (service === undefined) throw new Error("update service is not running");
  await service.install();
}
