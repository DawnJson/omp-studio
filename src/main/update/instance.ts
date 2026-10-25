// 更新服务的 Electron 接线：electron-updater 的 autoUpdater、更新源解析、把状态推给界面、安装前跑退出流程。
// 更新源：STUDIO_UPDATE_URL（本地测试 / 临时切换，http(s) 地址或本机目录）优先，否则用打包时写入的
// resources/app-update.yml（electron-builder.yml 的 publish：本仓库的 GitHub Releases），两个都没有就不检查。
// 本机目录由 local-feed.ts 在 127.0.0.1 上提供，目录不存在时按未配置处理。开发版（没打包）一律不检查。
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import type { AppUpdater } from "electron-updater";
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

/**
 * 准备更新源，返回是否可以检查更新。
 * STUDIO_UPDATE_URL 写成 userData/app-update.yml（generic）再指过去：本机目录要换成回环地址；
 * electron-updater 还要从配置里读 updaterCacheDirName（下载缓存目录），只给地址时检查能过、开始下载时 ENOENT。
 * 没有覆盖时 electron-updater 自己读 resources/app-update.yml（electron-builder 写的，带 updaterCacheDirName）。
 */
async function configureFeed(): Promise<boolean> {
  const override = process.env["STUDIO_UPDATE_URL"];
  if (override === undefined || override === "") {
    return existsSync(path.join(process.resourcesPath, "app-update.yml"));
  }
  let feedUrl = override;
  const dir = localFeedDir(override);
  if (dir !== null) {
    if (!existsSync(dir)) {
      log.info(`update feed: local directory ${dir} does not exist; updates off`);
      return false;
    }
    feedUrl = (await serveFeedDir(dir)).url;
    autoUpdater.disableDifferentialDownload = true;
    log.info(`update feed: local directory ${dir} served at ${feedUrl}`);
  }
  const written = path.join(app.getPath("userData"), "app-update.yml");
  writeFileSync(
    written,
    `provider: generic\nurl: ${JSON.stringify(feedUrl)}\nupdaterCacheDirName: omp-studio-updater\n`,
    "utf8",
  );
  autoUpdater.updateConfigPath = written;
  return true;
}

export async function startUpdates(): Promise<void> {
  // mac：不签名（ad-hoc）的应用 Squirrel.Mac 装不了更新，所以不给 autoUpdater 任何更新源，服务处于 disabled（未在 mac 上实测）。
  const macManual = process.platform === "darwin";
  const enabled = app.isPackaged && !macManual && (await configureFeed());

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
