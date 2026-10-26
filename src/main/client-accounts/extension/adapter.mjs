// 纯映射函数（不碰 omp、不碰网络）：插件给的形状 → omp 的 provider/模型行和凭据。
// 单独成文件是为了能被 vitest 直接 import（`shim.mjs` 要 import omp 自己的包，测试环境里没有）。

/** 插件 export 的是 `makePlugin(site)` 的产物（函数），或 OpenCode v1 的 `{ id, server }`。 */
export function pluginFactory(value) {
  if (typeof value === "function") return value;
  if (value && typeof value === "object" && typeof value.server === "function") return value.server;
  return null;
}

function usableSignIn(method) {
  const prompts = method?.prompts ?? [];
  // select 提示取第一个选项就能走；文字提示（手机号、域名、PAT）omp 的 RPC 登录收不到，不接。
  if (!prompts.every((prompt) => prompt?.type === "select" && prompt.options?.length)) return false;
  if (method?.type === "oauth") return typeof method.authorize === "function";
  // 不需要输入的 api 方式（如 OpenCode Zen 的公共 key）：authorize 直接给结果。
  return method?.type === "api" && typeof method.authorize === "function";
}

/**
 * 选登录方式：只要浏览器 / 设备流这类"打开一个网址等它完成"的；同一插件有几个时认 label 里写
 * browser / 浏览器 的那个（别的往往是"读桌面版登录"，那是读别的应用的文件，不接）。
 */
export function pickSignInMethod(methods) {
  const usable = (methods ?? []).filter(usableSignIn);
  return usable.find((method) => /browser|浏览器/i.test(String(method?.label ?? ""))) ?? usable[0] ?? null;
}

/** select 提示的默认输入：每个取第一个选项。 */
export function defaultInputs(method) {
  return Object.fromEntries((method?.prompts ?? []).map((prompt) => [prompt.key, prompt.options[0]?.value]));
}

/** 插件没给到期时间（key 不过期）时存的到期时间：omp 就不会去刷新它。 */
export const NO_EXPIRY = Date.UTC(2100, 0, 1);

/**
 * 插件给的凭据 → 存进 omp 凭据库的形状。
 * - 摘掉插件自己的 `type`（"success"）：omp 写的是 `{type:"oauth", ...结果}`，不摘会被盖掉。
 * - 只给 key 的（OpenCode 的 api 凭据）记成 `access = key`，并标上 `studioCredential: "api"`，交还插件时还原。
 * - 没有到期时间的记成 `NO_EXPIRY`。
 */
export function normalizeCredential(credential) {
  if (!credential || typeof credential !== "object") return null;
  const { type: _type, ...rest } = credential;
  const api = rest.studioCredential === "api" || (!rest.access && typeof rest.key === "string" && rest.key !== "");
  const out = api ? { ...rest, access: rest.access || rest.key, studioCredential: "api" } : rest;
  const expires = Number(out.expires ?? 0);
  return {
    ...out,
    refresh: typeof out.refresh === "string" ? out.refresh : "",
    expires: expires > 0 ? expires : NO_EXPIRY,
  };
}

/** 刷新结果多半只有变了的字段（access、expires…），要叠在旧凭据上，不然账号 id、设备信息就丢了。 */
export function mergeCredential(current, next) {
  return normalizeCredential({ ...current, ...next });
}

/** 喂给插件时把到期时间往后推：插件就不自己刷 token（refresh token 多是一次性的，只能由 omp 一处发起）。 */
export const STRETCHED_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function stretchExpiry(credential, now = Date.now()) {
  if (!credential || typeof credential !== "object") return credential;
  const expires = Number(credential.expires ?? 0);
  return { ...credential, expires: Math.max(expires, now + STRETCHED_EXPIRY_MS) };
}

/**
 * 交给插件的凭据：OpenCode 的形状。oauth 凭据带 `type: "oauth"`（插件的 loader 第一句就查它，
 * 少了就没有 fetch）；api 凭据还原成 `{type: "api", key, ...}`。
 * `stretch`：插件有 `auth.refresh`（刷新由 omp 发起）时才推后到期时间；没有的让插件自己按到期时间续。
 */
export function toPluginAuth(credential, { stretch = false, now = Date.now() } = {}) {
  if (!credential || typeof credential !== "object") return credential;
  const { studioCredential, ...rest } = credential;
  if (studioCredential === "api") {
    const { access, refresh: _refresh, expires: _expires, ...api } = rest;
    return { ...api, type: "api", key: rest.key ?? access };
  }
  return { ...(stretch ? stretchExpiry(rest, now) : rest), type: "oauth" };
}

/** 插件里每个模型的 npm → omp 的传输。表里没有的（如 `@ai-sdk/google`）不收。 */
export const TRANSPORTS = {
  "@ai-sdk/openai-compatible": "chat",
  "@ai-sdk/anthropic": "messages",
  "@ai-sdk/openai": "responses",
};

const FALLBACK_CONTEXT = 128_000;
const FALLBACK_OUTPUT = 32_768;

function positive(value, fallback) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

/**
 * 插件的一个模型（运行时行或 config 里的表行）→ omp 的模型行，带上 `transport`；传输不支持时返回 null。
 * @param {string} key 模型表里的键（config 表行没有 id）
 * @param {object} model
 * @param {{ npm?: string, baseUrl?: string }} provider 插件 config 里的 provider 默认值
 */
export function modelRow(key, model, provider = {}) {
  const transport = TRANSPORTS[model?.api?.npm ?? model?.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"];
  if (!transport) return null;
  const id = String(model?.id ?? key ?? "");
  if (id === "") return null;
  const contextWindow = positive(model?.limit?.context, FALLBACK_CONTEXT);
  const caps = model?.capabilities ?? {};
  const images = Boolean(
    caps.input?.image ?? caps.attachment ?? model?.modalities?.input?.includes?.("image") ?? model?.attachment,
  );
  const baseUrl = model?.api?.url || provider.baseUrl;
  return {
    id,
    name: String(model?.name ?? id),
    reasoning: Boolean(caps.reasoning ?? model?.reasoning),
    input: images ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(contextWindow, positive(model?.limit?.output, FALLBACK_OUTPUT)),
    // 每个模型自己的服务地址：请求 URL 由它拼（WorkBuddy 的 chat 在 <endpoint>/v2，猜站点根会 200 但没有回答）。
    ...(baseUrl ? { baseUrl } : {}),
    transport,
  };
}

/**
 * omp 的 anthropic 传输请求 `<站点>/v1/messages`（baseUrl 末尾的 `/v1` 它自己会去掉），插件（照 `@ai-sdk/anthropic`）
 * 认的是 `<api.url>/messages`。messages 一律改成后者，保留查询串；别的传输两边拼法一样，原样返回。
 */
export function pluginUrl(url, transport, baseUrl) {
  if (transport !== "messages" || !baseUrl) return url;
  const query = url.indexOf("?");
  return `${baseUrl.replace(/\/+$/, "")}/messages${query >= 0 ? url.slice(query) : ""}`;
}

/** omp 认的额度单位（`@oh-my-pi/pi-ai` 的 `UsageUnit`）；插件给的别的单位记成 unknown。 */
const USAGE_UNITS = new Set(["percent", "tokens", "requests", "credits", "usd", "minutes", "bytes"]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value) => (typeof value === "string" ? value.trim() : "");

/** 插件的时间：ISO 串或时间戳（照 magpie 的 host.js，小于 1e11 的数是秒）→ 毫秒；读不出来是 undefined。 */
function usageTime(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const ms = finite(value) ? (value < 1e11 ? value * 1000 : value) : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * 插件的 `resets`（`{ count, until?, each?: [{ until?, window? }] }`，攒下的、随时能用的额度重置）→ omp 的 `resetCredits`。
 * 一次重置一条明细，带到期时间和窗口名；没有逐条明细时用 `until`（最近到期）记一条。没有可用的重置时返回 undefined。
 */
function resetCreditsOf(resets) {
  if (!resets || typeof resets !== "object") return undefined;
  const count = finite(resets.count) ? Math.max(0, Math.trunc(resets.count)) : 0;
  if (count === 0) return undefined;
  const expiry = (value) => {
    const at = usageTime(value);
    return at !== undefined ? { expiresAt: new Date(at).toISOString() } : {};
  };
  const each = Array.isArray(resets.each) ? resets.each.filter((reset) => reset && typeof reset === "object") : [];
  const credits =
    each.length > 0
      ? each.map((reset) => ({
          ...(text(reset.window) ? { title: text(reset.window) } : {}),
          remainingCount: 1,
          usable: true,
          ...expiry(reset.until),
        }))
      : usageTime(resets.until) !== undefined
        ? [{ remainingCount: count, usable: true, ...expiry(resets.until) }]
        : [];
  return { availableCount: count, redeemableCount: count, ...(credits.length > 0 ? { credits } : {}) };
}

/**
 * 插件 `auth.usage(getAuth, provider)` 的结果 → omp 的 `UsageReport`（`@oh-my-pi/pi-ai` 的 `usage.ts`）。
 * 插件的契约是 magpie 的（`internal/plugin/host.js` 的 `usageOf`）：`{ plan?, user?, until?（套餐到期）, renew?（"auto" | "off"）,
 * balance?（余额，一段文字）, resets?（见 resetCreditsOf）, error?, windows: [{ name, used?（已用百分比 0-100，缺了是"没说"不是 0）,
 * resetsAt?, resetSecs?, span?（秒）, display?, amount?, limit?, unit?, aside?（用完也不挡账号） }] }`。
 * 套餐到期、自动续费 omp 没有对应字段，放进 `metadata.planEndsAt`（毫秒）/ `metadata.autoRenew`，studio 的用量对话框读它们。
 * 插件报错时抛出（omp 把这个账号列进"取不到用量"）；套餐、窗口、余额、重置都没有时返回 null。
 */
export function usageReport(provider, result, now = Date.now()) {
  if (!result || typeof result !== "object") throw new Error(`${provider}: the plugin returned no usage`);
  if (text(result.error)) throw new Error(text(result.error));
  const limits = [];
  const ids = new Set();
  const windows = Array.isArray(result.windows) ? result.windows : [];
  windows.forEach((window, index) => {
    if (!window || typeof window !== "object") return;
    const label = text(window.name) || text(window.display) || `#${index + 1}`;
    const id = ids.has(label) ? `${label}#${index + 1}` : label;
    ids.add(id);
    const percent = finite(window.used) ? Math.max(0, window.used) : null;
    const limit = finite(window.limit) && window.limit > 0 ? window.limit : null;
    const used = finite(window.amount) ? Math.max(0, window.amount) : null;
    let amount;
    if (limit !== null && used !== null) {
      amount = {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        usedFraction: percent !== null ? percent / 100 : used / limit,
        unit: USAGE_UNITS.has(window.unit) ? window.unit : "unknown",
      };
    } else if (percent !== null) {
      amount = { used: percent, limit: 100, usedFraction: percent / 100, unit: "percent" };
    } else {
      amount = { unit: "unknown" };
    }
    const resetsAt =
      usageTime(window.resetsAt) ??
      (finite(window.resetSecs) && window.resetSecs > 0 ? now + window.resetSecs * 1000 : undefined);
    const durationMs = finite(window.span) && window.span > 0 ? window.span * 1000 : undefined;
    const fraction = amount.usedFraction;
    limits.push({
      id,
      label,
      scope: { provider },
      ...(resetsAt !== undefined || durationMs !== undefined
        ? {
            window: {
              id,
              label,
              ...(durationMs !== undefined ? { durationMs } : {}),
              ...(resetsAt !== undefined ? { resetsAt } : {}),
            },
          }
        : {}),
      amount,
      // aside 的窗口用完了账号照样能用（附带的小额度、领取提示之类）：不标成用完。
      status:
        fraction === undefined
          ? "unknown"
          : fraction >= 1 && window.aside !== true
            ? "exhausted"
            : fraction >= 0.9
              ? "warning"
              : "ok",
      // 只有一段文字、没有数的窗口（有的插件只给 display）：文字放进说明，不然什么都看不到。
      ...(fraction === undefined && text(window.display) ? { notes: [text(window.display)] } : {}),
    });
  });
  const plan = text(result.plan);
  // 按量付费的账号（MiniMax、AutoClaw、Raccoon…）只有余额没有窗口：余额放进报告的说明，对话框里账号下面一行字。
  const balance = finite(result.balance) ? String(result.balance) : text(result.balance);
  const resetCredits = resetCreditsOf(result.resets);
  if (limits.length === 0 && !plan && !balance && !resetCredits) return null;
  const user = text(result.user);
  const metadata = {
    ...(plan ? { planType: plan } : {}),
    ...(usageTime(result.until) !== undefined ? { planEndsAt: usageTime(result.until) } : {}),
    ...(result.renew === "auto" || result.renew === "off" ? { autoRenew: result.renew === "auto" } : {}),
    // omp 和 studio 都拿 email 认账号；插件给的不是邮箱（多是昵称）时另放，不冒充邮箱。
    ...(user ? (user.includes("@") ? { email: user } : { user }) : {}),
  };
  return {
    provider,
    fetchedAt: now,
    limits,
    ...(resetCredits ? { resetCredits } : {}),
    ...(balance ? { notes: [`Balance: ${balance}`] } : {}),
    metadata,
  };
}
