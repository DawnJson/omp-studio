// 把一个 magpie / OpenCode 形状的 provider 插件（`makePlugin(site)` 的产物）接成 omp 的
// `pi.registerProvider` 配置。规则和实测见 docs/architecture/client-accounts.md。
//
// 插件的契约（只依赖这几处，升级 vendor 时先看这里）：
//   await make({ client })            → plugin
//   plugin.auth.methods[]             → { type:"oauth", label, prompts?, authorize(inputs) }
//                                        authorize 返回 { url, instructions, callback() }
//   plugin.auth.refresh(auth)         → 新的 auth（OpenCode 形状，token 一次性）
//   plugin.auth.loader(getAuth())     → { baseURL, apiKey, fetch(input, init) }，fetch 代表厂商的聊天接口
//   plugin.provider.models(provider, { auth }) → { [modelKey]: runtimeModel }
//   client.auth.set({ path, body })   → 插件刷新后想让我们保存的凭据
//
// omp 侧（18.12.6 源码 + 实测）：
//   - `oauth.login` 的 `onAuth` → RPC `open_url`，`onPrompt` → `input`（secret 提示在 RPC 被拒），`onProgress` → `notify`
//   - `getApiKey(credentials)` 在每次请求解析凭据时调用，`options.apiKey` 就是它的返回值
//   - `streamSimple(model, context, options)` 里 `options.fetch` 是流的唯一出口（openai-completions 用它取字节）
//   - 扩展 provider 的模型行只来自静态 `models` 或 `fetchDynamicModels` 的发现结果；`getAvailable()` 不经过
//     `oauth.modifyModels`，所以"只在投影时补行"是看不见的（2026-10-25 实测）
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import { streamOpenAICompletions } from "@oh-my-pi/pi-ai/providers/register-builtins";
import {
  SESSION_HEADER,
  modelRowFromRuntime,
  pickSignInMethod,
  stripType,
  supportsChatTransport,
  toPluginAuth,
} from "./adapter.mjs";
import { CATALOG_TTL_MS, readCachedAt, readCachedModels, writeCachedModels } from "./models-cache.mjs";

function log(...parts) {
  try {
    process.stderr.write(`[studio-accounts] ${parts.join(" ")}\n`);
  } catch {}
}

/** 扩展自己在磁盘上的目录：模型列表的缓存写在这里（userData 下，不是 ~/.omp）。 */
const extensionDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

/**
 * 注册一个由插件支撑的账号型 provider。
 * @param {object} pi omp 的 ExtensionAPI
 * @param {object} options
 * @param {string} options.id provider id（`qoder`、`qoder-cn`）
 * @param {string} options.name 显示名
 * @param {string} options.baseUrl 站点地址（只有元数据用；请求由插件的 fetch 决定）
 * @param {(input: {client: object}) => Promise<object>} options.make 插件的 `makePlugin(site)`
 * @param {string} [options.sessionHeader] 插件读会话 id 的那个头（插件 `_internal.SESSION`）
 */
export function registerAccountProvider(pi, options) {
  const { id, name, baseUrl, make, sessionHeader = SESSION_HEADER } = options;
  /** 最近一次拿到的凭据（登录、刷新、每次请求解析都会更新）。 */
  let credentials = null;
  let pluginPromise = null;

  const client = {
    auth: {
      /** 插件自己刷新后会调这里：只更新内存里的凭据，落盘由 omp 的 refreshToken 负责。 */
      async set({ body }) {
        credentials = stripType(body);
      },
    },
  };

  const plugin = () => {
    pluginPromise ??= make({ client });
    return pluginPromise;
  };

  /** 当前账号的凭据：先用内存里的，没有就问 omp 的凭据库（新进程里第一次发现要靠它）。 */
  const accountCredentials = async () => {
    if (credentials?.access) return credentials;
    try {
      const storage = await discoverAuthStorage();
      const stored = storage.credentials.getOAuth(id);
      if (!stored) return null;
      credentials = stripType(stored);
      return credentials;
    } catch (error) {
      log(id, "credential lookup failed:", error?.message ?? String(error));
      return null;
    }
  };

  /** 账号自己的模型列表（插件在失败时返回它自己的兜底表，所以空结果一律当失败）。 */
  const listRows = async (account) => {
    const auth = await plugin();
    const map = await auth.provider?.models?.({ models: {} }, { auth: toPluginAuth(account) });
    const all = Object.values(map ?? {});
    const supported = all.filter((model) => supportsChatTransport(model));
    if (supported.length !== all.length)
      log(id, "skipped", all.length - supported.length, "models on a non-chat transport");
    return supported.map((model) => modelRowFromRuntime(model)).filter((row) => row.id !== "");
  };

  const register = (rows) => {
    pi.registerProvider(id, {
      api: `studio-${id}`,
      baseUrl,
      models: rows,
      oauth: {
        name,
        async login(callbacks) {
          const method = pickSignInMethod((await plugin()).auth?.methods);
          if (!method) throw new Error(`${name}: the bundled plugin has no browser sign-in`);
          const flow = await method.authorize({});
          if (flow?.url) callbacks.onAuth({ url: flow.url, instructions: flow.instructions });
          callbacks.onProgress?.(`waiting for ${name} to finish in the browser`);
          const stored = stripType(await raceAbort(flow.callback(), callbacks.signal));
          if (!stored?.access) throw new Error(`${name}: sign-in returned no access token`);
          credentials = stored;
          return stored;
        },
        async refreshToken(current) {
          const auth = await plugin();
          if (!auth.auth?.refresh) return current;
          const next = await auth.auth.refresh(current);
          if (!next) return current;
          const stored = stripType(next);
          credentials = stored;
          return stored;
        },
        getApiKey(current) {
          // omp 每次请求前把最新凭据交到这里；这是唯一可靠的同步点。
          if (current?.access) credentials = stripType(current);
          return credentials?.access ?? "";
        },
      },
      async fetchDynamicModels() {
        const account = await accountCredentials();
        // 拿不到凭据时抛错而不是返回空数组：空列表会被当成"这个 provider 就是没有模型"缓存 24 小时。
        if (!account?.access) throw new Error(`${name}: no signed-in account to list models for`);
        const rows = await listRows(account);
        if (rows.length === 0) throw new Error(`${name}: the account listed no models`);
        writeCachedModels(extensionDir, id, rows);
        log(id, "model list:", rows.length);
        return rows;
      },
      streamSimple(model, context, options) {
        const session = typeof options?.sessionId === "string" ? options.sessionId : "";
        return streamOpenAICompletions({ ...model, api: "openai-completions" }, context, {
          ...options,
          fetch: pluginFetch(plugin, session, sessionHeader, () => credentials),
        });
      },
    });
  };

  /** 用缓存里的列表先注册：冷启动时发现可能还没跑，光等它一个模型都不会有。 */
  register(readCachedModels(extensionDir, id));

  /**
   * 会话起来后用账号自己的列表刷新一次并重新注册。omp 自己的发现走 `online-if-uncached` 和 24 小时缓存，
   * 冷启动时不会替我们拉；这里自己拉，成功才写缓存、才重新注册（失败就继续用缓存）。
   */
  pi.on("session_start", async () => {
    // 一天里拉一次就够；每次任务进程都拉一遍太吵，还会浪费厂商侧的额度。
    if (Date.now() - readCachedAt(extensionDir, id) < CATALOG_TTL_MS) return;
    const account = await accountCredentials();
    if (!account?.access) return;
    try {
      const rows = await listRows(account);
      if (rows.length === 0) return;
      writeCachedModels(extensionDir, id, rows);
      register(rows);
      log(id, "catalog refreshed:", rows.length);
    } catch (error) {
      log(id, "catalog refresh failed:", error?.message ?? String(error));
    }
  });
}

/** omp 的 fetch 出口：把请求交给插件的 loader.fetch（它负责签名、整形、把厂商的 SSE 转成 OpenAI 块）。 */
function pluginFetch(plugin, session, sessionHeader, currentCredentials) {
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input?.url ?? "");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (session) headers.set(sessionHeader, session);
    const auth = await plugin();
    // 交给插件的是 OpenCode 的 oauth 形状（带 type），到期时间往后推（插件不自己刷，刷新只由 omp 发起）。
    const loader = await auth.auth?.loader(async () => toPluginAuth(currentCredentials()));
    if (!loader?.fetch) throw new Error("the bundled plugin returned no fetch");
    return loader.fetch(url, { ...init, headers });
  };
}

/** 登录可以被取消：omp 关掉服务进程 / 用户点取消时 abort，插件自己的轮询在它的 15 分钟上限里自行结束。 */
function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("cancelled"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
