// "最近更新"：照 omp 的 What's New（startup.changelogMode = summary）。升级后第一次启动时，在新任务页标志下面
// 显示自上次看过的版本以来的条目统计；随即把当前版本记进 userData/last-changelog-version，下次启动就不再显示。
// 没有记录（第一次装）当作从上一个版本升级来，只算当前版本这一节。说明来自打进主进程包里的 CHANGELOG.md。
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import changelog from "../../CHANGELOG.md?raw";
import { countEntries, releasedVersions, releaseNotes } from "../shared/changelog.ts";
import type { WhatsNew } from "../shared/ipc.ts";
import { log } from "./log/log.ts";
import { compareVersions } from "./omp-manager/version.ts";

/** lastSeen 之后、current 为止各版本的条目统计；lastSeen 为 null 时只算 current。没有可说的返回 null。 */
export function summarizeWhatsNew(text: string, current: string, lastSeen: string | null): WhatsNew | null {
  const versions = releasedVersions(text).filter(
    (version) =>
      compareVersions(version, current) <= 0 &&
      (lastSeen === null ? version === current : compareVersions(version, lastSeen) > 0),
  );
  const summary: WhatsNew = { version: current, releases: 0, added: 0, changed: 0, fixed: 0, total: 0 };
  for (const version of versions) {
    const counts = countEntries(releaseNotes(text, version) ?? "");
    summary.releases++;
    summary.added += counts.added;
    summary.changed += counts.changed;
    summary.fixed += counts.fixed;
    summary.total += counts.total;
  }
  return summary.total > 0 ? summary : null;
}

let cached: { value: WhatsNew | null } | null = null;

/** 本次启动的摘要：第一次调用时读记录、算摘要、写入当前版本；之后（含渲染进程重载）返回同一个结果。 */
export function whatsNewForThisLaunch(): WhatsNew | null {
  if (cached !== null) return cached.value;
  const marker = path.join(app.getPath("userData"), "last-changelog-version");
  const current = app.getVersion();
  let lastSeen: string | null = null;
  try {
    lastSeen = readFileSync(marker, "utf8").trim() || null;
  } catch {
    // 没有记录：第一次装。
  }
  const value =
    lastSeen !== null && compareVersions(current, lastSeen) <= 0
      ? null
      : summarizeWhatsNew(changelog, current, lastSeen);
  try {
    writeFileSync(marker, current, "utf8");
  } catch (error) {
    log.warn("whats-new: cannot write marker", error);
  }
  cached = { value };
  return value;
}
