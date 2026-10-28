// Tavily 备用 key：omp 发往 Tavily 的请求遇到 key 用完 / 无效 / 被限流，同一个请求马上换下一个备用 key 重发，
// omp 和模型看到的是正常结果，正在跑的任务也一样。换上的 key 成功之后，把 agent 目录 `.env` 里的 `TAVILY_API_KEY` 改成它、
// 旧 key 挪到备用列表末尾（额度每月重置，以后还能轮回来），之后新起的 omp 进程一开始就用好 key，不用先撞一次。
//
// omp 18.13.1 的 Tavily 搜索只认一个 key，额度用完只报错、不换 key（432 不算它会轮换的错误）；它每次搜索都调全局 fetch，所以在 omp 进程里包一层。
// 备用 key 由 studio 设置页写进同目录的 tavily-keys.json（JSON 字符串数组，不在部署清单里），每次要换 key 时重读，改了不用重启 omp。
// 见 docs/architecture/login.md「Tavily 备用 key」。
import { copyFileSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const TAVILY_ORIGIN = "https://api.tavily.com/";
/** 这个 key 在本进程里不再用：401 无效；432 超出套餐额度（实测）；433 超出按量付费上限（Tavily 文档）。 */
const DEAD_STATUSES = new Set([401, 432, 433]);
/** 只是这个 key 一时被限流（Tavily 按 key 限每分钟请求数）：这次请求换别的 key，之后还用它。 */
const RATE_LIMITED = 429;
const INSTALLED = Symbol.for("omp-studio.tavily-backup-keys");
/** `.env` 里 `TAVILY_API_KEY` 那一行：前缀（BOM、缩进、export、等号）、引号、值、行尾空白。 */
const ENV_LINE = /^(\uFEFF?[ \t]*(?:export[ \t]+)?TAVILY_API_KEY[ \t]*=[ \t]*)(["']?)([^\r\n"']*)\2([ \t]*)$/gm;

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

/** 先写临时文件再换名：别的 omp 进程可能正在读。 */
function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text, "utf8");
  try {
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * 把存着的 key 从 `dead` 换成 `next`：`.env` 里 `TAVILY_API_KEY` 只有一行、值正是 `dead` 时改那一行（别的行、注释、引号、CRLF、BOM 原样，写前留 `.env.bak`），
 * 然后备用列表去掉 `next`、末尾补上 `dead`。`.env` 没改（key 不在 `.env` 里，或者别的 omp 进程已经换过了）就都不动，免得列表和 `.env` 对不上。
 * 返回改没改。
 */
export function rotateStoredKey(envFile, keysFile, dead, next) {
  let text;
  try {
    text = readFileSync(envFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const lines = [...text.matchAll(ENV_LINE)];
  if (lines.length !== 1 || lines[0][3] !== dead) return false;
  copyFileSync(envFile, `${envFile}.bak`);
  writeAtomic(
    envFile,
    text.replace(ENV_LINE, (_line, head, quote, _value, tail) => `${head}${quote}${next}${quote}${tail}`),
  );
  const keys = readBackupKeys(keysFile).filter((key) => key !== next && key !== dead);
  writeAtomic(keysFile, JSON.stringify([...keys, dead]));
  return true;
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
 * omp 带来的 key 用完、换上的 key 成功时调一次 `onSwitched(dead, next)`（每个用完的 key 一个进程里只调一次）。
 * omp 发 Tavily 请求用的是 URL 字符串 + init（body 是 JSON 字符串）：这种形状原样保留 init（Bun 自己的选项如 proxy 也在里面），只换 Authorization。
 */
export function withBackupKeys(fetchImpl, loadKeys, onSwitched = () => {}) {
  /** 这个进程里已经无效或用完的 key（额度每月重置，进程活不了那么久）。 */
  const dead = new Set();
  /** 已经调过 onSwitched 的用完的 key。 */
  const reported = new Set();
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
        if (response.ok && key !== original) {
          current = key;
          if (dead.has(original) && !reported.has(original)) {
            reported.add(original);
            onSwitched(original, key);
          }
        }
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

/**
 * 装到这个 omp 进程的全局 fetch 上；扩展在同一进程里被加载多次（子代理的会话）时只装一次。
 * 存 key 失败（文件被占着、没权限）不影响这次搜索：这个进程照样用换上的 key，记进 omp 的日志（`pi.logger`），下个进程再试。
 */
export function installTavilyBackupKeys(keysFile, envFile, logger) {
  if (globalThis[INSTALLED]) return;
  globalThis[INSTALLED] = true;
  globalThis.fetch = withBackupKeys(
    globalThis.fetch,
    () => readBackupKeys(keysFile),
    (dead, next) => {
      try {
        rotateStoredKey(envFile, keysFile, dead, next);
      } catch (error) {
        logger.warn("studio-accounts: saving the switched Tavily key failed", { error: String(error) });
      }
    },
  );
}
