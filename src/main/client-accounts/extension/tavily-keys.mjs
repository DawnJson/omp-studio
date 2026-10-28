// Tavily 备用 key，第一层（无损）：omp 发往 Tavily 的请求遇到 key 用完 / 无效 / 被限流，同一个请求马上换下一个备用 key 重发，
// omp 和模型看到的是正常结果，正在跑的任务也一样。第二层是 studio 主进程定时把 omp 存的 key 换成有额度的（src/main/tavily/backup-keys.ts），
// 新进程一开始就用好 key；omp 哪天不再经全局 fetch 发 Tavily 请求，这一层失效时还有它兜底。
//
// omp 18.13.1 的 Tavily 搜索只认一个 key，额度用完只报错、不换 key（432 不算它会轮换的错误）；它每次搜索都调全局 fetch，所以在 omp 进程里包一层。
// 备用 key 由 studio 设置页写进同目录的 tavily-keys.json（JSON 字符串数组，不在部署清单里），每次要换 key 时重读，改了不用重启 omp。
// 见 docs/architecture/login.md「Tavily 备用 key」。
import { readFileSync } from "node:fs";

const TAVILY_ORIGIN = "https://api.tavily.com/";
/** 这个 key 在本进程里不再用：401 无效；432 超出套餐额度（实测）；433 超出按量付费上限（Tavily 文档）。 */
const DEAD_STATUSES = new Set([401, 432, 433]);
/** 只是这个 key 一时被限流（Tavily 按 key 限每分钟请求数）：这次请求换别的 key，之后还用它。 */
const RATE_LIMITED = 429;
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

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return "";
}

function bearer(headers) {
  return /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1];
}

/** 请求体能不能原样再发一次（流只能读一次）。 */
function resendable(body) {
  return (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

/**
 * 包一层 fetch：发往 Tavily 的请求换 `loadKeys()` 里的备用 key 重发（规则见上面两个状态码集合）；别的请求原样转发。
 * omp 发 Tavily 请求用的是 URL 字符串 + init（body 是 JSON 字符串）：这种形状原样保留 init（Bun 自己的选项如 proxy 也在里面），只换 Authorization。
 */
export function withBackupKeys(fetchImpl, loadKeys) {
  /** 这个进程里已经无效或用完的 key（额度每月重置，进程活不了那么久）。 */
  const dead = new Set();
  /** 最近换上、成功过的 key：omp 下次还会拿用完的那个来，直接换成它，不再先撞一次。 */
  let current;
  const send = (input, init, key) => {
    if (input instanceof Request) {
      const request = new Request(input.clone(), init);
      request.headers.set("authorization", `Bearer ${key}`);
      return fetchImpl(request);
    }
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${key}`);
    return fetchImpl(input, { ...init, headers });
  };
  const wrapped = async (input, init) => {
    if (!urlOf(input).startsWith(TAVILY_ORIGIN)) return fetchImpl(input, init);
    const original = bearer(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
    if (original === undefined || !resendable(init?.body)) return fetchImpl(input, init);
    let key = dead.has(original) && current !== undefined && !dead.has(current) ? current : original;
    const tried = new Set();
    for (;;) {
      tried.add(key);
      const response = await send(input, init, key);
      const isDead = DEAD_STATUSES.has(response.status);
      if (!isDead && response.status !== RATE_LIMITED) {
        if (response.ok && key !== original) current = key;
        return response;
      }
      if (isDead) dead.add(key);
      const next = loadKeys().find((candidate) => !dead.has(candidate) && !tried.has(candidate));
      if (next === undefined) return response;
      await response.body?.cancel();
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
