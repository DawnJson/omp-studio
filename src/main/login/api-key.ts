// 设置页填的 API key：经 `omp auth import -` 写进 omp 自己的凭据库（agent.db，和终端版共用），studio 不另存（docs/architecture/login.md）。
// 不 import electron，可以对真实 omp 单测。key 走 stdin，不进命令行；报错里出现 key 原文时先换掉再抛。
import { runCommand } from "../git/exec.ts";
import { acceptsApiKey } from "../../shared/provider-keys.ts";

const IMPORT_TIMEOUT_MS = 30_000;

/**
 * 存一个 provider 的 API key。omp 18.12.6 实测：同一 provider 已有的 API key 被替换，OAuth 凭据保留；
 * 不认识的 provider id 也照收，所以先按 acceptsApiKey 拒绝。
 */
export async function importApiKey(
  ompPath: string,
  cwd: string,
  providerId: string,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!acceptsApiKey(providerId)) throw new Error(`provider ${providerId} does not take an API key`);
  const value = key.trim();
  if (value === "") throw new Error("the API key is empty");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new Error("the API key contains control characters (such as a line break or NUL); paste it again");
  const input = JSON.stringify({
    version: 1,
    credentials: [{ provider: providerId, credential: { type: "api_key", key: value } }],
  });
  const result = await runCommand(ompPath, ["auth", "import", "-"], {
    cwd,
    input,
    env: { ...env, NO_COLOR: "1", FORCE_COLOR: "0" },
    timeoutMs: IMPORT_TIMEOUT_MS,
  });
  if (result.code === 0) return;
  const tail = result.stderr.trim().split(/\r?\n/).slice(-3).join(" | ").slice(-400).replaceAll(value, "***");
  throw new Error(`omp auth import exited with code ${result.code}${tail ? `: ${tail}` : ""}`);
}
