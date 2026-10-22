// 分享会话：`omp share <会话文件> [--gist]`（和 `/share` 同一个实现，omp 18.12.5 的 CLI）。**会把加密后的会话快照上传**到
// `share.serverUrl`（默认 https://my.omp.sh/s）或 secret gist，所以调用方（界面）必须先经确认框；这里不替用户决定。
// 输出解析见 src/shared/omp-output/share.ts；确认框要显示的设置来自 `omp config list --json`（share.*）。
import type { ShareResult, ShareSettings } from "../../shared/ipc.ts";
import { parseShareOutput, shareErrorMessage } from "../../shared/omp-output/share.ts";
import { valueOf } from "../omp-config/model-defaults.ts";
import type { RunOmp } from "../usage/usage-service.ts";

/** omp 文档（collab.md）里的默认值：`omp config list --json` 缺键时才用。 */
const DEFAULT_SERVER_URL = "https://my.omp.sh/s";

export class ShareError extends Error {
  override name = "ShareError";
}

/** `omp config list --json` 的结果 → 分享确认框要说明的三项。 */
export function readShareSettings(listed: unknown): ShareSettings {
  const serverUrl = valueOf(listed, "share.serverUrl");
  const store = valueOf(listed, "share.store");
  const redact = valueOf(listed, "share.redactSecrets");
  return {
    serverUrl: typeof serverUrl === "string" && serverUrl !== "" ? serverUrl : DEFAULT_SERVER_URL,
    store: typeof store === "string" && store !== "" ? store : "blob",
    redactSecrets: typeof redact === "boolean" ? redact : true,
  };
}

/** 运行 `omp share`。非 0 退出时抛 ShareError（带 omp 的错误行）；成功时返回解析出的链接和原文。 */
export async function shareSession(run: RunOmp, sessionFile: string, gist: boolean): Promise<ShareResult> {
  const result = await run(["share", sessionFile, ...(gist ? ["--gist"] : [])]);
  if (result.code !== 0) {
    throw new ShareError(shareErrorMessage(result.stderr) || `omp share exited with code ${result.code}`);
  }
  return parseShareOutput(result.stdout);
}
