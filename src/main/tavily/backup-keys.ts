// Tavily 备用 key：设置页存的几个 key 放在 studio 的 userData（tavily-keys.json，不进 omp 目录）。
// studio 启动时、存了备用 key 后、之后每 30 分钟查一次 omp 当前用的 Tavily key 还有没有额度（key-credits.ts），
// 用完了就换成第一个还有额度的备用 key，走和设置页"设置 API key"同一条路（save-api-key.ts）。之后起的 omp 进程用新 key。
// 见 docs/architecture/login.md「Tavily 备用 key」。key 只进不出：界面只拿到个数，日志只写第几个。
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { providerKeyEnv } from "../../shared/provider-keys.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { log } from "../log/log.ts";
import { saveProviderApiKey } from "../login/save-api-key.ts";
import { envSourceOf, readEnvText } from "../omp-config/env-file.ts";
import { ompManager, readyOmp } from "../omp-manager/index.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";
import { runOmpCommand } from "../usage/usage-service.ts";
import { fetchCredits, pickReplacement } from "./key-credits.ts";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 30_000;

const keysFile = () => path.join(app.getPath("userData"), "tavily-keys.json");

export async function readBackupKeys(): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(keysFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const value: unknown = JSON.parse(text);
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string" && key !== "") : [];
}

/** 整体换掉备用 key（已去重）；空数组删掉文件。 */
export async function writeBackupKeys(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) await rm(keysFile(), { force: true, maxRetries: 3 });
  else await writeFileAtomic(keysFile(), JSON.stringify(keys), String(process.pid));
}

let checking: Promise<void> | null = null;

/** 查一次，必要时换 key；同时来的共用一次。失败只记日志（后台任务，没人等它）。 */
export function checkTavilyKey(): Promise<void> {
  checking ??= switchIfExhausted()
    .catch((error: unknown) =>
      log.warn("tavily: checking the key failed", error instanceof Error ? error.message : error),
    )
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** 启动时查一次，之后每 30 分钟查一次（没存备用 key 时只读一下文件就结束）。 */
export function startTavilyKeyWatch(): void {
  void checkTavilyKey();
  setInterval(() => void checkTavilyKey(), CHECK_INTERVAL_MS).unref();
}

async function switchIfExhausted(): Promise<void> {
  const backups = await readBackupKeys();
  if (backups.length === 0) return;
  // key 设在系统环境变量里时 omp 优先用它，换 `.env` / 凭据库里的不生效。
  if (providerKeyEnv("tavily", envSourceOf(await readEnvText(resolveAgentDir())))?.source === "system") {
    log.warn("tavily: TAVILY_API_KEY is a system environment variable; backup keys are not applied");
    return;
  }
  await ompManager().ensureReady();
  const token = await runOmpCommand(readyOmp().path, await serviceCwd(), TOKEN_TIMEOUT_MS)(["token", "tavily"]);
  const current = token.code === 0 && token.stdout.trim() !== "" ? token.stdout.trim() : null;
  const next = await pickReplacement(current, backups, (key) => fetchCredits(key));
  if (next === null) return;
  await saveProviderApiKey("tavily", next);
  log.info(
    `tavily: the current key is out of credits; switched to backup key ${backups.indexOf(next) + 1}/${backups.length}`,
  );
}
