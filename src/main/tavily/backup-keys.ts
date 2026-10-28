// Tavily 备用 key：设置页存的几个 key 放在 studio 内置扩展的目录里（tavily-keys.json，不在部署清单里，重新部署不删），
// 扩展在 omp 进程里遇到 key 用完时当场换 key 重发，并把 agent 目录 `.env` 里的 key 换掉（client-accounts/extension/tavily-keys.mjs）。
// 这里只管存和列用量。见 docs/architecture/login.md「Tavily 备用 key」。key 只进不出：界面只拿到个数和每个 key 的用量。
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { TavilyKeyUsage } from "../../shared/ipc.ts";
import { ACCOUNT_EXTENSION_DIR } from "../client-accounts/deploy.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { ompManager, readyOmp } from "../omp-manager/index.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";
import { runOmpCommand } from "../usage/usage-service.ts";
import { fetchKeyUsage } from "./key-usage.ts";

const TOKEN_TIMEOUT_MS = 30_000;

const keysFile = () => path.join(resolveAgentDir(), "extensions", ACCOUNT_EXTENSION_DIR, "tavily-keys.json");

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

/** 整体换掉备用 key（已去重）；空数组删掉文件。正在跑的 omp 下次要换 key 时就读到。 */
export async function writeBackupKeys(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) await rm(keysFile(), { force: true, maxRetries: 3 });
  else await writeFileAtomic(keysFile(), JSON.stringify(keys), String(process.pid));
}

/** omp 现在用的 Tavily key（`omp token tavily`，按 omp 自己取 key 的顺序）和备用 key，各自的用量；同一个 key 只列一次。 */
export async function listTavilyKeyUsage(): Promise<TavilyKeyUsage[]> {
  await ompManager().ensureReady();
  const [token, backups] = await Promise.all([
    runOmpCommand(readyOmp().path, await serviceCwd(), TOKEN_TIMEOUT_MS)(["token", "tavily"]),
    readBackupKeys(),
  ]);
  const current = token.code === 0 ? token.stdout.trim() : "";
  const keys = [
    ...(current === "" ? [] : [{ role: "current" as const, key: current }]),
    ...backups.filter((key) => key !== current).map((key) => ({ role: "backup" as const, key })),
  ];
  return Promise.all(keys.map(async ({ role, key }) => ({ role, ...(await fetchKeyUsage(key)) })));
}
