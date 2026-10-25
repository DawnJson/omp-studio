// 纯映射函数（不碰 omp、不碰网络）：插件给的形状 → omp 的 provider/模型行。
// 单独成文件是为了能被 vitest 直接 import（`shim.mjs` 要 import omp 自己的包，测试环境里没有）。

/** 会话 id 的请求头：插件在它的 fetch 里读，不会发给厂商。 */
export const SESSION_HEADER = "x-magpie-qoder-session";

/**
 * 插件返回 / 保存的凭据带自己的 `type`（"success"），omp 的 `oauth.login` 会写 `{type:"oauth", ...结果}`，
 * 不摘掉就会盖成 `type:"success"` 存进凭据库。
 */
export function stripType(credential) {
  if (!credential || typeof credential !== "object") return null;
  const { type: _type, ...rest } = credential;
  return rest;
}

/**
 * 只挑无提示的浏览器登录：带 prompts 的（PAT）在 RPC 模式走不通（omp 拒绝 secret 提示）；
 * 同一站点有几个无提示方式时认 label 里写 browser 的那个（WorkBuddy 还有"读桌面版登录"的方式，
 * 那是读别的应用的文件，不接）。
 */
export function pickSignInMethod(methods) {
  const quiet = (methods ?? []).filter((method) => method?.type === "oauth" && !(method.prompts?.length ?? 0));
  return quiet.find((method) => /browser/i.test(String(method?.label ?? ""))) ?? quiet[0] ?? null;
}

const FALLBACK_CONTEXT = 128_000;

function clampContext(value) {
  const context = Number(value ?? 0);
  return Number.isFinite(context) && context > 0 ? Math.trunc(context) : FALLBACK_CONTEXT;
}

/** 插件里"走 OpenAI 兼容 chat"的 npm；别的（如 WorkBuddy 的 Claude 模型走 Messages）我们这套不服务。 */
export const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

/**
 * 这一行能不能由我们的 `streamSimple`（openai-completions）发出去。
 * WorkBuddy 的 `claude-*` 走 Anthropic Messages，插件按模型自己的 api.url 决定，这里先不收。
 */
export function supportsChatTransport(model) {
  const npm = model?.api?.npm;
  return !npm || npm === OPENAI_COMPATIBLE_NPM;
}

/** 插件 `provider.models()` 的一行（magpie/OpenCode 形状）→ omp 的模型行。 */
export function modelRowFromRuntime(model, fallbackContext = FALLBACK_CONTEXT) {
  const contextWindow = clampContext(model?.limit?.context ?? fallbackContext);
  const images = Boolean(model?.capabilities?.input?.image ?? model?.capabilities?.attachment);
  const apiUrl = typeof model?.api?.url === "string" && model.api.url !== "" ? model.api.url : null;
  return {
    id: String(model?.id ?? ""),
    name: String(model?.name ?? model?.id ?? ""),
    reasoning: Boolean(model?.capabilities?.reasoning),
    input: images ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(contextWindow, 32768),
    // 每个模型自己的服务地址：WorkBuddy 的 chat 在 <endpoint>/v2，不带它 omp 会打到 <endpoint>/chat/completions（200 但没有可用回答）。
    ...(apiUrl ? { baseUrl: apiUrl } : {}),
  };
}

/** 喂给插件时把到期时间往后推：插件就不自己刷 token（Qoder 的 refresh token 只用一次，只能有一个发起人）。 */
export const STRETCHED_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function stretchExpiry(credential, now = Date.now()) {
  if (!credential || typeof credential !== "object") return credential;
  const expires = Number(credential.expires ?? 0);
  return { ...credential, expires: Math.max(expires, now + STRETCHED_EXPIRY_MS) };
}

/**
 * 交给插件的凭据：必须带 `type: "oauth"`（OpenCode 的形状）。
 * 插件的 `auth.loader(getAuth)` 里第一句就是 `if (auth?.type !== "oauth") return {}`，
 * 少了这个 type 就变成"没有 fetch"，任务里报 `the bundled plugin returned no fetch`。
 * 和 `stripType` 是一对：存进 omp 的凭据库时不带 type，交给插件时补上。
 */
export function toPluginAuth(credential, now = Date.now()) {
  const stretched = stretchExpiry(credential, now);
  return stretched && typeof stretched === "object" ? { ...stretched, type: "oauth" } : stretched;
}
