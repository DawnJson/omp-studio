// Tavily 备用 key：当前 key 的额度用完（Tavily 回 432 / 433）时，同一个请求换下一个备用 key 重发，之后的请求直接用换上的 key。
//
// omp 18.13.1 的 Tavily 搜索只认一个 key（TAVILY_API_KEY 或凭据库），额度用完只报错、不换 key（432 不算它会轮换的错误，
// 同一 provider 的凭据库也只留一个 API key）。它每次搜索都调全局 fetch，所以在 omp 进程里包一层 fetch。
// 备用 key 由 studio 设置页写进同目录的 tavily-keys.json（JSON 字符串数组，不在部署清单里），每次要换 key 时重读，改了不用重启 omp。
// 见 docs/architecture/client-accounts.md「Tavily 备用 key」。
import { readFileSync } from "node:fs";

const TAVILY_ORIGIN = "https://api.tavily.com/";
/** 432：超出套餐额度（实测）；433：超出按量付费上限（Tavily 文档）。 */
const EXHAUSTED_STATUSES = new Set([432, 433]);
const INSTALLED = Symbol.for("omp-studio.tavily-backup-keys");

/** 备用 key 文件里的 key；文件不存在时没有备用 key。 */
export function readBackupKeys(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const value = JSON.parse(text);
  return Array.isArray(value) ? value.filter((key) => typeof key === "string" && key !== "") : [];
}

/** 包一层 fetch：发往 Tavily 的请求遇到额度用完就换 `loadKeys()` 里下一个没用完的 key 重发；别的请求原样转发。 */
export function withBackupKeys(fetchImpl, loadKeys) {
  /** 这个进程里已经回过额度用完的 key（每月重置，进程活不了那么久）。 */
  const exhausted = new Set();
  /** 最近换上的 key：omp 下次还会拿用完的那个 key 来，直接换成它，不再先撞一次。 */
  let current;
  const wrapped = async (input, init) => {
    // omp 发 Tavily 请求用的是 URL 字符串 + init（body 是 JSON 字符串，能重发）；Request 对象的 body 是流，不碰。
    if (typeof input !== "string" || !input.startsWith(TAVILY_ORIGIN)) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    let key = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1];
    if (key === undefined) return fetchImpl(input, init);
    if (exhausted.has(key) && current !== undefined) key = current;
    for (;;) {
      headers.set("authorization", `Bearer ${key}`);
      const response = await fetchImpl(input, { ...init, headers });
      if (!EXHAUSTED_STATUSES.has(response.status)) return response;
      exhausted.add(key);
      const next = loadKeys().find((candidate) => !exhausted.has(candidate));
      if (next === undefined) return response;
      current = next;
      key = next;
    }
  };
  // omp 自己包 fetch 时也带上 Bun 的 preconnect，别处会读 `globalThis.fetch.preconnect`。
  return Object.assign(wrapped, { preconnect: fetchImpl.preconnect });
}

/** 装到这个 omp 进程的全局 fetch 上；扩展在同一进程里被加载多次（子代理的会话）时只装一次。 */
export function installTavilyBackupKeys(file) {
  if (globalThis[INSTALLED]) return;
  globalThis[INSTALLED] = true;
  globalThis.fetch = withBackupKeys(globalThis.fetch, () => readBackupKeys(file));
}
