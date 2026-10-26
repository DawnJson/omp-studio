// 把 magpie / OpenCode 形状的 provider 插件接成 omp 的 `pi.registerProvider` 配置。
// 规则和实测见 docs/architecture/client-accounts.md。
//
// 插件的契约（只依赖这几处，升级 vendor 时先看这里）：
//   await make({ client }, {})          → hooks（make 是 `*Plugin` 导出或 `{ id, server }` 的 server）
//   hooks.auth.provider                 → provider id
//   hooks.config(cfg)                   → 写 cfg.provider[id] = { name, npm, api, models }
//   hooks.auth.methods[]                → { type:"oauth"|"api", label, prompts?, authorize(inputs) }
//                                          authorize 返回 { url, instructions, method:"auto"|"code", callback(code?) }
//                                          或直接返回结果（无需登录的 api 方式）
//   hooks.auth.refresh(auth)            → 变了的字段（叠在旧凭据上）
//   hooks.auth.loader(getAuth, provider) → { baseURL, apiKey, headers, fetch(url, init) }；没有 fetch 时自己带 Bearer 发
//   hooks.provider.models(provider, { auth }) → { [key]: runtimeModel }（api.npm 决定传输，api.url 决定地址）
//   hooks["chat.headers"](input, { headers }) → 每次请求要带的头（会话 id 之类）
//   client.auth.set({ body })           → 插件自己续了凭据，要我们存
//
// omp 侧（18.12.6 源码 + 实测）：
//   - `oauth.login` 的 `onAuth` → RPC `open_url`，`onPrompt` → `input`（secret 提示在 RPC 被拒），`onProgress` → `notify`
//   - `getApiKey(credentials)` 在每次请求解析凭据时调用
//   - `streamSimple(model, context, options)` 里 `options.fetch` 是流的唯一出口
//   - 扩展 provider 的模型行只来自静态 `models` 或 `fetchDynamicModels` 的发现结果（2026-10-25 实测）
//   - 扩展的工厂函数可以是 async，omp 会等它（`extensions/loader.ts` 的 `await factory(api)`）
import { getProviderDefinition } from "@oh-my-pi/pi-ai/registry";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import {
  streamAnthropic,
  streamOpenAICompletions,
  streamOpenAIResponses,
} from "@oh-my-pi/pi-ai/providers/register-builtins";
import {
  defaultInputs,
  mergeCredential,
  modelRow,
  normalizeCredential,
  pickSignInMethod,
  pluginFactory,
  pluginUrl,
  toPluginAuth,
} from "./adapter.mjs";
import { CATALOG_TTL_MS, readCachedAt, readCachedModels, writeCachedModels } from "./models-cache.mjs";

const STREAMS = {
  chat: { api: "openai-completions", stream: streamOpenAICompletions },
  messages: { api: "anthropic-messages", stream: streamAnthropic },
  responses: { api: "openai-responses", stream: streamOpenAIResponses },
};

const WIRE_MODELS = new WeakMap();

/**
 * omp 交给 `streamSimple` 的模型是按我们的自定义 api 建的，`compat`（各传输按模型查的兼容开关）不对；
 * 按真正的传输重建一次（和 omp 的 factory-droid 一样用 `buildModel`），每个模型对象缓存一份。
 */
function wireModel(model, transport) {
  let byTransport = WIRE_MODELS.get(model);
  if (!byTransport) WIRE_MODELS.set(model, (byTransport = new Map()));
  let wired = byTransport.get(transport);
  if (!wired) {
    wired = buildModel({ ...model, api: STREAMS[transport].api, compat: model.compatConfig });
    byTransport.set(transport, wired);
  }
  return wired;
}

function log(...parts) {
  try {
    process.stderr.write(`[studio-accounts] ${parts.join(" ")}\n`);
  } catch {}
}

function messageOf(error) {
  return error?.message ?? String(error);
}

/** 扩展自己在磁盘上的目录：模型列表的缓存写在这里（userData 下，不是 ~/.omp）。 */
const extensionDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

/**
 * 注册这些插件模块里所有能用的 provider。
 * @param {object} pi omp 的 ExtensionAPI
 * @param {object[]} modules 插件模块（`import * as`）
 * @param {{ staticModels?: string[] }} [options] `staticModels`：`provider.models` 只是原样返回入参的插件（模型表在 config 里）
 */
export async function registerPluginProviders(pi, modules, { staticModels = [] } = {}) {
  const seen = new Set();
  for (const mod of modules) {
    for (const [exportName, value] of Object.entries(mod)) {
      if (exportName !== "default" && !exportName.endsWith("Plugin")) continue;
      const make = pluginFactory(value);
      if (!make) continue;
      try {
        await registerPlugin(pi, make, { seen, staticModels });
      } catch (error) {
        log(exportName, "not registered:", messageOf(error));
      }
    }
  }
}

async function registerPlugin(pi, make, { seen, staticModels }) {
  /** 当前账号的凭据（存进 omp 的形状，见 adapter 的 normalizeCredential）。 */
  let credentials = null;
  let id = "";
  const client = {
    auth: {
      /** 插件自己续了凭据：叠到当前账号上，并存回 omp 的凭据库（refresh token 多是一次性的）。 */
      async set({ body }) {
        if (!credentials) return;
        credentials = mergeCredential(credentials, body);
        await saveCredential(id, credentials);
      },
    },
  };

  const hooks = await make({ client }, {});
  const pluginId = String(hooks?.auth?.provider ?? "");
  if (!pluginId || seen.has(pluginId)) return;
  seen.add(pluginId);
  // 只能靠打字输入（手机号、域名）或读别的应用登录的 provider 不接；这是预期内的，不记日志。
  const method = pickSignInMethod(hooks.auth.methods);
  if (!method) return;
  // omp 自己已有同名 provider 时（如 `minimax-code` 是 omp 的 MiniMax Coding Plan key）换个 id 注册，不覆盖它；
  // 交给插件的地方（config、chat.headers）仍用插件自己的 id。
  id = getProviderDefinition(pluginId) ? `${pluginId}-account` : pluginId;
  const config = { provider: {} };
  await hooks.config?.(config);
  const provider = config.provider[pluginId] ?? {};
  const name = String(provider.name ?? pluginId);
  const providerUrl = typeof provider.api === "string" ? provider.api : (provider.options?.baseURL ?? "");
  // 有 auth.refresh 的插件由 omp 发起刷新：交给插件时推后到期时间，免得它自己再刷一次。
  const stretch = typeof hooks.auth.refresh === "function";
  const transports = new Map();

  const pluginAuth = () => toPluginAuth(credentials, { stretch });

  let loaderCache = null;
  /** 插件的 loader（按 token 缓存：有的插件在 loader 里记账号信息，每次请求都建一个会重复查）。 */
  const loader = async () => {
    const token = credentials?.access ?? "";
    if (loaderCache?.token !== token) {
      loaderCache = { token, value: await hooks.auth.loader?.(async () => pluginAuth(), provider) };
    }
    return loaderCache.value ?? {};
  };

  /** 当前账号的凭据：先用内存里的，没有就问 omp 的凭据库（新进程里第一次发现要靠它）。 */
  const accountCredentials = async () => {
    if (credentials?.access) return credentials;
    const storage = await discoverAuthStorage();
    const stored = storage.credentials.getOAuth(id);
    if (stored) credentials = normalizeCredential(stored);
    return credentials;
  };

  /** 账号自己的模型列表（插件失败时返回它的兜底表或空表，空的一律当失败）。 */
  const listRows = async () => {
    const auth = pluginAuth();
    const defaults = { npm: provider.npm, baseUrl: (await loader()).baseURL || providerUrl };
    const live = typeof hooks.provider?.models === "function" && !staticModels.includes(pluginId);
    // 不把 config 里的表传进去：插件失败时会原样退回它，那些 id 未必在账号里，挑中会 400。
    const map = live ? await hooks.provider.models({ ...provider, models: {} }, { auth }) : (provider.models ?? {});
    const rows = [];
    let skipped = 0;
    for (const [key, model] of Object.entries(map ?? {})) {
      const row = modelRow(key, model, defaults);
      if (row) rows.push(row);
      else skipped++;
    }
    if (skipped) log(id, "skipped", skipped, "models on a transport omp-studio doesn't serve");
    return rows;
  };

  /** 模型行里的 `transport` 是我们自己的字段：记进表里，交给 omp 的行不带它。 */
  const ompRows = (rows) => {
    transports.clear();
    return rows.map(({ transport, ...row }) => {
      transports.set(row.id, transport);
      return row;
    });
  };

  const fetchVia =
    (model, transport, session) =>
    async (input, init = {}) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input?.url ?? "");
      const url = pluginUrl(raw, transport, model.baseUrl);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (session && hooks["chat.headers"]) {
        const out = { headers: {} };
        const input = {
          sessionID: session,
          model: { providerID: pluginId, id: model.id },
          provider: { info: { id: pluginId } },
        };
        await hooks["chat.headers"](input, out);
        for (const [key, value] of Object.entries(out.headers)) headers.set(key, String(value));
      }
      const served = await loader();
      if (typeof served.fetch === "function") return served.fetch(url, { ...init, headers });
      // 只给 key 不给 fetch 的插件（请求就是普通的 OpenAI / Anthropic 接口）：自己带上它的 key 和头。
      if (!served.apiKey) throw new Error(`${name}: not signed in`);
      for (const [key, value] of Object.entries(served.headers ?? {})) headers.set(key, String(value));
      headers.set("authorization", `Bearer ${served.apiKey}`);
      return fetch(url, { ...init, headers });
    };

  const register = (rows) => {
    pi.registerProvider(id, {
      api: `studio-${id}`,
      baseUrl: providerUrl,
      models: ompRows(rows),
      oauth: {
        name,
        async login(callbacks) {
          const flow = await method.authorize(defaultInputs(method));
          let result = flow;
          if (typeof flow?.callback === "function") {
            if (flow.url) callbacks.onAuth({ url: flow.url, instructions: flow.instructions });
            if (flow.method === "code") {
              const code = await callbacks.onPrompt({ message: flow.instructions ?? `Paste the code ${name} shows` });
              result = await raceAbort(flow.callback(code), callbacks.signal);
            } else {
              callbacks.onProgress?.(`waiting for ${name} to finish in the browser`);
              result = await raceAbort(flow.callback(), callbacks.signal);
            }
          }
          if (result?.type === "failed") throw new Error(`${name}: ${messageOf(result.error ?? "sign-in failed")}`);
          const stored = normalizeCredential(result);
          if (!stored?.access) throw new Error(`${name}: sign-in returned no credential`);
          credentials = stored;
          return stored;
        },
        async refreshToken(current) {
          if (!stretch) return current;
          const base = normalizeCredential(current);
          const next = await hooks.auth.refresh(toPluginAuth(base));
          if (!next) return current;
          if (next.type === "failed") throw new Error(`${name}: ${messageOf(next.error ?? "refresh failed")}`);
          credentials = mergeCredential(base, next);
          return credentials;
        },
        getApiKey(current) {
          // omp 每次请求前把最新凭据交到这里；这是唯一可靠的同步点。
          if (current?.access) credentials = normalizeCredential(current);
          return credentials?.access ?? "";
        },
      },
      async fetchDynamicModels() {
        const account = await accountCredentials();
        // 拿不到凭据时抛错而不是返回空数组：空列表会被当成"这个 provider 就是没有模型"缓存 24 小时。
        if (!account?.access) throw new Error(`${name}: no signed-in account to list models for`);
        const rows = await listRows();
        if (rows.length === 0) throw new Error(`${name}: the account listed no models`);
        writeCachedModels(extensionDir, id, rows);
        log(id, "model list:", rows.length);
        return ompRows(rows);
      },
      streamSimple(model, context, options) {
        const transport = transports.get(model.id) ?? "chat";
        const { stream } = STREAMS[transport];
        const session = typeof options?.sessionId === "string" ? options.sessionId : "";
        return stream(wireModel(model, transport), context, { ...options, fetch: fetchVia(model, transport, session) });
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
    // 一天里拉几次就够；每次任务进程都拉一遍太吵，还会浪费厂商侧的额度。
    if (Date.now() - readCachedAt(extensionDir, id) < CATALOG_TTL_MS) return;
    try {
      const account = await accountCredentials();
      // 过期了不在这里刷：refresh token 多是一次性的，刷新只让 omp 在请求前发起（它有跨进程的锁）。
      if (!account?.access || Number(account.expires) <= Date.now()) return;
      const rows = await listRows();
      if (rows.length === 0) return;
      writeCachedModels(extensionDir, id, rows);
      register(rows);
      log(id, "catalog refreshed:", rows.length);
    } catch (error) {
      log(id, "catalog refresh failed:", messageOf(error));
    }
  });
}

/** 插件自己续的凭据存回 omp 的凭据库（同一账号按身份覆盖，不新增一条）。 */
async function saveCredential(id, credential) {
  try {
    const storage = await discoverAuthStorage();
    await storage.credentials.upsertOAuth(id, { type: "oauth", ...credential });
  } catch (error) {
    log(id, "saving the renewed credential failed:", messageOf(error));
  }
}

/** 登录可以被取消：omp 关掉服务进程 / 用户点取消时 abort，插件自己的轮询在它自己的时限里结束。 */
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
