// OpenCode provider plugins for WorkBuddy's plans, Tencent's two builds of
// WorkBuddy (CodeBuddy's desktop agent):
//   - workbuddy:    the China build, copilot.tencent.com
//   - workbuddy-ai: the international build, www.workbuddy.ai
// A WorkBuddy account signs in in the browser (Tencent's page, polled for
// the token as WorkBuddy's desktop app does) or is taken from WorkBuddy
// desktop's own sign-in. Its chats are chat completions at <endpoint>/v2,
// streamed only, with WorkBuddy's headers: a request whose User-Agent isn't
// WorkBuddy/<version> is refused (error 10085). Each build's headers are
// those of its current desktop app (see SITES' app, cli and appName).

import { createHash, randomBytes } from "node:crypto"
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { gzipSync } from "node:zlib"

const APP_VERSION = "2.0.0" // the version WorkBuddy's sign-in page is opened with
const POLL_MS = 1000
const SIGN_IN_MS = 5 * 60 * 1000
const EARLY_MS = 60 * 1000 // a token this close to its end is refreshed before a request
const LEAD_MS = 5 * 60 * 1000 // and this close, magpie renews it ahead of time (auth.refresh)
const KEEP_RENEWED_MS = 60 * 1000 // how long a refresh's result answers for the old refresh token

// [id, name, context, efforts]
const CN_MODELS = [
  ["auto", "Auto", 168000],
  ["hy4-preview-f", "Hy4 preview", 1000000, ["high"]],
  ["hy3", "Hy3", 192000, ["low", "high"]],
  ["hy3-x", "Hy3-X", 192000, ["low", "high"]],
  ["deepseek-v4.1-flash", "Deepseek-V4.1-Flash", 1000000],
  ["glm-5.3", "GLM-5.3", 1000000, ["low", "high", "max"]],
  ["glm-5.3-flash", "GLM-5.3-Flash", 1000000, ["low", "high", "max"]],
  ["glm-5.2", "GLM-5.2", 1000000, ["high", "xhigh"]],
  ["glm-5.1", "GLM-5.1", 200000],
  ["glm-5v-turbo", "GLM-5v-Turbo", 200000],
  ["minimax-m3", "MiniMax-M3", 512000],
  ["kimi-k3-1", "Kimi-K3", 1000000, ["low", "high", "xhigh"]],
  ["kimi-k2.7", "Kimi-K2.7-Code", 256000],
  ["kimi-k2.6", "Kimi-K2.6", 256000],
  ["deepseek-v4-pro", "Deepseek-V4-Pro", 1000000, ["none", "high", "xhigh"]],
]

const AI_MODELS = [
  ["default-model", "Default", 176000],
  ["fast-model", "Fast", 200000],
  ["balanced-model", "Balanced", 256000],
  ["primary-model", "Primary", 272000],
  ["deep-model", "Deep", 176000],
  ["gpt-5.5", "GPT-5.5", 1000000],
  ["gpt-5.4", "GPT-5.4", 272000],
  ["gpt-5.3-codex", "GPT-5.3-Codex", 272000],
  ["gemini-3.1-pro", "Gemini-3.1-Pro", 400000],
  ["gemini-3.5-flash", "Gemini-3.5-Flash", 1000000],
  ["glm-5.3", "GLM-5.3", 1000000, ["low", "high", "max"]],
  ["glm-5.2", "GLM-5.2", 1000000, ["high", "xhigh"]],
  ["hy3", "Hy3", 192000, ["low", "high"]],
  ["kimi-k3", "Kimi-K3", 1000000],
  ["kimi-k2.6", "Kimi-K2.6", 256000],
  ["minimax-m3", "MiniMax-M3", 512000],
]

const SITES = {
  workbuddy: {
    id: "workbuddy",
    name: "WorkBuddy",
    endpoint: "https://copilot.tencent.com",
    authID: "workbuddy-desktop",
    platform: "workbuddy",
    ai: false,
    // the desktop app the requests are WorkBuddy's own client's of: its
    // version, its bundled CLI's (@genie/agent-cli), and the CLI's
    // product.json applicationName. Read from WorkBuddy 5.9.3.42398134,
    // the update feed's current build on 2026-10-28.
    app: "5.9.3",
    cli: "2.165.0",
    appName: "WorkBuddy",
    // 5.9's CLI says on each chat where the agent runs; the desktop's own
    // is "local-agent" (X-Agent-Runtime, absent in 5.8)
    runtime: "local-agent",
    // where this build's API keys are made (see keyAccount)
    keys: "https://www.workbuddy.cn/profile/keys",
    models: CN_MODELS,
    // it serves the Claude models on Anthropic's Messages API too (see
    // nativeOf)
    messages: true,
  },
  "workbuddy-ai": {
    id: "workbuddy-ai",
    name: "WorkBuddy AI",
    endpoint: "https://www.workbuddy.ai",
    authID: "workbuddy-desktop-ai",
    platform: "workbuddy-ai",
    ai: true,
    // WorkBuddy AI 5.9.3.42398134, its update feed's current build on
    // 2026-10-29 (see the China build's): the same CLI as the China
    // build's 5.9.3, byte for byte but for product.json, and the same
    // Electron (37.10.3); its desktop puts agentRuntime local-agent in the
    // prompt meta as the China build's does
    app: "5.9.3",
    cli: "2.165.0",
    appName: "workbuddy-ai",
    runtime: "local-agent",
    keys: "https://www.workbuddy.ai/profile/keys",
    models: AI_MODELS,
    // models whose images WorkBuddy AI drops though its config says they
    // take them (see textOnly)
    noImages: /^glm-/,
  },
}

// textOnly says whether site drops the images sent to model, whatever its
// config says. On 2026-10-13, with a real WorkBuddy AI account (Yirasumi on
// Discord), www.workbuddy.ai's /v3/config marked every model
// supportsImages: true, but a chat to glm-5.3-flash, glm-5.3 or glm-5.2
// came back saying "[System reminder: the current model does not support
// images. Content filtered. ...]": the server had taken the image out.
// Its other models (deepseek-v4.1-flash, kimi, gemini, grok, gpt) read
// them, and WorkBuddy (China)'s glm-5.3-flash does too, so this is WorkBuddy
// AI's GLM models alone. Said text-only, magpie's image-describing model
// reads the image for them; a user who said the model takes images keeps
// their own answer (magpie's settings, over what this list says).
function textOnly(site, model) {
  return !!site.noImages?.test(model)
}

const NPM = "@ai-sdk/openai-compatible"
const hex = () => randomBytes(16).toString("hex")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = (site) => site.endpoint + "/v2"

// MESSAGES is the API SDK package for Anthropic's Messages shape, which
// WorkBuddy serves the Claude models on, beside its chat completions:
// <endpoint>/v1/messages. Those models are Anthropic's own, and their
// thinking is asked for the way Anthropic asks it (thinking.type adaptive
// with output_config.effort), which the chat endpoint has no field for: a
// chat carries reasoning_effort alone, and WorkBuddy's chat endpoint gives
// the same answer at every level, so an agent that picked max got no more
// than one that picked low. See nativeOf.
const NPM_MESSAGES = "@ai-sdk/anthropic"
const apiMessages = (site) => site.endpoint + "/v1"

// nativeOf is whether site serves model on Messages rather than chat: a
// Claude model, on a site that serves Messages at all (site.messages).
// Measured 2026-10-24 on WorkBuddy's China build, each model of
// /v3/config's cli agent asked on /v1/messages: claude-opus-5.5,
// claude-sonnet-5.5, claude-opus-5 and claude-opus-4.8-1m answered in
// Anthropic's stream; glm-5.3 and deepseek-v4.1-flash answered 500, gpt-5.5
// and kimi-k3-1 400. An account may still be refused a Claude model it has
// no entitlement for (11158), which is the account's, not the endpoint's.
// WorkBuddy AI (www.workbuddy.ai) has no such route: /v1/messages,
// /v2/messages and /v1/messages?beta=true are all "404 Route Not Found"
// there, whatever the model, so its models stay on chat, a Claude one too
// should it list one.
function nativeOf(site, model) {
  return site?.messages === true && /^claude-/i.test(String(model ?? ""))
}

// ---- WorkBuddy's API ------------------------------------------------------

class WBError extends Error {
  constructor(message, code, status, said) {
    super(message)
    this.code = code
    this.status = status
    this.said = said // as magpie's built-in (wbCall) worded it
  }
}

// call makes a request of WorkBuddy's plugin API, which answers
// {code, msg, data}; a code but 0 is an error.
async function call(site, method, path, headers = {}, body) {
  const res = await fetch(site.endpoint + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "WorkBuddy/" + site.app,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let env = {}
  try {
    env = JSON.parse(text)
  } catch {}
  const code = Number.parseInt(env.code, 10) || 0
  if (!res.ok) {
    const why = env.msg || env.message || env.error?.message || text.slice(0, 200) || res.statusText
    const said = code ? env.msg || `error ${code}` : env.msg || statusText(res.status)
    throw new WBError(`${site.name}: ${why} (HTTP ${res.status}${env.code ? ", code " + env.code : ""})`, env.code, res.status, said)
  }
  if (env.code) throw new WBError(`${site.name}: ${env.msg || "error"} (${env.code})`, env.code, res.status, env.msg || `error ${code}`)
  return env.data
}

function domainOf(site, a) {
  return a.domain || new URL(api(site)).host
}

// merge takes a token WorkBuddy gave (sign-in or refresh) into the
// stored sign-in, times given as at-ms or in-seconds.
function merge(a, got) {
  const now = Date.now()
  const out = { ...a, access: got.accessToken }
  if (got.refreshToken) out.refresh = got.refreshToken
  if (got.domain) out.domain = got.domain
  if (got.tokenType) out.tokenType = got.tokenType
  if (got.expiresAt > 0) out.expires = got.expiresAt
  else if (got.expiresIn > 0) out.expires = now + got.expiresIn * 1000
  if (got.refreshExpiresAt > 0) out.refreshExpiresAt = got.refreshExpiresAt
  else if (got.refreshExpiresIn > 0) out.refreshExpiresAt = now + got.refreshExpiresIn * 1000
  return out
}

function stale(a) {
  return !!a.expires && Date.now() >= a.expires - EARLY_MS
}

// renewing is each refresh under way, by site and the refresh token it
// spends; renewed is what each gave, kept a minute so one that read the
// old refresh token after it was spent (magpie's auth.refresh, a request)
// takes that rather than spending it again.
const renewing = new Map()
const renewed = new Map()

function refreshable(a) {
  return !!a.refresh && !(a.refreshExpiresAt && Date.now() >= a.refreshExpiresAt)
}

// renew spends a's refresh token, once: those who come while it runs, or
// within KEEP_RENEWED_MS of it, get what it gave. save keeps the result.
function renew(site, a, save) {
  const key = site.id + "\n" + a.refresh
  const done = renewed.get(key)
  if (done && Date.now() - done.at < KEEP_RENEWED_MS) return Promise.resolve(merged(a, done.next))
  let r = renewing.get(key)
  if (!r) {
    r = (async () => {
      const got = await call(site, "POST", "/v2/plugin/auth/token/refresh", {
        "X-Refresh-Token": a.refresh,
        "X-Auth-Refresh-Source": "plugin",
        "X-Domain": domainOf(site, a),
        ...enterpriseHeaders(a),
      }, {})
      if (!got?.accessToken) throw Object.assign(new Error("WorkBuddy gave no refreshed token"), { bare: true })
      const next = merge(a, got)
      renewed.set(key, { next, at: Date.now() })
      await save?.(next)
      return next
    })().finally(() => renewing.delete(key))
    renewing.set(key, r)
  }
  return r.then((next) => merged(a, next))
}

// merged is a with the tokens another's refresh gave over it.
function merged(a, next) {
  const out = { ...a }
  for (const k of TOKEN_FIELDS) if (k in next) out[k] = next[k]
  return out
}
const TOKEN_FIELDS = ["access", "refresh", "expires", "refreshExpiresAt", "domain", "tokenType"]

// fresh is the sign-in with an access token that isn't about to end:
// refreshed (and saved) when it is. A refresh that fails, or a refresh
// token that has ended, leaves the access token there is. Its failures
// are worded as the built-in's (wbFresh), "WorkBuddy" on both sites.
async function fresh(site, client, a) {
  if (!stale(a)) return a
  if (!refreshable(a)) {
    if (a.access) return a
    throw new Error("this WorkBuddy account is signed out; sign in again")
  }
  try {
    return await renew(site, a, async (next) => {
      try {
        await client?.auth?.set?.({ path: { id: site.id }, body: next })
      } catch {}
    })
  } catch (e) {
    if (a.access) return a
    if (e?.bare) throw e
    throw new Error(`WorkBuddy token refresh: ${e?.said ?? e?.message ?? e}`)
  }
}

// refreshed is what magpie's auth.refresh gives for a browser sign-in:
// the fields a refresh changed, nothing when there's nothing to renew.
// magpie saves them itself.
async function refreshed(site, auth) {
  if (auth?.type !== "oauth" || auth.source === "desktop" || !auth.access || !auth.refresh) return undefined
  // a refresh token that has ended is said plainly, never as signIn
  // "expired": the built-in never marked a WorkBuddy account
  if (!refreshable(auth)) throw new Error("this WorkBuddy account is signed out; sign in again")
  let next
  try {
    next = await renew(site, auth)
  } catch (e) {
    if (e?.bare) throw e
    throw new Error(`WorkBuddy token refresh: ${e?.said ?? e?.message ?? e}`)
  }
  const out = {}
  for (const k of TOKEN_FIELDS) if (k in next && next[k] !== auth[k]) out[k] = next[k]
  return Object.keys(out).length ? out : undefined
}

// sign sets on headers what WorkBuddy's desktop app sends with a chat: the
// account's own, the client's, and the attribution WorkBuddy's usage list
// shows as the client that asked (使用端). The chat's ids — the
// conversation's, the turn's, the message's — are attend's below.
//
// WorkBuddy's own client sends the whole of this on both builds
// (application-manifest.js: X-Agent-Purpose "conversation", X-IDE-Name/Type
// "WorkBuddy", X-IDE-Version, X-Product "SaaS"); a chat without them is
// counted under no client at all, which is the empty 使用端 a request shows
// when only some of the group is there. The gate below used to give the China
// build none of the client's headers, so every China-build request was
// attribution-less.
function sign(site, a, headers) {
  headers.set("Authorization", "Bearer " + a.access)
  headers.set("X-User-Id", a.uid ?? "")
  if (a.source === "key") {
    // the key's own header, and no X-Domain: a key's session has none
    headers.set("X-API-Key", a.key)
    headers.delete("X-Domain")
  } else {
    headers.delete("X-API-Key")
    headers.set("X-Domain", domainOf(site, a))
  }
  headers.set("X-Product", "SaaS")
  headers.set("X-IDE-Type", "WorkBuddy")
  headers.set("User-Agent", cliAgent(site))
  headers.set("X-Requested-With", "XMLHttpRequest")
  headers.set("X-Agent-Intent", "craft")
  headers.set("X-Agent-Purpose", "conversation")
  headers.set("X-IDE-Name", "WorkBuddy")
  headers.set("X-IDE-Version", site.app)
  for (const [k, v] of Object.entries(enterpriseHeaders(a))) headers.set(k, v)
}

// cliAgent is the User-Agent WorkBuddy's desktop CLI sends its API calls
// (a chat, the product config) with: UserAgentHttpInterceptor's
// buildUserAgent puts the platform (CLIENT_INFO_PLATFORM "WorkBuddy", at
// the app's version) first, then the CLI's applicationName at the same
// version, then CLIENT_INFO_USER_AGENT_EXTENSION, "CLI/<its version>".
function cliAgent(site) {
  return `WorkBuddy/${site.app} ${site.appName}/${site.app} CLI/${site.cli}`
}

// OPENAI_SDK and NODE are what the CLI's chats go out through: the OpenAI
// SDK it bundles (openai 6.25.0) and the Node its Electron runs it on
// (Electron 37.10.3, ELECTRON_RUN_AS_NODE).
const OPENAI_SDK = "6.25.0"
const NODE = "v22.21.1"
const SDK_OS = { darwin: "MacOS", win32: "Windows", linux: "Linux", freebsd: "FreeBSD", openbsd: "OpenBSD", android: "Android" }
const SDK_ARCH = { x64: "x64", arm64: "arm64", arm: "arm", ia32: "x32", x32: "x32" }

// chatHeaders sets on a chat what WorkBuddy's CLI adds to its model
// requests alone (axiosToFetchAdapter, both builds): the agent type
// (resolveModelCallAgentType, "main" for the conversation's own agent),
// the runtime where a build sends one, and the OpenAI SDK's own headers,
// which the CLI's fetch passes on. Its client has a 1200s timeout and
// no retries of its own.
function chatHeaders(site, headers) {
  headers.set("X-Agent-Type", "main")
  if (site.runtime) headers.set("X-Agent-Runtime", site.runtime)
  else headers.delete("X-Agent-Runtime")
  headers.set("Accept", "application/json")
  headers.set("X-Stainless-Retry-Count", "0")
  headers.set("X-Stainless-Timeout", "1200")
  headers.set("X-Stainless-Lang", "js")
  headers.set("X-Stainless-Package-Version", OPENAI_SDK)
  headers.set("X-Stainless-OS", SDK_OS[process.platform] ?? (process.platform ? `Other:${process.platform}` : "Unknown"))
  headers.set("X-Stainless-Arch", SDK_ARCH[process.arch] ?? (process.arch ? `other:${process.arch}` : "unknown"))
  headers.set("X-Stainless-Runtime", "node")
  headers.set("X-Stainless-Runtime-Version", NODE)
}

// keyAccount is the account an API key (OpenCode's {type: "api", key}) is
// sent as, the way WorkBuddy's own CLI sends one (@tencent-ai/codebuddy-code
// 2.177.0, CODEBUDDY_API_KEY): its API-key sign-in is a session whose access
// token is the key and whose uid is "anonymous_" and the key's last eight
// characters (ACC_USER_ID unset), personal, with no domain and no
// enterprise; and its model requests carry the key twice, X-API-Key and
// Authorization: Bearer (getCustomHeaders). Its requests go to the build's
// own host, the one its other sign-ins use: for the China build that is
// copilot.tencent.com, the CLI's own endpoint for that build
// (CODEBUDDY_INTERNET_ENVIRONMENT=internal, product.internal.json), and the
// same API as www.workbuddy.cn, where the keys are made (the CLI's
// CN_SAAS_CORE_API_FRONT_DOORS); for the international build,
// www.workbuddy.ai (the CLI's own default, www.codebuddy.ai, is CodeBuddy's,
// not WorkBuddy's). Nothing renews a key.
function keyAccount(auth) {
  const key = typeof auth?.key === "string" ? auth.key.trim() : ""
  if (!key) return null
  return { key, access: key, uid: "anonymous_" + key.slice(-8), source: "key" }
}

// remoteConfig says whether WorkBuddy's own CLI asks /v3/config for the
// account's models with this key: only for keys that start ck_ or pt_
// (shouldLoadRemoteConfig); any other key keeps the built-in list.
const remoteConfig = (key) => /^(ck_|pt_)/.test(key)

// enterpriseHeaders names the enterprise (team) an account signed in as, as
// WorkBuddy's own client does on every request it makes for that account
// (its auth interceptor: X-Enterprise-Id and X-Tenant-Id, both the
// account's enterpriseId). Without them WorkBuddy answers as the personal
// account: /v3/config lists the personal plan's models and not the
// enterprise's (#75). A personal account has none and sends none.
function enterpriseHeaders(a) {
  const id = typeof a?.enterpriseId === "string" ? a.enterpriseId.trim() : ""
  return id ? { "X-Enterprise-Id": id, "X-Tenant-Id": id } : {}
}

// enterpriseOf is the enterprise the account a sign-in gave belongs to,
// { id, name }: the one /login/account names, else, for an account that
// isn't personal, the one WorkBuddy's account list has for it — the same
// choice WorkBuddy's own client makes (mergeCurrentAccountDetails): the
// uid's only entry of that type, or the only one it last signed in to. None
// found is personal ({ id: "" }).
//
// Which account that is was chosen on WorkBuddy's sign-in page: after a
// phone sign-in it lists the person's accounts (personal, a team,
// 「WorkBuddy 教育公益版」…) and binds the one picked to the sign-in's state
// (POST /console/login/enterprise/<id>?state=…), so the token and
// /login/account this plugin reads by that state are the chosen account's.
async function enterpriseOf(site, a, who) {
  const name = (x) => (typeof x?.enterpriseName === "string" ? x.enterpriseName.trim() : "")
  const own = typeof who?.enterpriseId === "string" ? who.enterpriseId.trim() : ""
  const type = String(who?.type ?? "").trim().toLowerCase()
  if (!own && (!type || type === "personal")) return { id: "", name: "" }
  // a name /login/account leaves out is the account list's, as the
  // client merges the two
  if (own && name(who)) return { id: own, name: name(who) }
  let list
  try {
    list = await call(site, "GET", "/v2/plugin/accounts", {
      Authorization: "Bearer " + a.access,
      "X-Domain": domainOf(site, a),
    })
  } catch {
    return { id: own, name: "" }
  }
  const mine = (list?.accounts ?? []).filter((x) => x?.uid === who.uid && typeof x.enterpriseId === "string" && x.enterpriseId.trim())
  if (own) return { id: own, name: name(mine.find((x) => x.enterpriseId.trim() === own)) }
  const same = mine.filter((x) => String(x.type ?? "").trim().toLowerCase() === type)
  const last = mine.filter((x) => x.lastLogin)
  const pick = same.length === 1 ? same[0] : last.length === 1 ? last[0] : mine.length === 1 ? mine[0] : undefined
  return pick ? { id: pick.enterpriseId.trim(), name: name(pick) } : { id: "", name: "" }
}

// accountName is what magpie lists an account a sign-in gave as: the
// person's name, and for an enterprise (team, education) account the
// enterprise's too. One person's personal account and their enterprise one
// share the uid and the nickname, and magpie's plugin host keeps one
// account per name and uid (settle in host.js): named alike, signing in to
// 「WorkBuddy 教育公益版」 took the place of the same person's personal
// account, and the two could never be in one pool. An enterprise WorkBuddy
// names no name for is told by the end of its id.
function accountName(who, ent) {
  const person = who?.nickname || who?.phoneNumber || who?.uid || ""
  if (!ent?.id) return person
  const team = ent.name || `enterprise ${ent.id.slice(-6)}`
  return person ? `${person} · ${team}` : team
}

// WorkBuddy's own client names each chat to its gateway four ways: the
// conversation it belongs to, the user send (turn) it answers, the message
// itself, and the request that carried it. Its backend counts a user send as
// one request by X-Conversation-Request-ID: a chat carrying a new one every
// time is counted on its own, so one send that takes several steps — a tool
// call answered and sent again, a retry — shows up
// in the usage detail as many requests. The ids below are made from what
// names the conversation and the turn, so every step of one send carries the
// same turn id and the user's next message carries another, as WorkBuddy's
// own client does.

// SESSION carries the conversation magpie (or OpenCode) names a request by,
// from the chat.headers hook to the loader's fetch. It goes no further.
const SESSION = "x-magpie-workbuddy-session"

// SALT is what the ids are derived with, so an id says nothing of the words
// it was made from. New in each process, as WorkBuddy's own ids are one
// conversation's own within a run.
const SALT = randomBytes(16).toString("hex")

// idFor is the 32 hex digits WorkBuddy's own ids are made of, made of a
// name of the thing the id is for (a turn, a conversation) and what names it.
// key is a string, or the pieces it is made of: the digest is the same
// either way, and a key made of a 45 MiB message is never joined into one
// string to be hashed (plugins#461). Each piece goes to the hash whole:
// Bun reads a one-byte string's bytes in place, where a piece cut into
// slices was measured costing a copy of each slice.
function idFor(kind, key) {
  const h = createHash("sha256").update(`${SALT}|${kind}|`)
  // a surrogate pair's first half ending one piece waits for the next, as
  // the joined key would hold the pair together
  let held = ""
  for (let piece of typeof key === "string" ? [key] : key) {
    if (held) piece = held + piece
    held = ""
    const c = piece.charCodeAt(piece.length - 1)
    if (c >= 0xd800 && c <= 0xdbff) {
      held = piece.slice(-1)
      piece = piece.slice(0, -1)
    }
    h.update(piece)
  }
  if (held) h.update(held)
  return h.digest("hex").slice(0, 32)
}

// signatureOf is a message content's signature: its text, and a digest of
// every part that isn't text (an image, a file), so a turn of images alone is
// a turn of its own too. A tool result's part — carried in a user message by
// clients of Anthropic's shape — is left out: it is not what the user said,
// and it changes with every step of the send.
function signatureOf(content) {
  return signatureParts(content).join("")
}

// signatureParts is signatureOf in the pieces it is joined from, none empty
function signatureParts(content) {
  if (typeof content === "string") return content ? [content] : []
  if (!Array.isArray(content)) return []
  const out = []
  for (const part of content) {
    const type = part?.type ?? ""
    if (type === "" || type === "text") {
      if (typeof part?.text === "string" && part.text) out.push(part.text)
    } else if (type !== "tool_result" && type !== "tool-result") {
      out.push(`[${type}:${createHash("sha256").update(JSON.stringify(part)).digest("hex").slice(0, 8)}]`)
    }
  }
  return out
}

// answeredBefore is whether msgs[i] answers the message before it — a tool's
// result, or an assistant's calls — rather than carrying the user's own
// words. A client that sends a tool result's images in a user message (pi's
// "Attached image(s) from tool result:") puts that message right after the
// result, and a turn keyed on it would be a turn of its own on every step.
//
// Anthropic's Messages shape says the same another way: a tool's result is a
// tool_result block in a user message, after an assistant message of
// tool_use blocks. Such a user message answers too, whatever text sits
// beside the results (Claude Code puts a reminder there, a user's words typed
// mid-task go there as well), and so does one right after it, as a chat's
// does after role "tool". Messages that are neither the user's nor the
// assistant's (Claude Code's role "system" ones, which carry a turn's
// effort, its environment and its token count between the steps) stand
// between them without changing which message answers.
function answeredBefore(msgs, i) {
  if (hasBlock(msgs[i], "tool_result")) return true
  let j = i - 1
  while (j >= 0 && msgs[j]?.role === "system") j--
  const prev = msgs[j]
  if (prev === null || typeof prev !== "object") return false
  if (prev.role === "tool") return true
  if (prev.role === "user" && hasBlock(prev, "tool_result")) return true
  if (prev.role !== "assistant") return false
  if (Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0) return true
  return hasBlock(prev, "tool_use")
}

// hasBlock is whether message m's content holds a block of type.
function hasBlock(m, type) {
  return Array.isArray(m?.content) && m.content.some((p) => p?.type === type)
}

// turnKey names the user send a chat answers: the body's last user message
// that is the user's own, by its place and its signature. Every step of one
// send repeats it; the user's next message changes it. "" for a chat whose
// last such message has nothing signable in it (an empty message) or which
// has none at all: the caller then makes a fresh id for that request, as
// before these were derived at all.
function turnKey(chat) {
  return turnParts(chat).join("")
}

// turnParts is turnKey in pieces (idFor takes them): [] for ""
function turnParts(chat) {
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role !== "user" || answeredBefore(msgs, i)) continue
    const sig = signatureParts(msgs[i].content)
    return sig.length ? [`u${i}:`, ...sig] : []
  }
  return []
}

// conversationKey names the conversation a chat belongs to: the session
// magpie or OpenCode names (its chat.headers hook), else the chat's first
// user message, which every later turn of it repeats. "" when neither names
// one — a body that isn't a chat, or one with no user message in it — and no
// conversation id is sent then: a made-up one would be a conversation of the
// request's own, which is what fragments the usage detail in the first place.
function conversationKey(chat, session) {
  return conversationParts(chat, session).join("")
}

// conversationParts is conversationKey in pieces (idFor takes them): [] for ""
function conversationParts(chat, session) {
  if (session) return [`session:${session}`]
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  for (const m of msgs) {
    if (m?.role !== "user") continue
    const sig = signatureParts(m.content)
    if (sig.length) return ["first:", ...sig]
  }
  return []
}

// isMessages says whether a request is an Anthropic Messages one, which
// site serves the Claude models natively: its URL ends at /messages or at
// the counting endpoint beside it (/v1/messages/count_tokens, which the
// chat route's rewrites would otherwise turn into a chat), or (a body is
// all there is to go on) its system is Anthropic's blocks rather than a
// chat's string, and its tools carry input_schema where a chat's carry a
// function's parameters. A chat's own tools can look either way, so the URL
// decides when there is one.
function isMessages(url, body) {
  const path = (() => {
    try {
      return new URL(String(url ?? "")).pathname
    } catch {
      return ""
    }
  })()
  if (path) return /\/messages(\/count_tokens)?$/.test(path)
  const b = chatOf(body)
  if (!b) return false
  if (Array.isArray(b.system)) return true
  const tools = Array.isArray(b.tools) ? b.tools : []
  return tools.some((t) => t && typeof t === "object" && "input_schema" in t && !t.function)
}

// withoutUnsigned is a Messages body without the thinking blocks that carry
// no signature, or whose signature WorkBuddy doesn't take.
//
// A conversation that began elsewhere — on WorkBuddy's chat route, whose
// thinking comes back unsigned, or on any other provider — and goes on here
// carries such blocks in its history, and WorkBuddy refuses the whole request
// for one of them when another assistant message holds a signed block:
// 11159 "Invalid `signature` in `thinking` block. The block is bound to a
// different conversation" (or the same wrapped in 11133). Seen 2026-10-24 in
// real Claude Code sessions moved onto this route mid-way: every request of
// two of them refused, each attempt alike, until the session ended. Replayed
// the same day, with a real account (20+ runs each):
//
//   unsigned thinking alone, no signed block anywhere ....... 200
//   one unsigned-only assistant message + a signed one ...... 11159
//   that message with the unsigned block taken out .......... 200
//   unsigned and signed blocks in the SAME message .......... 200
//   thinking.block_binding.prefix_mismatch_behavior=drop_block ... 11159
//
// So what binds a signed block is the history it sits in, and a message that
// is thinking alone can't be part of it; whether that thinking is signed
// makes no difference (a signed block alone is accepted too). The signature
// itself isn't checked for where it came from: a block keeping a signature
// of an unrelated turn, of another model (sonnet-5.5's on opus-5.5), or
// another account's answers 200, while a truncated or altered one is 11159.
// What WorkBuddy checks is that it reads as a signature.
//
// A block with no signature can't be verified by the model anyway, so
// nothing it could use is lost. A message whose only block that was gets an
// empty text block: measured the same day, that history still answers 200
// with a signed turn after it (three runs), where the unsigned block itself
// answers 11159 (three runs), and Anthropic's API refuses an empty text
// block — 200 here means WorkBuddy takes it. The signed blocks, this
// route's own, go back as they came, as Anthropic asks. A body without
// unsigned thinking is body itself, byte for byte.
function withoutUnsigned(body) {
  const b = chatOf(body)
  return unsignedOn(b) ? JSON.stringify(b) : body
}

// unsignedOn makes withoutUnsigned's change to a body's object; true when it made one
function unsignedOn(b) {
  const msgs = b?.messages
  if (!Array.isArray(msgs)) return false
  let changed = false
  for (const m of msgs) {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue
    const kept = m.content.filter((p) => !(p?.type === "thinking" && !p.signature))
    if (kept.length === m.content.length) continue
    changed = true
    m.content = kept.length ? kept : [{ type: "text", text: "" }]
  }
  return changed
}

// withoutSignedThinking is a Messages body without any thinking block at
// all, for a refusal saying a signature is not one WorkBuddy made (see the
// retry in the loader). An assistant message left with nothing gets an
// empty text block, as withoutUnsigned leaves it. null for a body with no
// thinking block to drop: the retry would send the same request again.
function withoutSignedThinking(body) {
  const b = chatOf(body)
  const msgs = b?.messages
  if (!Array.isArray(msgs)) return null
  let dropped = 0
  for (const m of msgs) {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue
    const kept = m.content.filter((p) => p?.type !== "thinking")
    if (kept.length === m.content.length) continue
    dropped += m.content.length - kept.length
    m.content = kept.length ? kept : [{ type: "text", text: "" }]
  }
  return dropped ? JSON.stringify(b) : null
}

// chatOf is a chat's body as the object it is, null for one that isn't: a
// body that isn't text (bytes), or isn't JSON at all.
// bodyString is a body given as bytes, as text; anything else is null.
function bodyString(body) {
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  return null
}

function chatOf(body) {
  if (typeof body !== "string") return null
  try {
    const b = JSON.parse(body)
    return b !== null && typeof b === "object" ? b : null
  } catch {
    return null
  }
}

// sessionOf takes the session a chat.headers hook named off the headers,
// with the header: it goes no further than here. Its length is capped as
// magpie's own session ids are, the id below being derived from it anyway.
function sessionOf(headers) {
  const s = String(headers.get(SESSION) ?? "").trim()
  headers.delete(SESSION)
  return s.slice(0, 128)
}

// attend sets a chat's ids on the headers its request goes to WorkBuddy
// with: the message's (each request its own, as the client makes them), the
// turn's (one user send, whatever it takes), and the conversation's. A header
// already there — the caller's own, or another plugin's — is kept, and the
// message and request ids are the same one, as WorkBuddy's client has them.
//
// who is the account the chat goes as (scopeOf). The ids are that account's
// own: WorkBuddy's client runs as one account, so one conversation or turn
// never shows up under two. Without it, one magpie session spread over a
// group of accounts sent the same X-Conversation-ID and
// X-Conversation-Request-ID under every account's X-User-Id.
function attend(headers, body, session, who = "") {
  return attendChat(headers, chatOf(body), session, who)
}

// attendChat is attend with the chat read already. It returns what reattend
// needs to set the ids again for another account once the chat itself is
// let go: the ids it set itself (not the caller's), and the digests of what
// names the turn and the conversation, which are never sent as they are.
function attendChat(headers, chat, session, who = "") {
  const conv = conversationParts(chat, session)
  const turn = turnParts(chat)
  const ids = {
    set: [],
    // a turn is a conversation's own: two conversations whose user message
    // reads the same are still two sends, not one
    turn: turn.length ? idFor("turn", [...conv, "|", ...turn]) : "",
    conv: conv.length ? idFor("conversation", conv) : "",
  }
  return setIds(headers, ids, who)
}

// setIds sets the message's id, and the turn's and conversation's for the
// account who, where the caller set none.
function setIds(headers, ids, who) {
  const msg = hex()
  headers.set("X-Conversation-Message-ID", msg)
  headers.set("X-Request-ID", msg)
  const set = []
  const own = (kind, base) => (who ? idFor(kind, [`account:${who}`, "|", base]) : base)
  if (!headers.has("X-Conversation-Request-ID")) {
    headers.set("X-Conversation-Request-ID", ids.turn ? own("turn", ids.turn) : hex())
    set.push("X-Conversation-Request-ID")
  }
  if (ids.conv && !headers.has("X-Conversation-ID")) {
    headers.set("X-Conversation-ID", own("conversation", ids.conv))
    set.push("X-Conversation-ID")
  }
  return { ...ids, set }
}

// scopeOf names the account a chat goes as for attend: its uid, its
// enterprise, and for a key account the key (only ever hashed).
function scopeOf(a) {
  return `${a?.uid ?? ""}|${a?.enterpriseId ?? ""}|${a?.source === "key" ? a.key ?? "" : ""}`
}

// reattend sets a chat's ids again for the account it is now sent as, when
// that is another account than the one they were set for.
function reattend(headers, ids, was, now) {
  if (was === now) return ids
  for (const h of ids.set) headers.delete(h)
  return setIds(headers, ids, now)
}

// FLAGGED are the words WorkBuddy refuses a chat for, "Illegal API
// invocation from an unapproved channel" (magpie #182), each with words
// that say the same and pass: tried one by one against both builds with
// the requests Claude Code 2.1.280 and Codex 0.159.2 send. WorkBuddy reads
// every message, not only the system prompt (Claude Code puts its main
// branch in the first user message), and pays no mind to case. Claude
// Code's billing header means nothing to WorkBuddy's models and goes.
const FLAGGED = [
  [/x-anthropic-billing-header:[^\n]*\n?/gi, ""],
  [/You are Claude Code, Anthropic['’]s official CLI for Claude/gi, "You are Claude Code, Anthropic's CLI for Claude"],
  [/Main branch \(you will usually use this for PRs\)/gi, "Main branch (usually the base for PRs)"],
  [/(?<!the )Codex CLI is an open source project led by OpenAI\./gi, "The Codex CLI is an open source project led by OpenAI."],
  // DeepSeek Harness (DSH) opens its system prompt with this line, which
  // WorkBuddy refuses as 11128 (magpie-community/plugins#279; the same
  // refusal traced in smart-open/TraeWorkAssistant#125).
  [/You are an AI agent powered by DeepSeek Harness\.?/gi, "You are an AI agent that helps the user with programming tasks."],
  // A line WorkBuddy refuses in a long DeepSeek Harness chat, measured 400
  // then 200 with this wording by tearslee (magpie-community/plugins#291). The
  // model can quote it back into an assistant message, which the move to
  // the user's instructions can't reach, so it is reworded in every message.
  [/Web GUI whose URL the runtime context names\.\s+When the user refers/gi, "Web GUI whose URL the runtime context names. The interface, when the user refers"],
]

function unflagged(text) {
  for (const [re, to] of FLAGGED) text = text.replace(re, to)
  return text
}

// unflag puts FLAGGED's words in place in every message of a chat, and
// leaves out a text that had nothing else (the billing header's system
// block). It says whether it changed anything.
function unflag(messages) {
  let changed = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (typeof m?.content === "string") {
      const t = unflagged(m.content)
      if (t === m.content) continue
      changed = true
      if (t.trim() || m.role !== "system") m.content = t
      else messages.splice(i, 1)
    } else if (Array.isArray(m?.content)) {
      const parts = []
      let here = false
      for (const p of m.content) {
        const t = typeof p?.text === "string" ? unflagged(p.text) : null
        if (t === null || t === p.text) {
          parts.push(p)
          continue
        }
        here = true
        if (t.trim()) parts.push({ ...p, text: t })
      }
      if (!here) continue
      changed = true
      if (parts.length || m.role !== "system") m.content = parts
      else messages.splice(i, 1)
    }
  }
  return changed
}

// withSystem gives a chat that doesn't open with a system message
// WorkBuddy's default one, as its app does, takes FLAGGED's words out of it,
// and applies the request spellings WorkBuddy's chat endpoint accepts. The
// OpenAI-compatible client normally uses max_completion_tokens and may call a
// reasoning prompt developer; WorkBuddy's endpoint takes max_tokens and
// system instead.
// An earlier turn's thinking goes back as `reasoning`, the field WorkBuddy's
// own client (CodeBuddy's agents converter) sets on an assistant message.
// WorkBuddy drops `reasoning_content`, which Grok Build, DeepSeek-style
// clients and magpie's own replies use: measured 2026-10-27 on
// www.workbuddy.ai, a codeword in reasoning_content reached none of
// kimi-k2.6, kimi-k3, glm-5.3, deepseek-v4.1-flash and minimax-m3, while
// the same words as `reasoning` reached kimi-k2.6 and minimax-m3.
// OpenRouter-style reasoning_details are read for their text the same way.
function reasoningOf(m) {
  if (typeof m.reasoning_content === "string" && m.reasoning_content) return m.reasoning_content
  if (Array.isArray(m.reasoning_details)) {
    const text = m.reasoning_details.map((d) => (typeof d?.text === "string" ? d.text : typeof d?.summary === "string" ? d.summary : "")).join("")
    if (text) return text
  }
  return ""
}

function asReasoning(messages) {
  let changed = false
  for (const m of messages) {
    if (m?.role !== "assistant" || (m.reasoning_content === undefined && m.reasoning_details === undefined)) continue
    const text = reasoningOf(m)
    if (text && !(typeof m.reasoning === "string" && m.reasoning)) m.reasoning = text
    delete m.reasoning_content
    delete m.reasoning_details
    changed = true
  }
  return changed
}

function withSystem(body) {
  // a body magpie or OpenCode hands over as bytes is read as the text it is
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) body = new TextDecoder().decode(body)
  if (typeof body !== "string") return body
  try {
    const b = JSON.parse(body)
    return systemOn(b) ? JSON.stringify(b) : body
  } catch {
    return body
  }
}

// systemOn makes withSystem's changes to a chat's object; true when it made any
function systemOn(b) {
  if (!Array.isArray(b?.messages) || !b.messages.length) return false
  let changed = unflag(b.messages)
  if (b.max_completion_tokens !== undefined) {
    if (b.max_tokens === undefined) b.max_tokens = b.max_completion_tokens
    delete b.max_completion_tokens
    changed = true
  }
  for (const m of b.messages) {
    if (m?.role !== "developer") continue
    m.role = "system"
    changed = true
  }
  if (asReasoning(b.messages)) changed = true
  if (b.messages[0]?.role !== "system") {
    b.messages.unshift({ role: "system", content: "You are a helpful assistant." })
    changed = true
  }
  return changed
}

// WorkBuddy's channel check reads the system and assistant messages only:
// tried on 2026-10-21 with real accounts on both builds (glm-5.3,
// deepseek-v4.1-flash, gpt-5.5), each refused line was served in the user's
// message, a tool's result and a user message's parts, and refused again in
// the system or an assistant message. It matches a known line whole and
// exactly (one extra space lets it through), so FLAGGED only ever knows the
// lines met so far, and another agent's opening line is refused until one is
// added (Wing on Discord, 10-21, with an agent we couldn't name).
//
// systemAsUser is body with its system prompt read to the model as the
// first thing the user says, in INSTRUCTIONS' tags, and WorkBuddy's default
// system prompt first, as both builds want a system message there (11128
// "first message is not system prompt"). A system message later in the chat
// becomes the user's where it stands. null when there's nothing to move.
const DEFAULT_SYSTEM = "You are a helpful assistant."
const INSTRUCTIONS = ["<instructions>\n", "\n</instructions>"]

function textOf(content) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((p) => (typeof p?.text === "string" ? p.text : "")).filter(Boolean).join("\n")
}

// systemKey is the text of a chat's system messages, which a chat refused
// once is known by: the same agent's next chat goes with systemAsUser at once
function systemKey(body) {
  return systemKeyOf(chatOf(body))
}

function systemKeyOf(chat) {
  const msgs = chat?.messages
  if (!Array.isArray(msgs)) return ""
  const key = msgs.filter((m) => m?.role === "system").map((m) => textOf(m.content)).join("\n")
  return key.trim() === DEFAULT_SYSTEM ? "" : key
}

function systemAsUser(body) {
  const b = chatOf(body)
  return systemAsUserOn(b) ? JSON.stringify(b) : null
}

// systemAsUserOn makes systemAsUser's move on a chat's object; false when
// there's nothing to move
function systemAsUserOn(b) {
  const msgs = b?.messages
  if (!Array.isArray(msgs)) return false
  let i = 0
  const lead = []
  for (; i < msgs.length && msgs[i]?.role === "system"; i++) lead.push(textOf(msgs[i].content))
  const said = lead.join("\n\n").trim()
  const rest = msgs.slice(i).map((m) => (m?.role === "system" ? { ...m, role: "user" } : m))
  const moved = said && said !== DEFAULT_SYSTEM
  if (!moved && rest.every((m, k) => m === msgs[i + k])) return false
  if (moved) {
    const text = INSTRUCTIONS[0] + said + INSTRUCTIONS[1]
    const u = rest.findIndex((m) => m?.role === "user")
    if (u < 0) rest.unshift({ role: "user", content: text })
    else if (typeof rest[u].content === "string") rest[u] = { ...rest[u], content: text + "\n\n" + rest[u].content }
    else if (Array.isArray(rest[u].content)) rest[u] = { ...rest[u], content: [{ type: "text", text }, ...rest[u].content] }
    else rest[u] = { ...rest[u], content: text }
  }
  b.messages = [{ role: "system", content: DEFAULT_SYSTEM }, ...rest]
  return true
}

// normalizeToolChoice converts the object form emitted by OpenAI clients to
// WorkBuddy's string form. It runs after fitted(), so a named choice follows a
// tool name that was made safe for WorkBuddy.
function normalizeToolChoice(body) {
  if (typeof body !== "string") return body
  try {
    const b = JSON.parse(body)
    return toolChoiceOn(b) ? JSON.stringify(b) : body
  } catch {
    return body
  }
}

// toolChoiceOn makes normalizeToolChoice's change to a chat's object; true
// when it made one (a string choice other than none is WorkBuddy's already)
function toolChoiceOn(b) {
  if (!b || typeof b !== "object" || Array.isArray(b) || !("tool_choice" in b)) return false
  const choice = b.tool_choice
  if (typeof choice === "string") {
    if (choice.trim().toLowerCase() !== "none") return false
    delete b.tool_choice
    delete b.tools
    delete b.functions
    return true
  }
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    delete b.tool_choice
    return true
  }
  const type = typeof choice.type === "string" ? choice.type.trim().toLowerCase() : ""
  if (type === "none") {
    delete b.tool_choice
    delete b.tools
    delete b.functions
  } else if (type === "auto" || type === "required") {
    b.tool_choice = type
  } else if (type === "function") {
    const fn = choice.function && typeof choice.function === "object" && !Array.isArray(choice.function)
      ? choice.function
      : undefined
    const name = typeof fn?.name === "string" ? fn.name.trim() : ""
    b.tool_choice = name || "auto"
  } else {
    delete b.tool_choice
  }
  return true
}

// ---- tools WorkBuddy takes ----------------------------------------------------

// WorkBuddy AI answers 400 code 11133 "Invalid request parameters" (the
// model provider rejected them) to a chat whose tools it can't pass on to
// the model (wyh on magpie's Discord: ZCode and DeepSeek Harness on
// deepseek-v4.1-flash). Tried on the owner's account, 2026-10-08: DeepSeek
// turns away each of the shapes below, and Kimi, GPT, Gemini and GLM some
// of them; MiniMax none. fitTools gives each a shape every model takes.
// A tool's name may hold letters, digits, _ and -; another character
// (". : / space", CJK) is refused.
const NAME_OK = /^[A-Za-z0-9_-]+$/

// safeName is name with each character WorkBuddy refuses as _, kept apart
// from the names in taken.
function safeName(name, taken) {
  const base = String(name).replace(/[^A-Za-z0-9_-]/g, "_") || "tool"
  let n = base
  for (let i = 2; taken.has(n); i++) n = `${base}_${i}`
  taken.add(n)
  return n
}

// NUL_ESCAPE finds a regex's \0 (the NUL character), stepping over each \\
// (a backslash) so that a \\0 is left; \01 is an octal escape, also left.
const NUL_ESCAPE = /\\\\|\\0(?![0-9])/g

// fitSchema mends a schema in place, at every depth: a pattern's \0, which
// DeepSeek's validator says is "not a 'regex'", is \u0000, which matches
// the same (magpie's gateway does this for DeepSeek's own API,
// deepseekToolPatterns); a tuple's items (a list) become one schema any of
// them fits. It reports whether it changed anything.
function fitSchema(s, depth = 0) {
  if (!s || typeof s !== "object" || depth > 64) return false
  let changed = false
  if (Array.isArray(s)) {
    for (const v of s) if (fitSchema(v, depth + 1)) changed = true
    return changed
  }
  if (typeof s.pattern === "string" && s.pattern.includes("\\0")) {
    const p = s.pattern.replace(NUL_ESCAPE, (m) => (m === "\\\\" ? m : "\\u0000"))
    if (p !== s.pattern) {
      s.pattern = p
      changed = true
    }
  }
  if (Array.isArray(s.items)) {
    const list = s.items.filter((v) => v && typeof v === "object")
    s.items = list.length === 0 ? {} : list.length === 1 ? list[0] : { anyOf: list }
    delete s.additionalItems
    changed = true
  }
  for (const v of Object.values(s)) if (fitSchema(v, depth + 1)) changed = true
  return changed
}

// Kimi (kimi-k3-1) answers 11133 too, to the tools of an MCP server or a
// plugin (clearmann, #122). Tried on the owner's account, 2026-10-14, each
// alone in an otherwise plain chat: Kimi turns away an enum with no type
// (["a","b"] as much as [1,"a",null]), an empty enum, an enum whose type
// lists two types besides null, a schema that is true or false where a
// schema goes (properties.x: true, items: true), a required that isn't a
// list, and a type it doesn't know ("any", "String"). It takes an enum
// typed T or [T, "null"], an anyOf of such enums, {"not": {}}, {}, and
// additionalProperties: true or false. fitShape gives each the shape it
// takes, meaning the same: none of it narrows or widens what a call may
// hold, except an empty enum (which nothing fits) is left out.
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"])

// SUB_ONE are the keywords whose value is a schema, SUB_LIST a list of
// schemas, SUB_MAP a map of names to schemas. additionalProperties and
// unevaluatedProperties are left as they are when true or false.
const SUB_ONE = ["items", "additionalItems", "unevaluatedItems", "contains", "not", "if", "then", "else", "propertyNames", "additionalProperties", "unevaluatedProperties"]
const SUB_LIST = ["anyOf", "oneOf", "allOf", "prefixItems"]
const SUB_MAP = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]
const BOOL_OK = new Set(["additionalProperties", "unevaluatedProperties"])

// valueType is the JSON Schema type of an enum's value.
function valueType(v) {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number"
  return typeof v
}

// fitEnum gives s's enum a type: the one its values have, or that and
// "null"; values of several types are an anyOf of an enum for each. It
// reports whether it changed anything.
function fitEnum(s) {
  if (!("enum" in s)) return false
  if (!Array.isArray(s.enum) || s.enum.length === 0) {
    delete s.enum
    return true
  }
  const listed = Array.isArray(s.type) ? s.type : typeof s.type === "string" ? [s.type] : []
  if (listed.filter((t) => t !== "null").length === 1) return false
  const byType = new Map()
  for (const v of s.enum) {
    const t = valueType(v)
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t).push(v)
  }
  if (byType.has("integer") && byType.has("number")) {
    byType.get("number").push(...byType.get("integer"))
    byType.delete("integer")
  }
  const hasNull = byType.delete("null")
  if (byType.size <= 1) {
    const [t] = byType.keys()
    const want = t === undefined ? "null" : hasNull ? [t, "null"] : t
    if (JSON.stringify(want) === JSON.stringify(s.type)) return false
    s.type = want
    return true
  }
  const split = [...byType].map(([t, vs]) => ({ type: t, enum: vs }))
  if (hasNull) split.push({ type: "null" })
  delete s.enum
  delete s.type
  if (Array.isArray(s.anyOf)) s.allOf = [...(Array.isArray(s.allOf) ? s.allOf : []), { anyOf: split }]
  else s.anyOf = split
  return true
}

// subSchema is v, a schema found under key, as an object Kimi takes: true
// is {}, false is {"not": {}}.
function subSchema(v, key) {
  if (typeof v !== "boolean" || BOOL_OK.has(key)) return v
  return v ? {} : { not: {} }
}

// fitShape mends s, a schema, and each schema under it, in place (see
// TYPES above); a name under properties is never read as a keyword. It
// reports whether it changed anything.
function fitShape(s, depth = 0) {
  if (!s || typeof s !== "object" || Array.isArray(s) || depth > 64) return false
  let changed = false
  if ("type" in s) {
    const list = (Array.isArray(s.type) ? s.type : [s.type]).map((t) => (typeof t === "string" ? t.toLowerCase() : t)).filter((t) => TYPES.has(t))
    const uniq = [...new Set(list)]
    const want = uniq.length === 0 ? undefined : uniq.length === 1 ? uniq[0] : uniq
    if (JSON.stringify(want) !== JSON.stringify(s.type)) {
      if (want === undefined) delete s.type
      else s.type = want
      changed = true
    }
  }
  if ("required" in s && !Array.isArray(s.required)) {
    delete s.required
    changed = true
  } else if (Array.isArray(s.required) && s.required.some((k) => typeof k !== "string")) {
    s.required = s.required.filter((k) => typeof k === "string")
    changed = true
  }
  if (fitEnum(s)) changed = true
  for (const k of SUB_ONE) {
    if (!(k in s)) continue
    const v = subSchema(s[k], k)
    if (v !== s[k]) {
      s[k] = v
      changed = true
    }
    if (fitShape(v, depth + 1)) changed = true
  }
  for (const k of SUB_LIST) {
    if (!Array.isArray(s[k])) continue
    s[k].forEach((v0, i) => {
      const v = subSchema(v0, k)
      if (v !== v0) {
        s[k][i] = v
        changed = true
      }
      if (fitShape(v, depth + 1)) changed = true
    })
  }
  for (const k of SUB_MAP) {
    const m = s[k]
    if (!m || typeof m !== "object" || Array.isArray(m)) continue
    for (const [name, v0] of Object.entries(m)) {
      const v = subSchema(v0, k)
      if (v !== v0) {
        m[name] = v
        changed = true
      }
      if (fitShape(v, depth + 1)) changed = true
    }
  }
  return changed
}

// localRef is the schema a local $ref in root names ("#/$defs/x",
// "#/definitions/x"), or s itself.
function localRef(root, s) {
  const ref = s?.$ref
  if (typeof ref !== "string" || !ref.startsWith("#/")) return s
  let at = root
  for (const k of ref.slice(2).split("/")) at = at?.[k.replaceAll("~1", "/").replaceAll("~0", "~")]
  return at && typeof at === "object" ? at : s
}

// objectRoot makes a tool's parameters an object at the root, as magpie's
// gateway does for xAI (provider.ObjectRoot): allOf's branches are merged
// whole; of anyOf's and oneOf's object branches the properties are merged
// and a field each requires stays required. A root with no type, or an
// empty one, is an object. It reports whether it changed anything.
function objectRoot(ps, root = ps, depth = 0) {
  const unions = ["allOf", "anyOf", "oneOf"].filter((k) => Array.isArray(ps[k]))
  if (ps.type === "object" && !unions.length) return false
  const props = ps.properties && typeof ps.properties === "object" ? ps.properties : {}
  const required = Array.isArray(ps.required) ? [...ps.required] : []
  for (const b0 of ps.allOf ?? []) {
    let b = localRef(root, b0)
    if (!b || typeof b !== "object") continue
    if (depth < 8 && ["allOf", "anyOf", "oneOf"].some((k) => Array.isArray(b[k]))) objectRoot((b = structuredClone(b)), root, depth + 1)
    for (const [k, v] of Object.entries(b.properties ?? {})) if (!(k in props)) props[k] = v
    if (Array.isArray(b.required)) required.push(...b.required)
  }
  const branches = []
  for (const key of ["anyOf", "oneOf"]) {
    for (const b0 of ps[key] ?? []) {
      let b = localRef(root, b0)
      if (!b || typeof b !== "object") continue
      if (depth < 8 && ["allOf", "anyOf", "oneOf"].some((k) => Array.isArray(b[k]))) objectRoot((b = structuredClone(b)), root, depth + 1)
      if (b.type !== "object" && !b.properties) continue
      branches.push(b)
    }
  }
  const from = new Map()
  for (const b of branches) {
    for (const [k, v] of Object.entries(b.properties ?? {})) {
      if (k in props) continue
      const seen = from.get(k) ?? []
      if (!seen.some((x) => JSON.stringify(x) === JSON.stringify(v))) seen.push(v)
      from.set(k, seen)
    }
  }
  for (const [k, list] of from) props[k] = list.length === 1 ? list[0] : { anyOf: list }
  if (branches.length) {
    for (const k of Object.keys(branches[0].properties ?? {})) {
      if (branches.every((b) => Array.isArray(b.required) && b.required.includes(k))) required.push(k)
    }
  }
  for (const k of unions) delete ps[k]
  ps.type = "object"
  ps.properties = props
  const req = [...new Set(required)].filter((k) => typeof k === "string" && k in props)
  if (req.length) ps.required = req
  else delete ps.required
  return true
}

// Kimi (kimi-k3.1-pro) answers 400 "Invalid request parameters" to a oneOf
// that has no type, at the root of a $ref's target or deeper, even when every
// branch is an object (congee949, #378: dsh's REA tools, on workbuddy and
// workbuddy-ai alike; a "type": "object" beside it is taken). typeUnions gives
// such a oneOf type "object" when each branch is typed object itself or
// through a chain of local $refs, and changes nothing else: a union of other
// or mixed types, an anyOf, or a $ref that is missing, external or circular
// is left as it came. It reports whether it changed anything.
function typeUnions(s, root = s, depth = 0) {
  if (!s || typeof s !== "object" || Array.isArray(s) || depth > 64) return false
  let changed = false
  if (!("type" in s) && Array.isArray(s.oneOf) && s.oneOf.length && s.oneOf.every((b) => objectBranch(root, b))) {
    s.type = "object"
    changed = true
  }
  for (const k of SUB_ONE) if (typeUnions(s[k], root, depth + 1)) changed = true
  for (const k of SUB_LIST) for (const v of Array.isArray(s[k]) ? s[k] : []) if (typeUnions(v, root, depth + 1)) changed = true
  for (const k of SUB_MAP) {
    const m = s[k]
    if (!m || typeof m !== "object" || Array.isArray(m)) continue
    for (const v of Object.values(m)) if (typeUnions(v, root, depth + 1)) changed = true
  }
  return changed
}

// objectBranch says whether b is typed object, itself or where its local
// $refs lead; a $ref seen before on the way is a cycle, and not.
function objectBranch(root, b, seen = []) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false
  if ("type" in b) return b.type === "object"
  if (typeof b.$ref !== "string" || seen.includes(b.$ref) || seen.length > 16) return false
  const t = localRef(root, b)
  return t !== b && objectBranch(root, t, [...seen, b.$ref])
}

// fitTools mends b's function tools in place: their parameters (fitSchema,
// fitShape, objectRoot) and names. It reports whether it changed anything,
// and the names it gave, each to the name the client knows (ours), so that the
// model's calls are named back. A call in the chat's history is named as
// its tool now is.
function fitTools(b) {
  const names = new Map()
  if (!Array.isArray(b?.tools) || !b.tools.length) return { changed: false, names }
  let changed = false
  const taken = new Set()
  for (const t of b.tools) {
    const n = t?.function?.name
    if (typeof n === "string" && NAME_OK.test(n)) taken.add(n)
  }
  const theirs = new Map()
  for (const t of b.tools) {
    const fn = t?.type === "function" || t?.function ? t.function : null
    if (!fn || typeof fn !== "object") continue
    if (typeof fn.name === "string" && !NAME_OK.test(fn.name)) {
      const safe = safeName(fn.name, taken)
      names.set(safe, fn.name)
      theirs.set(fn.name, safe)
      fn.name = safe
      changed = true
    }
    if (fn.parameters === undefined) continue
    if (!fn.parameters || typeof fn.parameters !== "object" || Array.isArray(fn.parameters)) {
      fn.parameters = { type: "object", properties: {} }
      changed = true
      continue
    }
    if (fitSchema(fn.parameters)) changed = true
    if (fitShape(fn.parameters)) changed = true
    if (typeUnions(fn.parameters)) changed = true
    if (objectRoot(fn.parameters)) changed = true
  }
  if (theirs.size && Array.isArray(b.messages)) {
    for (const m of b.messages) {
      for (const c of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
        const safe = theirs.get(c?.function?.name)
        if (safe) c.function.name = safe
      }
      if (m?.role === "tool" && theirs.has(m.name)) m.name = theirs.get(m.name)
    }
  }
  const choice = b.tool_choice?.function
  if (choice && theirs.has(choice.name)) choice.name = theirs.get(choice.name)
  return { changed, names }
}

// fitted is a chat body with its tools mended (fitTools), and the names
// given its tools, each to the client's own; a body that isn't a chat is
// as it was.
function fitted(body) {
  if (typeof body !== "string") return { body, names: new Map() }
  try {
    const b = JSON.parse(body)
    const { changed, names } = fitTools(b)
    return { body: changed ? JSON.stringify(b) : body, names }
  } catch {
    return { body, names: new Map() }
  }
}

// gzipped is a chat's body compressed, as WorkBuddy's own client sends its
// model requests: its CLI's GzipRequestProcessor (WorkBuddy 5.9.3, CLI
// 2.165.0, on both builds) gzips each POST's body and sets
// Content-Encoding: gzip when the product's RequestBodyGzip feature is on,
// which both builds' product.json turn on and /v3/config (merged over it)
// doesn't turn off. Sent as plain JSON, a long agent conversation went up
// whole on every step: runmiNeverstop on X saw 2.89 GB up to
// copilot.tencent.com against 258 MB down. Measured 2026-10-28 on
// www.workbuddy.ai: a gzipped chat answers as the plain one does. A
// Messages request (Claude on the China build) goes as it came: that route
// wasn't tried gzipped. Only a chat completion goes gzipped (isCompletion):
// WorkBuddy's images API reads its body as plain JSON, and magpie's drawing
// (/v2/images/generations, /v2/images/edits) is sent through this same
// fetch; gzipped it answered 400 11101 "invalid character '\x1f'" (iwinux on
// Discord, 0.1.43). null when the body isn't sent gzipped.
function gzipped(completion, b) {
  if (!completion) return null
  if (typeof b === "string") return gzipSync(Buffer.from(b))
  if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return gzipSync(b)
  return null
}

// prepared is a request's body read once for every change the loader makes
// to it and everything it reads off it (plugins#461): a long chat, 45 MiB
// of history, was parsed six times on its way, once by each step, and
// written out again whole by normalizeToolChoice even when nothing changed.
// chat is the parsed body, changed whether any step changed it; the caller
// writes it out once, when it did. Each step is the one its own function
// above makes, in the same order.
function prepared(body, native) {
  if (!native && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) body = new TextDecoder().decode(body)
  const none = { body, chat: null, names: new Map(), changed: false }
  if (typeof body !== "string") return none
  let chat
  try {
    chat = JSON.parse(body)
  } catch {
    return none
  }
  if (chat === null || typeof chat !== "object") return none
  if (native) return { body, chat, names: new Map(), changed: unsignedOn(chat) }
  try {
    let changed = systemOn(chat)
    const fit = fitTools(chat)
    if (fit.changed) changed = true
    if (toolChoiceOn(chat)) changed = true
    return { body, chat, names: fit.names, changed }
  } catch {
    // a shape a step can't take: the steps one by one, each keeping the
    // body as it was when it can't, as they always have
    const fit = fitted(withSystem(body))
    const out = normalizeToolChoice(fit.body)
    return { body: out, chat: chatOf(out), names: fit.names, changed: false }
  }
}

// namedBack gives the model's calls in a chat answer (one JSON body, or an
// SSE stream's chunks) the names the client gave its tools.
function namedBack(v, names) {
  let changed = false
  for (const c of Array.isArray(v?.choices) ? v.choices : []) {
    for (const at of [c?.message, c?.delta]) {
      for (const tc of Array.isArray(at?.tool_calls) ? at.tool_calls : []) {
        const ours = names.get(tc?.function?.name)
        if (ours) {
          tc.function.name = ours
          changed = true
        }
      }
    }
  }
  return changed
}

// renamed is res with namedBack on its body, read as it comes.
function renamed(res, names) {
  if (!names.size || !res.body) return res
  const headers = new Headers(res.headers)
  headers.delete("content-length")
  headers.delete("content-encoding")
  const json = /json/i.test(res.headers.get("content-type") ?? "")
  if (json) {
    const out = res.text().then((text) => {
      try {
        const v = JSON.parse(text)
        return namedBack(v, names) ? JSON.stringify(v) : text
      } catch {
        return text
      }
    })
    return out.then((text) => new Response(text, { status: res.status, statusText: res.statusText, headers }))
  }
  const dec = new TextDecoder()
  const enc = new TextEncoder()
  let rest = ""
  const line = (l) => {
    const m = /^data:\s?(.*)$/.exec(l)
    if (!m || m[1] === "[DONE]") return l
    try {
      const v = JSON.parse(m[1])
      return namedBack(v, names) ? `data: ${JSON.stringify(v)}` : l
    } catch {
      return l
    }
  }
  const body = res.body.pipeThrough(
    new TransformStream({
      transform(chunk, ctl) {
        rest += dec.decode(chunk, { stream: true })
        const lines = rest.split("\n")
        rest = lines.pop()
        if (lines.length) ctl.enqueue(enc.encode(lines.map(line).join("\n") + "\n"))
      },
      flush(ctl) {
        rest += dec.decode()
        if (rest) ctl.enqueue(enc.encode(line(rest)))
      },
    }),
  )
  return new Response(body, { status: res.status, statusText: res.statusText, headers })
}

// ---- signing in -------------------------------------------------------------

// poll asks path until WorkBuddy answers with data, retrying the codes
// that mean "not yet".
async function poll(site, path, headers, retry, deadline) {
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${site.name} sign-in timed out`)
    try {
      const data = await call(site, "GET", path, headers)
      if (data && Object.keys(data).length) return data
    } catch (e) {
      if (!(retry.includes(e.code) || e.status === 408 || e.status === 429)) throw e
    }
    await sleep(POLL_MS)
  }
}

async function browserSignIn(site) {
  const state = await call(site, "POST", `/v2/plugin/auth/state?platform=${encodeURIComponent(site.platform)}`, {
    "X-No-Authorization": "true",
    "X-No-User-Id": "true",
    "X-No-Enterprise-Id": "true",
    "X-No-Department-Info": "true",
  }, {})
  if (!state?.state || !state?.authUrl) throw new Error(`${site.name} gave no sign-in page`)
  const url = new URL(state.authUrl)
  if (url.protocol !== "https:") throw new Error(`${site.name}'s sign-in page isn't https`)
  url.searchParams.set("version", APP_VERSION)
  url.searchParams.set("loginSessionId", hex())
  return {
    url: url.toString(),
    instructions: `Sign in to ${site.name} in the browser; this finishes by itself.`,
    method: "auto",
    async callback() {
      try {
        const deadline = Date.now() + SIGN_IN_MS
        const q = encodeURIComponent(state.state)
        const token = await poll(site, `/v2/plugin/auth/token?state=${q}`, {}, [11217], deadline)
        if (!token.accessToken) return { type: "failed", error: `${site.name} sent back no token` }
        let a = merge({}, token)
        const who = await poll(site, `/v2/plugin/login/account?state=${q}`, {
          Authorization: "Bearer " + a.access,
          "X-Domain": domainOf(site, a),
          "X-No-User-Id": "true",
          "X-No-Enterprise-Id": "true",
        }, [12151], deadline)
        a.uid = who.uid ?? ""
        const ent = await enterpriseOf(site, a, who)
        a.enterpriseId = ent.id
        return success(site, a, accountName(who, ent))
      } catch (e) {
        return { type: "failed", error: e.message }
      }
    },
  }
}

function success(site, a, name) {
  return {
    type: "success",
    refresh: a.refresh ?? "",
    access: a.access,
    expires: a.expires ?? 0,
    accountId: name || site.name,
    uid: a.uid ?? "",
    domain: a.domain ?? "",
    ...(a.enterpriseId ? { enterpriseId: a.enterpriseId } : {}),
    ...(a.refreshExpiresAt ? { refreshExpiresAt: a.refreshExpiresAt } : {}),
    ...(a.tokenType ? { tokenType: a.tokenType } : {}),
  }
}

// desktopFile is where WorkBuddy's desktop app keeps its sign-in.
function desktopFile(site) {
  const home = homedir()
  const base =
    process.platform === "darwin" ? join(home, "Library", "Application Support", "CodeBuddyExtension")
    : process.platform === "win32" ? join(home, "AppData", "Local", "CodeBuddyExtension")
    : join(home, ".local", "share", "CodeBuddyExtension")
  return join(base, "Data", "Public", "auth", site.authID + ".info")
}

// readDesktop is WorkBuddy desktop's sign-in as the app keeps it now, null
// for none (or tokens the app keeps encrypted, which can't be read).
function readDesktop(site) {
  try {
    const f = JSON.parse(readFileSync(desktopFile(site), "utf8"))
    const t = f?.auth ?? {}
    if (typeof t.accessToken !== "string" || !t.accessToken || !f?.account?.uid) return null
    const now = Date.now()
    const acct = f.account
    return {
      access: t.accessToken,
      refresh: typeof t.refreshToken === "string" ? t.refreshToken : "",
      expires: t.expiresAt > 0 ? t.expiresAt : t.expiresIn > 0 ? now + t.expiresIn * 1000 : 0,
      refreshExpiresAt: t.refreshExpiresAt > 0 ? t.refreshExpiresAt : t.refreshExpiresIn > 0 ? now + t.refreshExpiresIn * 1000 : 0,
      domain: typeof t.domain === "string" ? t.domain : "",
      tokenType: typeof t.tokenType === "string" ? t.tokenType : "",
      uid: acct.uid,
      ...(typeof acct.enterpriseId === "string" && acct.enterpriseId.trim() ? { enterpriseId: acct.enterpriseId.trim() } : {}),
      name: acct.nickname || acct.phoneNumber || acct.uid,
      // what the errors below say to do goes by it: sign in to the app again
      source: "desktop",
    }
  } catch {
    return null
  }
}

// notDesktop says why there is no desktop sign-in to use: WorkBuddy 5.6
// and later seal its tokens at rest ({$wbEncrypted: 1, envelope}), which
// only the app itself opens (plugins#18), so the browser sign-in is the way;
// else the app isn't signed in.
function notDesktop(site) {
  try {
    const t = JSON.parse(readFileSync(desktopFile(site), "utf8"))?.auth ?? {}
    if (t.accessToken?.$wbEncrypted || t.refreshToken?.$wbEncrypted)
      return `${site.name} desktop keeps its sign-in encrypted (WorkBuddy 5.6 and later), which magpie can't read; sign in with "${site.name} account (browser)" instead`
  } catch {}
  return `${site.name} desktop isn't signed in`
}

// desktopSignIn uses the account WorkBuddy desktop is signed in to: nothing
// is copied (a copied refresh token would be the app's and the plugin's
// both, and the first to use it would sign the other out); its file is
// read each time, as the app keeps it.
function desktopSignIn(site) {
  return {
    url: "",
    instructions: `Uses the account ${site.name} desktop is signed in to.`,
    method: "auto",
    async callback() {
      const d = readDesktop(site)
      if (!d) return { type: "failed", error: notDesktop(site) }
      return { type: "success", refresh: "", access: "", expires: 0, source: "desktop", accountId: d.name || site.name, uid: d.uid }
    },
  }
}

// desktopHeld is what a desktop sign-in was renewed to here, by site and
// account: kept in memory only, never written where the app keeps it.
const desktopHeld = new Map()

// current is the sign-in a stored auth names, fresh: WorkBuddy desktop's,
// read where it keeps it, or one kept here.
async function current(site, client, auth) {
  if (auth?.source !== "desktop") return fresh(site, client, auth)
  const d = readDesktop(site)
  if (!d) throw new Error(notDesktop(site))
  const k = site.id + "|" + d.uid
  const h = desktopHeld.get(k)
  const a = await fresh(site, null, h && h.expires >= d.expires ? h : d)
  desktopHeld.set(k, a)
  return a
}

// ---- allowance ----------------------------------------------------------------

// STATUS_TEXT is Go's http.StatusText, which magpie's built-in said a
// refused meter call with; a status Go has no words for is "HTTP <n>", so
// the card always has an error.
const STATUS_TEXT = {
  100: "Continue", 101: "Switching Protocols", 102: "Processing", 103: "Early Hints",
  200: "OK", 201: "Created", 202: "Accepted", 203: "Non-Authoritative Information", 204: "No Content", 205: "Reset Content",
  206: "Partial Content", 207: "Multi-Status", 208: "Already Reported", 226: "IM Used",
  300: "Multiple Choices", 301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified", 305: "Use Proxy",
  307: "Temporary Redirect", 308: "Permanent Redirect",
  400: "Bad Request", 401: "Unauthorized", 402: "Payment Required", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
  406: "Not Acceptable", 407: "Proxy Authentication Required", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
  411: "Length Required", 412: "Precondition Failed", 413: "Request Entity Too Large", 414: "Request URI Too Long",
  415: "Unsupported Media Type", 416: "Requested Range Not Satisfiable", 417: "Expectation Failed", 418: "I'm a teapot",
  421: "Misdirected Request", 422: "Unprocessable Entity", 423: "Locked", 424: "Failed Dependency", 425: "Too Early",
  426: "Upgrade Required", 428: "Precondition Required", 429: "Too Many Requests", 431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
  505: "HTTP Version Not Supported", 506: "Variant Also Negotiates", 507: "Insufficient Storage", 508: "Loop Detected",
  510: "Not Extended", 511: "Network Authentication Required",
}
const statusText = (n) => STATUS_TEXT[n] || `HTTP ${n}`

// meterAsked is the billing API's reply to path, asked with a's sign-in.
function meterAsked(site, a, path, body = {}, signal = AbortSignal.timeout(20000)) {
  return fetch(site.endpoint + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "WorkBuddy/" + site.app,
      Authorization: "Bearer " + a.access, "X-User-Id": a.uid ?? "", "X-Domain": domainOf(site, a), "X-Product": "SaaS",
      "X-IDE-Type": "WorkBuddy", ...enterpriseHeaders(a) },
    body: JSON.stringify(body),
    signal,
  })
}

// EDGE_READS is how much of a request WorkBuddy's front door (APISIX, on
// both sites) reads before it answers a sign-in it refuses. A refused
// request with a longer body gets no answer at all: the connection is
// reset, and the chat fails as "ECONNRESET: The socket connection was
// closed unexpectedly", which says nothing of the sign-in (wyp on Discord,
// 2026-10-15: a Claude Code session past 2 MiB failed on every turn).
// Measured on 2026-10-15 on www.workbuddy.ai and copilot.tencent.com: a
// body of 2097152 bytes with a refused token got 401, one of 2097153 a
// reset; with an accepted token 20 MB went through.
const EDGE_READS = 2 * 1024 * 1024

const byteLength = (b) =>
  typeof b === "string" ? Buffer.byteLength(b) : b instanceof ArrayBuffer || ArrayBuffer.isView(b) ? b.byteLength : 0

// unanswered is what a chat whose fetch failed with err comes to: a chat
// past EDGE_READS that the connection was reset on is asked about at the
// billing API, which answers a refused sign-in with its 401 whatever the
// size. A 401 there is the chat's own answer, said as one; anything else
// leaves err as it was, as does a smaller chat, which the front door
// answers itself. The chat isn't sent again.
async function unanswered(site, a, body, err, signal) {
  if (signal?.aborted || err?.name === "AbortError" || err?.name === "TimeoutError") throw err
  const size = byteLength(body)
  if (size <= EDGE_READS) throw err
  // the billing API isn't asked with a key: what it answers one is unknown
  if (a.source === "key") throw err
  let status = 0
  let challenge = ""
  try {
    const res = await meterAsked(site, a, "/billing/meter/get-user-resource-summary", {}, AbortSignal.timeout(20000))
    status = res.status
    challenge = res.headers.get("www-authenticate") ?? ""
    await res.body?.cancel()
  } catch {
    throw err
  }
  if (status !== 401) throw err
  const mb = (size / (1024 * 1024)).toFixed(1)
  const note = `It closes the connection on a refused request over 2 MiB (this one was ${mb} MiB) instead of answering, which is why it read as ECONNRESET.`
  const message =
    `${site.name} refused this account's sign-in (401). ${note} ` +
    (a.source === "desktop" ? `Sign in to ${site.name} desktop again.` : `Sign in to ${site.name} again in magpie.`)
  // the billing API's challenge goes with it: it says whether the token
  // itself was refused (invalidToken), as the chat's own 401 would have
  const headers = { "content-type": "application/json", ...(challenge ? { "www-authenticate": challenge } : {}) }
  const res = new Response(JSON.stringify({ error: { message, type: "authentication_error", code: 401 } }), {
    status: 401,
    statusText: "Unauthorized",
    headers,
  })
  edgeNotes.set(res, note)
  return res
}

// edgeNotes is what unanswered's 401s say of the reset, for signedOut to
// say again when the sign-in can't be renewed.
const edgeNotes = new WeakMap()

// ---- a refused sign-in ----------------------------------------------------------

// invalidToken says res is WorkBuddy refusing the access token itself. Its
// front door (APISIX, on both sites) answers a token it doesn't take with
// 401 and WWW-Authenticate: Bearer realm="copilot", error="invalid_token",
// on a chat (streamed or not) and on the billing API alike; measured on
// www.workbuddy.ai on 2026-10-23 with a real account's token cut short,
// and with "garbage". (Its /v3/config answers 200 to any token, so the
// models list never meets a 401.) A 401 without it is not taken as the
// sign-in's: WorkBuddy answers some paths with a bare 401 to an accepted
// sign-in (magpie's check-in, モモコ on Discord).
const invalidToken = (res) => res?.status === 401 && /invalid_token/i.test(res.headers.get("www-authenticate") ?? "")

// refreshRefused says e is WorkBuddy turning the refresh token itself
// away: HTTP 401 with code 12153, "refresh token failed:400 Bad Request:
// invalid_grant: Invalid refresh token" for a spent or unknown one, or
// "10000:token format error" (measured 2026-10-23). Anything else (a 5xx,
// a timeout) says nothing of the sign-in.
const refreshRefused = (e) => e instanceof WBError && (e.status === 401 || /invalid_grant/i.test(e.message))

// reissued is the sign-in to send a request WorkBuddy refused a's access
// token for (401) once more with, before that token's time: WorkBuddy can
// refuse one long before it ends (a browser sign-in's lasts as long as
// its refresh token, about 340 days), and renewing only by time left such
// an account refused on every request for months. It is
//   { a }: a sign-in with another access token, to send the request with
//     once more;
//   { why, kind }: none to be had, why, and of what kind: "refresh
//     refused" (WorkBuddy turned the refresh token away too), "nothing to
//     renew with" (no refresh token, or one past its end), or "unknown"
//     (the refresh failed for another reason, the desktop's token is the
//     one refused).
// began is the access token the request read at its start: a stored one
// that isn't it was saved since by someone else (magpie's renewal,
// another of its processes), and is taken rather than renewing again.
//
// A desktop sign-in is the app's: its file is read again, and what was
// renewed here (desktopHeld) is let go, but its refresh token is never
// spent for a refusal, which would sign the app itself out (see
// desktopSignIn).
async function reissued(site, client, getAuth, a, began) {
  if (a.source === "desktop") {
    desktopHeld.delete(site.id + "|" + a.uid)
    const d = readDesktop(site)
    if (!d) return { why: notDesktop(site), kind: "unknown" }
    if (d.access !== a.access) {
      desktopHeld.set(site.id + "|" + d.uid, d)
      return { a: d }
    }
    return { why: `${site.name} desktop's own sign-in is the one refused`, kind: "unknown" }
  }
  const newer = async () => {
    const now = await getAuth().catch(() => null)
    return now?.type === "oauth" && now.source !== "desktop" && now.access && now.access !== began && now.access !== a.access ? now : null
  }
  const saved = await newer()
  if (saved) return { a: saved }
  if (!refreshable(a)) return { why: a.refresh ? "its refresh token has ended" : "there is no refresh token to renew it with", kind: "nothing to renew with" }
  try {
    const next = await renew(site, a, async (n) => {
      try {
        await client?.auth?.set?.({ path: { id: site.id }, body: n })
      } catch {}
    })
    return next.access !== a.access ? { a: next } : { why: "renewing it gave the same token", kind: "unknown" }
  } catch (e) {
    if (refreshRefused(e)) {
      // spent by someone else, who saved what it gave
      const saved = await newer()
      if (saved) return { a: saved }
      return { why: `it refused the refresh token too (${e.said ?? e.message})`, kind: "refresh refused" }
    }
    return { why: `renewing it failed: ${e?.said ?? e?.message ?? e}`, kind: "unknown" }
  }
}

// gone says whether a sign-in reissued (r) couldn't renew is gone, on
// WorkBuddy's word: it turned the refresh token away, or refused the access
// token itself (tokenRefused, invalidToken) with none to renew it with. A
// desktop sign-in never is: the app's file is read on each request, and
// signing in to the app again is all it takes.
const gone = (a, r, tokenRefused) =>
  a.source !== "desktop" && (r.kind === "refresh refused" || (r.kind === "nothing to renew with" && !!tokenRefused))

// refusedText says WorkBuddy refused a's sign-in, why it wasn't renewed,
// and what to do.
function refusedText(site, a, why, note) {
  return (
    `${site.name} refused this account's sign-in (401)${why ? "; " + why : ""}. ${note ? note + " " : ""}` +
    (a.source === "desktop"
      ? `Sign in to ${site.name} desktop again; magpie reads its sign-in on the next request.`
      : `Sign in to it again in magpie: Providers → ${site.name} → this account's Sign in again.`)
  )
}

// keyRefused is the answer to a request WorkBuddy refused an API key for
// (401): a key isn't renewed, so it says to check the key. Marked expired
// only on WorkBuddy's word that the token itself is refused (invalidToken).
function keyRefused(site, expired, note) {
  const message = `${site.name} refused this API key (401). ${note ? note + " " : ""}Check the key at ${site.keys}, then add it again in magpie: Providers → ${site.name}.`
  return new Response(JSON.stringify({ error: { message, type: "authentication_error", code: 401 } }), {
    status: 401,
    statusText: "Unauthorized",
    headers: { "content-type": "application/json", "X-Magpie-Sign-In": expired ? "expired" : "kept" },
  })
}

// signedOut is the answer to a request WorkBuddy refused this account's
// sign-in for, renewed or not: a 401 that says so and what to do, which
// WorkBuddy's own (an HTML page, its {code, msg}) doesn't. expired marks
// the account in magpie (X-Magpie-Sign-In), out of routing and "sign in
// again" on its row, till it is signed in again; else it is kept.
function signedOut(site, a, why, expired, note) {
  const message = refusedText(site, a, why, note)
  return new Response(JSON.stringify({ error: { message, type: "authentication_error", code: 401 } }), {
    status: 401,
    statusText: "Unauthorized",
    headers: { "content-type": "application/json", "X-Magpie-Sign-In": expired ? "expired" : "kept" },
  })
}

// meter asks the billing API as magpie's built-in did, its errors said
// the same: WorkBuddy's message, else its code, else the HTTP status.
async function meter(site, a, path, body = {}) {
  const res = await meterAsked(site, a, path, body)
  const raw = await res.text()
  let env = {}
  let parsed = true
  try {
    env = JSON.parse(raw) ?? {}
  } catch {
    parsed = false
  }
  if (res.ok && !parsed) {
    const unreadable = raw.trim().slice(0, 120) || "(empty)"
    throw Object.assign(new Error(`unreadable reply ${unreadable}`), { status: res.status, code: 0, unreadable: true })
  }
  const code = Number.parseInt(env.code, 10) || 0
  // the status, the code and whether the token itself was refused go with
  // it, for usage's one renewal on a 401 (reissued) and check-in's outcomes
  const said = { status: res.status, code }
  if (!res.ok) said.invalidToken = invalidToken(res)
  const err = (message) => Object.assign(new Error(message), said)
  if (!res.ok) {
    if (code) throw err(env.msg || `error ${code}`)
    if (env.msg) throw err(env.msg)
    throw err(statusText(res.status))
  }
  if (code) throw err(env.msg || `error ${code}`)
  return env.data ?? null
}

// checkinOf claims the account's daily credits. China has the /v2 meter;
// after the activity status names an active, unchecked day. Transient
// upstream failures are asked again twice (the bounded retry quota-hub
// observed on the billing endpoint; callers may shorten the waits for a
// test).
async function checkinOf(site, a, { waits = [0, 0] } = {}) {
  let status
  try {
    status = await meter(site, a, "/v2/billing/meter/checkin-activity-status")
  } catch (e) {
    if (e?.code === 1001) return { outcome: "done" }
    // a reply WorkBuddy sent is the day's failed answer; only a request
    // that got no answer leaves as a throw, for magpie's offline backoff
    if (e?.status !== undefined || e?.code !== undefined) return { outcome: "failed", message: e.message }
    throw e
  }
  if (!status?.active) return { outcome: "inactive" }
  if (status.today_checked_in ?? status.todayCheckedIn) {
    // today_credit is what today actually gave, the built-in's word for a
    // day already in; daily_credit is the day's grant
    const credit = Number(status.today_credit ?? status.daily_credit)
    return { outcome: "done", ...(Number.isFinite(credit) && credit > 0 ? { credit } : {}) }
  }
  const paths = ["/v2/billing/meter/daily-checkin"]
  for (let attempt = 0; ; attempt++) {
    let i = 0
    while (i < paths.length) {
      try {
        const got = await meter(site, a, paths[i++])
        // the claim's own answer, as the built-in hands it on: the credit
        // and streak it granted and what it said, for the card
        const credit = Number(got?.credit)
        const streak = Number(got?.streak_days)
        return {
          outcome: "claimed",
          ...(Number.isFinite(credit) && credit > 0 ? { credit } : {}),
          ...(Number.isFinite(streak) && streak > 0 ? { streak } : {}),
          ...(got?.message ? { message: String(got.message) } : {}),
        }
      } catch (e) {
        if (e?.code === 1001) return { outcome: "done" }
        if (e?.code === 1002) return { outcome: "ineligible", message: e.message }
        if (e?.code === 1003) return { outcome: "inactive", message: e.message }
        if (e?.status === 401) {
          try {
            await meter(site, a, "/billing/meter/get-user-resource-summary")
          } catch {
            throw e
          }
          return { outcome: "ineligible", message: "WorkBuddy's check-in takes WorkBuddy's own app" }
        }
        if (e?.unreadable) return { outcome: "failed", message: `check-in: ${e.message}` }
        const transient = e?.status >= 500 || e?.code === 10000
        if (transient && attempt < waits.length) {
          await new Promise((r) => setTimeout(r, waits[attempt]))
          break
        }
        // a reply WorkBuddy sent is the day's failed answer; only a request
        // that got no answer leaves as a throw, for magpie's offline backoff
        if (e?.status !== undefined || e?.code !== undefined) return { outcome: "failed", message: e.message }
        throw e
      }
    }
  }
}

// capacity is a capacity the billing API sends, as a string ("438.88")
// or now and then a number; empty is 0.
function capacity(v) {
  if (v == null || v === "") return 0
  if (typeof v === "number") return v
  const s = String(v)
  const n = Number(s)
  if (s.trim() !== s || Number.isNaN(n)) throw new Error(`strconv.ParseFloat: parsing ${JSON.stringify(s)}: invalid syntax`)
  return n
}

// compact is a count as magpie says one: whole, else to two places.
const compact = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""))

// The window WorkBuddy AI rate limits its free models by, which its credit
// meter does not show.
//
// A free account's usage() reports only the credits window, so a plan with
// 160 credits untouched reads 0% while chats to deepseek-v4.1-flash are
// already refused: the model has a token allowance of its own, counted
// apart from credits, and nothing the vendor answers with reports it. The
// refusal is the only place it appears, and only as a time:
//
//   429 usage exceeds frequency limit, but don't worry, your usage will
//   reset at 2026-10-20 19:47:41 UTC+8, alternatively, you can switch to
//   the other models to continue using it.
//
// Measured on a free plan over ten days (one account, deepseek-v4.1-flash
// only), counting in + cache_read + out:
//
//   10-15 15:40 → 100,183,315  429      10-18 19:52 →  92,792,962  429
//   10-16 16:48 →  99,971,831  429      10-19 19:47 →  98,201,537  429
//   10-14 15:38 →  71,687,717  lapsed
//
// so the cap is per account per 24 hours at about 1e8 tokens, the largest
// value that still answered being 100,183,315. Three things about it are
// easy to get wrong and were all checked:
//
//   - cache_read counts. In + out alone is 20× smaller (0.75M–3.9M a
//     window) and never comes near the cap.
//   - the window is fixed, not sliding: peak trailing-24h over the same
//     data is 172.85M, which a sliding window would have held to 1e8.
//   - the reset a refusal names is the window's start + 24h exactly, and
//     the start is the first request answered after the previous window
//     ended — not the reset instant. Gaps of 6, 68, 80 and 182 minutes
//     were seen between a reset and the next request, each opening the new
//     window.
//
// deepseek-v4.1-flash-sg is the same model under its paid id (the product
// config's ModelRateLimitCap.lines[0] names it as paidId to this freeId,
// allowPaidSwitch: true) and draws on the same window: it was refused in
// the same windows, to the second, with about 0.01M tokens of its own.
// Both ids are named in models: magpie matches a plugin window's models
// against a model id exactly, folding only an @size suffix
// (internal/provider/plugin_usage.go, idSetOf), so one id alone leaves the
// other unrestricted.
//
// The window is read two ways, and a refusal wins:
//
//   - the sum (in + cache_read + out) of this machine's rows, which holds
//     until the account is first refused. The ledger is this machine's
//     only, so an account also used on another machine or through another
//     client reads short: 92.8M read as "93%" on one refused at 92,792,962,
//     the rest of its spending being elsewhere.
//   - a refusal whose named reset is still ahead, which makes the window
//     full whatever the sum says. That is the one exact signal there is,
//     and routing must not pass over it either.
//
// The ledger is magpie's own, in magpie's config folder (appdir.Config()):
// the folder the plugin host runs in, which is the portable data folder
// when magpie runs portable, $XDG_CONFIG_HOME/magpie when that is set, and
// ~/.config/magpie otherwise. No endpoint reports the window; a ledger that
// cannot be read yields no window rather than a made-up one.

const FREE_WINDOW_CAP = 1e8
const FREE_WINDOW_SPAN = 24 * 3600 * 1000
// The lead: how far back of an edge the read goes on. A chain read from a row
// that opens a window needs the window the span makes of the rows above it,
// so the rows kept reach a day past the edge — the window opening at the
// request after it, minutes to hours into that day, whatever the first row
// after the edge falls on.
const FREE_WINDOW_LEAD = 86400 * 1000
// A gap this long between two of this account's answered rows ends every
// window before it, so the later row opens one: the window holding the
// earlier row began at most 24h before it, and so ended 24h after it at the
// latest. This is one of the two edges the ledger itself spells out.
const FREE_WINDOW_GAP = FREE_WINDOW_SPAN
// the model the window is counted for; -sg shares it
const FREE_WINDOW_MODEL = "deepseek-v4.1-flash"
// both ids, so magpie's exact match finds the -sg one too
const FREE_WINDOW_MODELS = ["deepseek-v4.1-flash", "deepseek-v4.1-flash-sg"]
// the provider whose rows count
const FREE_WINDOW_PROVIDER = "workbuddy-ai"

// windowOffset is the UTC offset a refusal spells out, in minutes, from
// "UTC+8", "UTC+08:00", "UTC-5" or "GMT+8". null when it spells out none,
// which is not the same as +08:00: an offset guessed wrong puts the reset
// hours from where it is, so a reset that cannot be placed is not used as
// an edge at all.
function windowOffset(text) {
  const m = /\b(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/i.exec(String(text ?? ""))
  if (!m) return null
  const min = Number(m[2]) * 60 + Number(m[3] ?? 0)
  if (min > 14 * 60) return null
  return m[1] === "-" ? -min : min
}

// windowReset is the instant a refusal names, or NaN when it names none or
// names it in an offset that cannot be read.
function windowReset(text) {
  const s = String(text ?? "")
  const at = /reset at (\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!at) return NaN
  const off = windowOffset(s)
  if (off === null) return NaN
  return Date.UTC(+at[1], +at[2] - 1, +at[3], +at[4], +at[5], +at[6]) - off * 60000
}

// freeWindowOf is the window account is in now, from rows (magpie's usage
// records), or null when it has lapsed — the next request opens a new one.
// now is passed in so the reading is testable.
//
// The window is a chain: it begins at the first request answered after the
// previous one ended, so where this window began depends on every window
// before it. A window ends at a refusal's reset when the ledger holds one,
// and otherwise a day after it began. readLedgerTail (which see) stops on
// both, so that these rows read the same as the whole ledger.
function freeWindowOf(rows, account, now = Date.now()) {
  const mine = (Array.isArray(rows) ? rows : []).filter(
    (r) =>
      r?.provider === FREE_WINDOW_PROVIDER &&
      r.providerAccount === account &&
      typeof r.model === "string" &&
      r.model.startsWith(FREE_WINDOW_MODEL) &&
      r.t,
  )
  if (!mine.length) return null

  const at = (r) => {
    const t = Date.parse(r.t)
    return Number.isFinite(t) ? t : 0
  }
  const counted = (r) => (r.in ?? 0) + (r.cache_read ?? 0) + (r.out ?? 0)
  // two rows a day apart: the first of them opened a window that has ended by
  // the second. Written as a function so that no minifier folds the
  // subtraction into the comparison.
  const apart = (a, b) => a - b >= FREE_WINDOW_SPAN

  // a refusal names the end of the window it refused in
  const edges = []
  for (const r of mine) {
    if (Number(r.status) !== 429) continue
    const t = windowReset(r.err)
    if (Number.isFinite(t)) edges.push(t)
  }
  edges.sort((a, b) => a - b)

  const answered = mine.filter((r) => Number(r.status) === 200 && at(r) > 0).sort((a, b) => at(a) - at(b))
  if (!answered.length) return null

  const head = (from) => {
    let start = null
    let used = 0
    let edge = 0 // the refusals already read
    for (let i = from; i < answered.length; i++) {
      const r = answered[i]
      const t = at(r)
      // every refusal this row's window ended at closes it
      while (edge < edges.length && edges[edge] <= t) {
        start = null
        used = 0
        edge++
      }
      if (start === null) start = t
      else if (apart(t, start)) {
        start = t
        used = 0
      }
      used += counted(r)
    }
    return start === null ? null : { start, used }
  }

  // The rows may begin before the window now: readLedgerTail goes a day past
  // the edge it stops at, so the run of rows that opens a window can start a
  // day after the first row kept. That window opens at a row with no answered
  // row of this account's within a day before it — where the chain is read
  // from. Read from the first row kept, the chain would begin shifted, a day
  // early: every window after it, the card with it.
  let w = null
  for (let i = 0; i < answered.length; i++) {
    if (i && !apart(at(answered[i]), at(answered[i - 1]))) continue
    const h = head(i)
    if (h === null) continue
    if (h.start + FREE_WINDOW_SPAN <= now) continue // lapsed before now
    w = h
    break
  }
  const start = w?.start
  const used = w?.used
  if (!(start > 0)) return null

  const end = start + FREE_WINDOW_SPAN
  if (now >= end) return null // lapsed: nothing is exhausted, a new window opens on the next request

  const card = (amount, resetsAt, refused) => ({
    name: "Free model tokens",
    used: Math.min(100, (100 * amount) / FREE_WINDOW_CAP),
    amount,
    limit: FREE_WINDOW_CAP,
    unit: "tokens",
    display: `${tokensShort(amount)} / 100M`,
    resetsAt: new Date(resetsAt).toISOString(),
    span: FREE_WINDOW_SPAN / 1000,
    models: FREE_WINDOW_MODELS.slice(),
    ...(refused ? { refused: true } : {}),
  })

  // A refusal still in force is exact: the account is spending this window
  // from elsewhere too, so the sum undercounts it, and the refusal is the
  // answer the vendor would give again. Its reset is the window's end,
  // named by the vendor rather than derived from start.
  let live = null
  for (const r of mine) {
    if (Number(r.status) !== 429) continue
    const t = windowReset(r.err)
    if (!Number.isFinite(t) || t <= now || t <= start) continue
    if (live === null || t > live) live = t
  }
  if (live !== null) return card(FREE_WINDOW_CAP, live, true)

  return card(used, end, false)
}

// tokensShort says a token count small: 11.9M, 812k. The credits card's
// compact() (2 decimals, credited to credits) reads a token count badly.
function tokensShort(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(Math.round(n))
}

// ledgerParsed is the rows read last and what they were read for: the file's
// fingerprint, the account and the instant. A file that has not changed hands
// back the rows already parsed rather than reading and decoding them again.
//
// Reading the ledger whole was 48 ms on 2026-10-21 (10.3 MiB, 17925 lines:
// 6.4 ms to read, 32.8 ms to JSON.parse, 8 ms to find the window), spent
// synchronously on the plugin host's thread every time a panel opened or a
// card was asked about, which is what made the free-token window feel slow
// beside the credits, whose reading is a network call and so blocks nothing.
// A heavy ledger runs to hundreds of MiB, so the read starts at the end.
//
// The key carries the account because the rows are this account's: one
// account's read must not answer for another's. A read for an earlier instant
// keeps all the rows a read for a later one would — the bounds are only
// further back, and an edge is the same time in either — so the rows held
// over answer for the later one too: freeWindowOf is what decides with its
// own now.
let ledgerParsed = null

// ledgerBad is the number of whole lines the ledger last had that could
// not be decoded, and the file it was read from, so that a ledger read
// once and read again is complained about once, not on every panel open.
let ledgerBad = { key: "", count: 0 }

// freeWindowLedger is the ledgers looked for, in magpie's own folder order
// (appdir.Config()): the plugin host runs in that folder — the portable
// data folder when magpie runs portable, $XDG_CONFIG_HOME/magpie when that
// is set, ~/.config/magpie otherwise — so its cwd answers first; the other
// two are named as well, for a plugin asked outside the host. The first
// readable ledger wins: a stale copy in a folder magpie does not use must
// not hide the live one.
//
// $XDG_CONFIG_HOME counts only when it is absolute, as appdir.rooted has it:
// an empty or relative value is not where magpie keeps its ledger.
function freeWindowLedger(cwd = process.cwd(), env = process.env, home = homedir()) {
  const dirs = [cwd]
  if (env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)) dirs.push(join(env.XDG_CONFIG_HOME, "magpie"))
  if (home) dirs.push(join(home, ".config", "magpie"))
  return dirs.map((d) => join(d, "usage.jsonl"))
}

// freeWindowRows reads magpie's usage ledger for account, oldest row first.
// null when no ledger can be read: the window is then left unknown rather
// than guessed.
//
// The ledger is appended to a line at a time, so a read that lands while a
// call is being written can catch that line half-written. Only the last
// line can be torn that way (everything before it was written whole), and
// only it is passed over in silence. A whole line in the middle that won't
// decode is a real fault — a truncated file, a writer that lost a record —
// and is said aloud, because passing it over quietly is how a window goes
// missing with nothing to point at: on 2026-10-21 a restart caught the
// ledger mid-write, the one row holding the free window's start was
// dropped without a word, and the panel showed no window at all until the
// next read happened to succeed.
function freeWindowRows(account, now = Date.now(), cwd = process.cwd(), env = process.env, home = homedir()) {
  if (!account) return null
  let found = null
  for (const path of freeWindowLedger(cwd, env, home)) {
    try {
      const st = statSync(path)
      if (!st.size) continue
      found = { path, st }
      break
    } catch {}
  }
  if (!found) return null
  const { path, st } = found
  // size and mtime both move when a call is appended, which is the only
  // way this ledger is written; one rewritten in place (a rotation or a
  // compaction) moves mtime even when its size lands the same.
  const file = path + "|" + st.mtimeMs + ":" + st.size
  const key = file + "|" + account
  if (ledgerParsed?.key === key) return ledgerParsed.rows
  let got
  try {
    got = readLedgerTail(path, st, now, undefined, account)
  } catch {
    return null
  }
  if (got.bad && ledgerBad.key !== file) {
    ledgerBad = { key: file, count: got.bad }
    console.error(
      `workbuddy: ${got.bad} whole line${got.bad === 1 ? "" : "s"} of ${path} could not be decoded ` +
        `(not the last line, so not a write in progress); the free-token window may read short`,
    )
  }
  ledgerParsed = { key, rows: got.rows }
  return got.rows
}

// LEDGER_T is where a row's time sits: "t" is among the first keys
// usage.Record writes, within this many bytes of the line's start, so every
// line's time is read without decoding the line — most of a ledger's lines
// belong to another provider, or to this account and out of reach.
const LEDGER_T = /"t"\s*:\s*"([^"]{10,64})"/

// LEDGER_ACCOUNT finds the account a line was written under, before the line
// is decoded. usage.Record writes providerAccount second.
const LEDGER_ACCOUNT = /"providerAccount"\s*:\s*"([^"]{0,256})"/

// rowTime is the instant a line is written at, from that "t", or NaN.
function rowTime(line) {
  const m = LEDGER_T.exec(line)
  return m ? Date.parse(m[1]) : NaN
}

// LEDGER_REPORTED finds what a client reported: POST /v1/magpie/usage/requests
// (#1874) appends a client's own calls to the same ledger, with the time the
// client gives them, and a past time is kept on purpose so history can be
// backfilled (docs/integrating.md). Such a row is written at the end of the
// file and dated anywhere, so it says nothing about where the file's own
// records have got to — magpie's index leaves it out of firstOwn for the same
// reason (log_index.go). It never carries providerAccount, being not in
// ingestFields, so it is never a row of this account either.
const LEDGER_REPORTED = /"source"\s*:\s*"reported"/

// rowReported is whether a line is one a client reported rather than one
// magpie wrote when it happened.
function rowReported(line) {
  return LEDGER_REPORTED.test(line)
}

// rowAccount is the account a line was written under, or null when the line
// names none (another record, or one cut short).
function rowAccount(line) {
  const m = LEDGER_ACCOUNT.exec(line)
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return null
  }
}

// ofAccount is whether a row belongs to the chain read for account: this
// account's own row of the free model, either id. A refusal of another
// account's, or of a paid model, says nothing about where this chain opens.
function ofAccount(row, account) {
  return (
    row?.provider === FREE_WINDOW_PROVIDER &&
    row.providerAccount === account &&
    typeof row.model === "string" &&
    row.model.startsWith(FREE_WINDOW_MODEL)
  )
}

// readLedgerTail decodes the ledger from its end backwards, and stops where
// the chain of account's own rows can still be read from. chunks is a test's
// way of counting reads; nothing else passes it.
//
// Why it cannot stop at 48h: the window is a chain — each one starts at the
// first request answered after the previous one ended — so where the window
// now began depends on every window before it. A first row that is not an
// edge opens the window in the middle of a real one and every window after
// it is shifted: 4% on an account two hours from its cap, or 100% on one
// still served, which routing would then pass over. So the read goes back
// until the rows it keeps read the window now as the whole ledger does:
//
//   - a refusal of this account's, whose reset can be read: the window it
//     named ended there, and the next request opened another;
//   - a gap of 24h or more between two of this account's answered rows: the
//     window holding the earlier one has ended by then, and the later one
//     opens one;
//   - and with neither, it reads to the file's start, where the chain has no
//     earlier window to be shifted by.
//
// Each edge is passed by a day (FREE_WINDOW_LEAD), the window opening at the
// request after it, minutes to hours into the day.
//
// Two bounds keep that from being a whole file on every poll, and neither
// depends on how busy the account is:
//
//   - the ledger is appended in time order, so a line whose time is under the
//     edge — of whatever provider, of whatever account — ends the read;
//   - a read that is past now - 24h with no answered free-model row of this
//     account has nothing to report: the window has lapsed, and freeWindowOf
//     says null. It stops there rather than going on to the edges.
//
// Every line's time is read from its "t" before the line is decoded, so a
// line of another provider or account costs one match and no JSON.parse.
//
// What is not covered: magpie's providerAccount is the account's label, and a
// label two accounts share gets its slot added to it (pluginLabels,
// plugin_accounts.go). The label then no longer equals the accountId rows are
// written under, no row is found for this account at all, and the card
// reports no free window.
function readLedgerTail(path, st, now, chunks, account) {
  const CHUNK = 1 << 16
  const lapsed = now - FREE_WINDOW_SPAN // a read past this holds no window now
  const fd = openSync(path, "r")
  try {
    // a ledger whose last byte ends a line has no line being written
    let tornEnd = false
    if (st.size > 0) {
      const one = Buffer.allocUnsafe(1)
      readSync(fd, one, 0, 1, st.size - 1)
      tornEnd = one[0] !== 0x0a
    }
    const rev = [] // the rows kept, latest first
    let bad = 0
    let pos = st.size
    let carry = ""
    let firstPass = true
    let stop = false
    let chain = [] // this account's own rows read, latest first
    let reach = 0 // the row below which nothing is kept: 0 until an edge is found
    let answered = false // whether an answered free-model row of it is read

    while (pos > 0 && !stop) {
      const len = Math.min(CHUNK, pos)
      pos -= len
      const buf = Buffer.allocUnsafe(len)
      readSync(fd, buf, 0, len, pos)
      if (chunks) chunks(1)
      const lines = (buf.toString("utf8") + carry).split("\n")
      carry = lines.shift() // its first line is begun in an earlier chunk
      for (let i = lines.length - 1; i >= 0 && !stop; i--) {
        const line = lines[i]
        if (!line.trim()) continue
        const t = rowTime(line)
        // Under an edge or the bound, by time alone: nothing below it can be
        // kept, whatever wrote it — but a line a client reported is dated
        // where the client's call happened, not where the file has got to.
        const dated = Number.isFinite(t) && !rowReported(line)
        if (dated && reach && t < reach) {
          stop = true
          break
        }
        // A day back with nothing of this account's answered and no edge in
        // reach: no window is being spent now, and nothing below can open one
        if (dated && !reach && !answered && t < lapsed) {
          stop = true
          break
        }
        // Another provider's or another account's line: nothing else to see
        if (!line.includes(account) || rowAccount(line) !== account) continue
        let row
        try {
          row = JSON.parse(line)
        } catch {
          // the last line may be a call still being written, and is passed
          // over; anything before it is a fault worth saying
          if (!(firstPass && tornEnd && i === lines.length - 1)) bad++
          continue
        }
        if (!ofAccount(row, account)) continue
        rev.push(row)
        chain.push(row)
        if (Number(row.status) === 200) answered = true
        if (!reach && Number(row.status) !== 429) reach = pinned(chain, account)
      }
      firstPass = false
    }
    // the file's first line, with no newline before it: kept only when the
    // read ran to the file's start
    if (!stop && pos === 0 && carry.trim() && carry.includes(account) && rowAccount(carry) === account) {
      const t = rowTime(carry)
      if (!reach || !Number.isFinite(t) || t >= reach) {
        try {
          const row = JSON.parse(carry)
          if (ofAccount(row, account)) rev.push(row)
        } catch {
          bad++
        }
      }
    }
    return { rows: rev.reverse(), bad }
  } finally {
    closeSync(fd)
  }
}

// pinned is where the chain of account's own rows (latest first) is read
// from: the time below which nothing is kept. 0 while the rows say nothing
// about it yet, and the read then goes to the file's start.
//
// A row whose time cannot be read is passed over rather than ending the
// chain there: one corrupt line used to cut it wherever it sat.
function pinned(rows, account) {
  const at = (r) => Date.parse(r?.t)
  const apart = (a, b) => a - b >= FREE_WINDOW_GAP
  // A refusal names where a window ended, and the next request opened
  // another. The loop walks oldest to newest and overwrites `denied`, so the
  // one kept is the *newest* readable refusal in the chain, not the earliest:
  // a later refusal is nearer to now, and its reset is the tighter bound on
  // where the chain can be read from. A refusal whose reset has already been
  // passed by a newer one therefore loses, which is what we want — the old
  // `reset < newest` test that used to guard this is gone, the overwrite does
  // the same job and keeps the latest.
  let denied = null
  for (let i = rows.length - 1; i >= 0; i--) {
    const reset = Number(rows[i]?.status) === 429 ? windowReset(rows[i].err) : NaN
    if (Number.isFinite(reset)) denied = reset
  }
  if (denied !== null) return denied - FREE_WINDOW_LEAD
  // A day's gap between two answered rows ended every window before it, and
  // the day before the later row is where the span's reading of the rows
  // above it begins. The rows come latest first, so each is compared with the
  // one read before it — the row after it in time, `later`.
  let later = null
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    const t = at(r)
    if (!Number.isFinite(t)) continue
    if (Number(r.status) !== 200) continue
    if (later === null) {
      later = t
      continue
    }
    if (apart(t, later)) return later - FREE_WINDOW_LEAD
    later = t
  }
  // no edge among these rows: the read goes on to the file's start, which is
  // the whole ledger — the only place a chain needs nothing before it
  return 0
}

// _internal is where these are handed to a test: magpie's host calls every
// exported function of a plugin as one of its own factories (host.js,
// servers()), so freeWindowRows et al. must not be exports of the plugin.

// usageOf is the account's credits, from its resource summary: the plan's
// credits used against what the cycle grants, as magpie's built-in said —
// the count itself too (amount of limit, in credits), for magpie to say it
// as used or left beside the share (magpie#659). The free plan is said as a
// plan: "Free" alone beside the account read as the model being free, and
// routing as preferring it for that (#337).
//
// A package with no CycleTotalCapacity has no denominator: it is sent as
// magpie's balance-shaped window (#3950), {balance, unit} with no used,
// limit or aside, and routing ranks it by what is left. A literal "0" total
// is still a total, not a wallet: it stays on the old path, so a lapsed or
// placeholder package adds nothing. A literal "0" remainder is a reading
// of nothing left, not an absent field; only a package with no
// CycleRemainCapacity at all leaves the window out. TotalCredits is not a
// fallback: an account with no packages at all keeps its unknown allowance,
// as before, so its free models are not skipped.
function usageOf(sum, plan) {
  const out = { plan: plan || (sum?.IsPaidUser ? "Pro" : "Free plan"), windows: [] }
  let total = 0, used = 0, left = 0, bags = 0
  for (const p of sum?.Packages ?? []) {
    const hasTotal = p?.CycleTotalCapacity != null && p.CycleTotalCapacity !== ""
    if (hasTotal) {
      total += capacity(p.CycleTotalCapacity)
      used += capacity(p?.CycleUsedCapacity)
    } else if (p?.CycleRemainCapacity != null && p.CycleRemainCapacity !== "") {
      left += capacity(p.CycleRemainCapacity)
      bags++
    }
  }
  if (total > 0) out.windows.push({ name: "Credits", used: (100 * used) / total, display: `${compact(used)} / ${compact(total)}`, amount: used, limit: total, unit: "credits" })
  if (bags > 0 && (total === 0 || left > 0)) out.windows.push({ name: "Prepaid credits", balance: left, display: `${compact(left)} credits`, unit: "credits" })
  return out
}

// enterpriseUsageOf is an enterprise (team) account's credits, from
// /billing/meter/get-enterprise-user-usage, the meter WorkBuddy's own usage
// page (www.workbuddy.cn/profile/usage) reads for one (magpie #1904,
// CnsMaple): the resource summary answers such an account with no
// packages at all. It counts the cycle's credits flat — credit used of
// limitNum — and when the cycle began and resets (UTC+8). null when it
// grants none.
function enterpriseUsageOf(u) {
  const limit = capacity(u?.limitNum)
  if (!(limit > 0)) return null
  const used = capacity(u?.credit)
  const w = { name: "Credits", used: (100 * used) / limit, display: `${compact(used)} / ${compact(limit)}`, amount: used, limit, unit: "credits" }
  const at = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v.trim()) ? Date.parse(v.trim().replace(" ", "T") + "+08:00") : 0)
  const reset = at(u?.cycleResetTime), start = at(u?.cycleStartTime)
  if (reset > 0) w.resetsAt = new Date(reset).toISOString()
  if (reset > start && start > 0) w.span = (reset - start) / 1000
  return w
}

// spareFree has the credits windows not count the models that cost none
// (notModels): a model at x0.00 draws no credits, and with the credits
// used up WorkBuddy still serves it (deepseek-v4.1-flash at 560 / 560,
// magpie-community/plugins#138, hheei). Counted, the window at 100% put
// the account last, and behind every other, for its free models too. A
// model free only some hours (a night promotion) is not free here, as in
// the list (priceOf). A list that can't be read leaves the windows as they
// are: every model counted, as before.
async function spareFree(site, a, windows) {
  if (!windows.length) return windows
  let free = []
  try {
    free = (await liveModels(site, a)).filter((m) => m.free).map((m) => m.id)
  } catch {}
  if (free.length) for (const w of windows) w.notModels = free
  return windows
}

// The packages' codes, as WorkBuddy's own client lists them when it asks
// for each package's credits (its COMMODITY_CODES): the API refuses a
// detail list without them (10001 "PackageCodes required").
const CODE = (n, s) => `TCACA_code_${n}_${s}`
const PAID_CODES = [CODE("002", "AkiJS3ZHF5"), CODE("005", "maRGyrHhw1"), CODE("003", "FAnt7lcmRT"), CODE("023", "4xbGhMrE6q"),
  CODE("026", "BaESVICNoi"), CODE("027", "0FCGVA6vSa"), CODE("009", "0XmEQc2xOf"), CODE("038", "OhvqZtiPKr"), CODE("036", "lupO5WgNdG")]
const DAILY_CODE = CODE("001", "PqouKr6QWV")
const FREE_CODES = [DAILY_CODE, CODE("008", "cfWoLwvjU4"), CODE("035", "ArVxJcGDsm"), CODE("006", "DbXS0lrypC"), CODE("039", "KRcQj7wUat"),
  CODE("040", "mi9rCYg46x"), CODE("007", "nzdH5h4Nl0"), CODE("028", "NtpWi0jzXs"), CODE("037", "WxOD3MpI2o"), CODE("029", "6wCGEWquYy"),
  CODE("030", "BjSt89qTvr")]
// a slice package (CapacityType 4) is refreshed each day: its credits are
// lost at the same midnight on every account, so they tell none apart
const SLICE = "4"

// beijing is WorkBuddy's own time ("2026-10-13 00:39:27" is UTC+8, as its
// DeductionEndTime for the same package says).
const beijing = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ")

// packagesOf is every package of the account with credits, paid and free,
// as WorkBuddy's client asks for them: active and used-up (Status 0, 3),
// up to 10 pages of 200.
async function packagesOf(site, a, now = Date.now()) {
  const day = beijing(now).slice(0, 10)
  const lists = [
    ["/billing/meter/get-user-resource-paid-packages", { PackageCodes: PAID_CODES, NeedRenewInfo: true }],
    ["/billing/meter/get-user-resource-free-packages", { PackageCodes: FREE_CODES, SlicePeriodStartTime: day + " 00:00:00", SlicePeriodEndTime: day + " 23:59:59" }],
  ]
  const out = []
  for (const [path, extra] of lists) {
    for (let page = 1; page <= 10; page++) {
      const d = await meter(site, a, path, { PageNumber: page, PageSize: 200, Status: [0, 3], ...extra })
      const got = d?.Accounts ?? []
      out.push(...got)
      if (got.length < 200 || out.length >= (d?.TotalCount ?? 0)) break
    }
  }
  return out
}

// endOf is when a package's credits are lost: its DeductionEndTime, else
// ExpiredTime, else the cycle's end (UTC+8), as WorkBuddy's client reads it.
function endOf(p) {
  const ms = Number(p?.DeductionEndTime)
  if (ms > 0) return ms
  for (const v of [p?.ExpiredTime, p?.CycleEndTime]) {
    if (typeof v !== "string" || !v.trim()) continue
    const t = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v.trim()) ? Date.parse(v.trim().replace(" ", "T") + "+08:00") : Date.parse(v)
    if (t > 0) return t
  }
  return 0
}

// runsOutOf is the soonest moment credits left in one of the account's
// packages are lost, and how many (cdredfox on X): smart routing spends
// the account whose credits expire first. Only packages the summary
// counts, with credits left, and not the daily slice; null when none.
function runsOutOf(sum, packages, now = Date.now()) {
  const counted = new Set((sum?.Packages ?? []).map((p) => p?.PackageCode))
  let at = 0, amount = 0
  for (const p of packages ?? []) {
    if (!counted.has(p?.PackageCode) || p?.PackageCode === DAILY_CODE || String(p?.CapacityType) === SLICE) continue
    const left = capacity(p?.CycleCapacityRemainPrecise ?? p?.CycleCapacityRemain)
    const end = endOf(p)
    if (!(left > 0) || end <= now) continue
    if (!at || end < at) at = end, amount = left
    else if (end === at) amount += left
  }
  return at ? { runsOutAt: new Date(at).toISOString(), runsOut: amount } : null
}

// cycleOf is when the plan's credits start again, as WorkBuddy's own client
// says it (getCurrentPlan's refreshAt): the cycle end of the package the
// summary names as the subscription (SubscriptionPackageCode), in UTC+8,
// with how long the cycle is. Without it the card had used credits and no
// reset, and magpie said "Not used yet" beside 46% (windy on Discord,
// 2026-10-26). null when the subscription isn't in the lists, or its cycle
// is over.
function cycleOf(sum, packages, now = Date.now()) {
  const code = sum?.SubscriptionPackageCode
  const at = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v.trim()) ? Date.parse(v.trim().replace(" ", "T") + "+08:00") : 0)
  const of = (p) => {
    const end = at(p?.CycleEndTime), start = at(p?.CycleStartTime)
    if (!(end > now)) return null
    return { resetsAt: new Date(end).toISOString(), ...(start > 0 && start < end ? { span: (end - start) / 1000 } : {}) }
  }
  // A summary that does name one goes by it alone: named and not listed, or
  // its cycle over, is unknown — a paid plan's cycle is its subscription's,
  // never the slice's (yetone, #415).
  if (code) {
    for (const p of packages ?? []) if (p?.PackageCode === code) return of(p)
    return null
  }
  // A free account's summary names no subscription at all: both sites answer
  // SubscriptionPackageCode "" (copilot.tencent.com and www.workbuddy.ai,
  // measured 2026-10-26 on eight CN accounts and one AI one), so this
  // returned null and the card of an account whose credits are being spent
  // said nothing of when they come back — the one thing cycleOf is for.
  //
  // Its plan's own credits are the slice (CapacityType 4): packagesOf's
  // free list returns a month's plan_base with it, 00:00:00 to 23:59:59
  // UTC+8, the same cycle on every account on both sites (500 credits on
  // the CN site, 100 on the international), and its CycleEndTime is when
  // the plan gives the next month's back. A slice tells no account apart,
  // which is why runsOutOf keeps it out: which account to spend first is a
  // different question from when the plan refills.
  for (const p of packages ?? []) if (String(p?.CapacityType) === SLICE) return of(p)
  return null
}

// ---- models -----------------------------------------------------------------

// variants are the reasoning levels as OpenCode gives them to the AI SDK.
function variants(efforts) {
  return Object.fromEntries((efforts ?? []).map((e) => [e, { reasoningEffort: e }]))
}

// configModels is the site's own list as a provider's models, each on the
// API it is served on: a Claude model on Messages, the rest on chat.
function configModels(site) {
  return Object.fromEntries(site.models.map(([id, name, context, efforts]) => [id, {
    name,
    limit: { context, output: 0 },
    tool_call: true,
    // OpenCode (and magpie's host) read a config model's package and URL
    // from provider: { npm, api }, not api
    ...(nativeOf(site, id) ? { provider: { npm: NPM_MESSAGES, api: apiMessages(site) } } : {}),
    ...(efforts ? { reasoning: true, variants: variants(efforts) } : {}),
  }]))
}

function modelOf(site, provider, m) {
  return {
    id: m.id,
    providerID: provider.id,
    name: m.name,
    api: { id: m.id, url: nativeOf(site, m.id) ? apiMessages(site) : api(site), npm: nativeOf(site, m.id) ? NPM_MESSAGES : NPM },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: m.context ?? 0, output: m.output ?? 0 },
    capabilities: {
      temperature: true,
      reasoning: !!m.efforts?.length,
      attachment: !!m.images,
      toolcall: true,
      input: { text: true, image: !!m.images, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: variants(m.efforts),
    // magpie's own: served at no cost to the plan's credits
    free: !!m.free,
    // magpie's own: the credits a request costs, as a multiple (0: none)
    rate: m.rate ?? 0,
    // magpie's own: the price before a discount running now (0: none)
    rateWas: m.rateWas ?? 0,
  }
}

// liveModels asks WorkBuddy's product config for the plan's models: the
// "cli" agent's list, each with its details. The CLI User-Agent picks
// WorkBuddy's config (a bare WorkBuddy/<v> gets CodeBuddy IDE's, no cli).
// creditsOf reads a model's credits, the multiple WorkBuddy's picker shows
// by it: "x0.03", "0" or 0; "x0.00" is free. A rate it can't read (or
// none, or an infinite one) is undefined: the model is neither free nor
// rated. The same rule as magpie's built-in (wbCredits).
function creditsOf(c) {
  if (c == null || c === "") return undefined
  const s = String(c).trim().toLowerCase().replace(/\s+credits?$/, "").replace(/^x/, "")
  const n = Number(s)
  return s !== "" && Number.isFinite(n) && n >= 0 ? n : undefined
}

// freeCredits says whether a model's credits are none: "x0.00", "0" or 0.
// A rate it can't read is not free.
function freeCredits(c) {
  return creditsOf(c) === 0
}

// discountOf reads a promotion's price: its discountedCredits ("0.50x",
// "0.00x"), else the factor times the model's own credits.
function discountOf(p, base) {
  const said = creditsOf(String(p.discount?.discountedCredits ?? "").trim().replace(/x$/i, ""))
  if (said !== undefined) return said
  const f = Number(p.discount?.factor)
  return Number.isFinite(f) && f >= 0 && base !== undefined ? base * f : undefined
}

// running says whether a promotion is on at now: enabled, and inside its
// validFrom..validUntil. Its daily hours are not looked at here.
function running(p, now) {
  if (!p || p.enabled === false) return false
  const from = Date.parse(p.schedule?.validFrom ?? "")
  const until = Date.parse(p.schedule?.validUntil ?? "")
  return !(from > now) && !(until <= now)
}

// priceOf is a model's price as magpie keeps it, from its credits and the
// config's modelPromotions (what WorkBuddy's picker shows as 限时免费,
// 夜间免费, 夜间折扣). magpie keeps the list it is given until it asks
// again, so a price that holds only some hours of the day (Hy4 preview,
// free 23:00–8:00 only) is given as its full price, never as free: a list
// asked for at night would otherwise say "free" all day (#121). A discount
// for whole days (Step-5-Preview's 独家限免) is the price now, with the
// price before it as rateWas.
function priceOf(d, promotions, now = Date.now()) {
  const base = creditsOf(d.credits)
  const mine = (Array.isArray(promotions) ? promotions : []).filter(
    (p) => p?.kind === "discount" && Array.isArray(p.modelIds) && p.modelIds.includes(d.id) && running(p, now),
  )
  if (mine.some((p) => Array.isArray(p.schedule?.daily) && p.schedule.daily.length)) {
    // by the hour: the full price, which the credits are unless a night
    // discount already took them to its own price
    const night = mine.filter((p) => p.discount && Array.isArray(p.schedule?.daily) && p.schedule.daily.length)
    if (base === undefined || (base === 0 && night.some((p) => discountOf(p, base) === 0))) return { free: false }
    return { free: false, rate: base }
  }
  const off = mine.filter((p) => p.discount).map((p) => discountOf(p, base)).filter((r) => r !== undefined)
  if (off.length) {
    const r = Math.min(...off)
    return { free: r === 0, rate: r, ...(base !== undefined && base > r ? { rateWas: base } : {}) }
  }
  if (base === undefined) return {}
  return { free: base === 0, rate: base }
}

// effortsOf are the levels a config model takes. Most list them in
// reasoning.supportedEfforts; some (fast-model, deepseek-v4.1-flash, kimi-k3,
// gemini-3.5-flash … on both sites, plugins#255) say only supportsReasoning
// and a default reasoning.effort. Those take low, high and max (each
// reasoned under a real account, on four of them) and their own default.
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"]
function effortsOf(d, site, id) {
  const said = d.reasoning?.supportedEfforts
  if (Array.isArray(said) && said.length) {
    // A Claude model on Messages takes max though the config's list stops
    // at xhigh: measured 2026-10-24, output_config.effort "max" answered
    // 200 on each Claude model, and on claude-opus-5.5 with more thinking
    // than xhigh (11248 thinking tokens against 1999, one run each). How
    // much more a level gives varies by model and run; what matters here
    // is that a client picking max reaches the server as max, not xhigh.
    // On chat max means nothing more (see NPM_MESSAGES), so a model there
    // keeps what the config says.
    if (nativeOf(site, id) && !said.includes("max")) return [...said, "max"]
    return said
  }
  if (d.supportsReasoning !== true) return []
  const own = d.reasoning?.effort
  const set = new Set(["low", "high", "max", ...(typeof own === "string" && EFFORT_ORDER.includes(own) ? [own] : [])])
  return EFFORT_ORDER.filter((e) => set.has(e))
}

// isCompletion is whether a request is a chat completion: one to
// .../chat/completions, or, with no URL to read, a body holding a chat's
// messages. Nothing else the loader's fetch sends (magpie's drawings to
// /v2/images/*) is a chat: it goes neither gzipped nor given an effort.
function isCompletion(url, chat) {
  let path = ""
  try {
    path = new URL(String(url ?? "")).pathname
  } catch {}
  if (path) return /\/chat\/completions$/.test(path)
  return Array.isArray(chat?.messages)
}

// defaultEffortOf is the level WorkBuddy's own client asks a model for when
// the user picked none: its CLI's configureThinkingSettings (WorkBuddy
// 5.9.3, CLI 2.165.0) takes the session's effort, else the settings', else
// the config's reasoning.defaultEffort, else reasoning.effort, and sends it
// as reasoning_effort unless thinking was turned off. A request with no
// reasoning_effort is not thinking on WorkBuddy's side: measured 2026-10-28
// on www.workbuddy.ai, deepseek-v4.1-flash (defaultEffort "high") answered
// with 0 reasoning tokens without one, and thought at low and high
// (troilus1011 on X, OpenCode's default variant). A default the model's
// levels don't hold is left out, as the CLI clamps it to one they do.
function defaultEffortOf(d, efforts) {
  const own = d.reasoning?.defaultEffort ?? d.reasoning?.effort
  return typeof own === "string" && efforts.includes(own) ? own : undefined
}

// withDefaultEffort gives a chat that names no effort the model's default
// (defaultEffortOf), as WorkBuddy's client sends it; true when it did. An
// effort the client named, "none" too, goes as it came.
function withDefaultEffort(chat, list) {
  if (!chat || typeof chat !== "object" || namesEffort(chat)) return false
  const m = list?.find((x) => x.id === chat.model)
  if (!m?.effort) return false
  chat.reasoning_effort = m.effort
  return true
}

// namesEffort is whether a chat names its effort itself, in either spelling
function namesEffort(chat) {
  return chat.reasoning_effort !== undefined || (!!chat.reasoning && typeof chat.reasoning === "object" && chat.reasoning.effort !== undefined)
}

async function liveModels(site, a) {
  const headers = new Headers()
  sign(site, a, headers)
  headers.set("User-Agent", cliAgent(site))
  headers.set("X-Requested-With", "XMLHttpRequest")
  headers.set("Accept", "application/json")
  const res = await fetch(site.endpoint + "/v3/config", { headers, signal: AbortSignal.timeout(15000) })
  const env = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${site.name}'s config: HTTP ${res.status}`)
  if (env.code) throw new Error(`${site.name}'s config: ${env.msg} (${env.code})`)
  const cfg = env.data ?? {}
  const out = []
  for (const agent of cfg.agents ?? []) {
    if (agent.name !== "cli") continue
    for (const id of agent.models ?? []) {
      const d = (cfg.models ?? []).find((x) => x.id === id)
      const m = { id, name: d?.name || id }
      if (d) {
        m.context = d.maxInputTokens
        m.output = d.maxOutputTokens
        m.images = d.supportsImages === true && !textOnly(site, id)
        Object.assign(m, priceOf(d, cfg.modelPromotions))
        const es = effortsOf(d, site, id)
        if (es.length) {
          const canOff = d.reasoning?.canDisableThinking
          m.efforts = [...(!d.onlyReasoning && (canOff == null || canOff) ? ["none"] : []), ...es]
          const def = defaultEffortOf(d, es)
          if (def) m.effort = def
        }
      }
      out.push(m)
    }
  }
  // tell apart models the config names alike: deepseek-v4.1-flash and
  // deepseek-v4.1-flash-sg are both "Deepseek-V4.1-Flash"
  const first = new Map()
  for (const m of out) {
    const id = first.get(m.name)
    if (id === undefined) {
      first.set(m.name, m.id)
      continue
    }
    const rest = m.id.startsWith(id + "-") ? m.id.slice(id.length + 1) : ""
    m.name = `${m.name} (${rest ? rest.toUpperCase() : m.id})`
  }
  return out
}

// ---- the plugins --------------------------------------------------------------

// AFTER_TOOLS_REFUSED is WorkBuddy's 400 code 11153, "the conversation must
// end with a user message", which WorkBuddy AI's gemini-3.8-flash answers to a
// chat whose tool results are followed by the user's message (#113): Claude
// Code's reminders, a user's words sent mid-task, a tool's images, which
// magpie hands over in a user message after the results. It does end with a
// user message; the same chat with any other message between them is served.
// The code is matched whole, as with 14018.
const AFTER_TOOLS_REFUSED = /must end with a user message|["']code["']\s*:\s*["']?11153(?![\d.])/i

// replyAfterTools is a chat ending with tool results then the user's
// message(s), with an empty assistant message between them, as if the model
// had said nothing after the results. Tried with a real WorkBuddy AI
// account on 2026-10-14: gemini-3.8-flash serves it and follows the user's
// message as a user's, where folded into the tool's result it was read as
// the tool's output and its ask left undone. null for any other chat — one
// ending with the assistant's message is a prefill, refused as it is.
function replyAfterTools(body) {
  const b = chatOf(body)
  return replyAfterToolsOn(b) ? JSON.stringify(b) : null
}

// replyAfterToolsOn makes replyAfterTools's change on a chat's object; false
// for a chat it doesn't take
function replyAfterToolsOn(b) {
  const msgs = b?.messages
  if (!Array.isArray(msgs)) return false
  let i = msgs.length - 1
  while (i >= 0 && msgs[i]?.role === "user") i--
  if (i === msgs.length - 1 || i < 0 || msgs[i]?.role !== "tool") return false
  msgs.splice(i + 1, 0, { role: "assistant", content: "" })
  return true
}

// FREE_ONLY is the switch that keeps an account off credits (#430): its
// list holds only the models WorkBuddy serves at no cost (priceOf's free),
// and a request for any other is answered here, never sent. A price that
// can't be read is not free, and a list that can't be read sends nothing.
const FREE_ONLY = "free_only"
// PRICE_TTL is how long a list read for that check is used before it is
// read again: a promotion that ends stops counting as free within it.
const PRICE_TTL = 60_000

// notFree is the answer to a request the switch keeps from WorkBuddy. Its
// words say the model, not the account, is what is turned away, so magpie
// rests that model alone and asks another provider of it; they name no
// quota or credit, which would rest the whole account as out of credit.
function notFree(site, model, why) {
  const msg = why
    ? `${site.name}'s model list couldn't be read (${why}), so whether model ${model || "(none)"} is free is unknown; with "Free models only" on it isn't sent`
    : `model ${model || "(none)"} is not available while "Free models only" is on: ${site.name} charges for it. Turn the switch off in ${site.name}'s provider settings to use it`
  return new Response(JSON.stringify({ error: { message: msg, type: "invalid_request_error", code: why ? "free_only_unknown" : "model_not_found" } }), {
    status: why ? 503 : 404,
    headers: { "content-type": "application/json", "X-Magpie-Sign-In": "kept" },
  })
}

function makePlugin(site) {
  // the models of this site that refused tool results then the user's
  // message, for this run: their next chats go with replyAfterTools at once
  const endsAfterTools = new Set()
  // the system prompts this run WorkBuddy refused as an unapproved channel:
  // their next chats go with systemAsUser at once, not refused first
  const refusedSystems = new Set()
  return async ({ client, magpie }) => {
  // each account's list as last read, for FREE_ONLY: {at, list}
  const lists = new Map()
  const listKey = (a) => `${a.uid ?? ""}|${a.enterpriseId ?? ""}|${a.source === "key" ? a.key : ""}`
  // listed is the account's live list, read again past PRICE_TTL
  const listed = async (a, fresh = false) => {
    const k = listKey(a)
    const was = lists.get(k)
    if (!fresh && was && Date.now() - was.at < PRICE_TTL) return was.list
    const list = await liveModels(site, a)
    lists.set(k, { at: Date.now(), list })
    if (lists.size > 64) lists.delete(lists.keys().next().value)
    return list
  }
  // effortList is the list a chat's default effort is read from
  // (withDefaultEffort): listed's, or null when there is none to read — a
  // key WorkBuddy's CLI reads no config with (as models does), or a read
  // that failed within PRICE_TTL, so a config that can't be read costs a
  // chat one try a minute, not one each
  const unlisted = new Map()
  const effortList = async (a) => {
    if (a.source === "key" && !remoteConfig(a.key)) return null
    const k = listKey(a)
    if (Date.now() - (unlisted.get(k) ?? 0) < PRICE_TTL) return null
    try {
      return await listed(a)
    } catch {
      unlisted.set(k, Date.now())
      if (unlisted.size > 64) unlisted.delete(unlisted.keys().next().value)
      return null
    }
  }
  const freeOnly = () => magpie?.option?.(site.id, FREE_ONLY) === true
  // onlyFree is a list with the switch on: its free models, or a failure
  // when there are none to tell (magpie then keeps the list it had)
  const onlyFree = (ms) => {
    if (!freeOnly()) return ms
    const free = ms.filter((m) => m.free)
    if (!free.length) throw new Error(`${site.name} lists no free model, and "Free models only" is on`)
    return free
  }
  return {
    config: async (config) => {
      config.provider ??= {}
      config.provider[site.id] ??= {}
      const p = config.provider[site.id]
      p.name ??= site.name
      p.npm ??= NPM
      p.api ??= api(site)
      p.models = { ...configModels(site), ...(p.models ?? {}) }
    },
    // the conversation's id, which the chats below carry to WorkBuddy:
    // magpie's (or OpenCode's) session for this request, when it names one
    "chat.headers": async (input, output) => {
      const id = input?.model?.providerID ?? input?.provider?.info?.id
      if (id !== site.id || !input?.sessionID) return
      output.headers[SESSION] = String(input.sessionID).slice(0, 128)
    },
    provider: {
      id: site.id,
      // the account's own list, when it's signed in and WorkBuddy answers;
      // else the list above
      async models(provider, { auth }) {
        if (auth?.type === "api") {
          // asked as WorkBuddy's own CLI asks with a key (remoteConfig)
          const a = keyAccount(auth)
          if (!a || !remoteConfig(a.key)) {
            if (freeOnly()) throw new Error(`${site.name} lists no prices for this key, and "Free models only" is on`)
            return provider.models
          }
          let ms
          try {
            ms = await listed(a, true)
          } catch (e) {
            if (freeOnly()) throw e
            return provider.models
          }
          if (!ms.length && !freeOnly()) return provider.models
          return Object.fromEntries(onlyFree(ms).map((m) => [m.id, modelOf(site, provider, m)]))
        }
        if (auth?.type !== "oauth" || !(auth.access || auth.source)) return provider.models
        let ms
        try {
          const a = await current(site, client, auth)
          ms = await listed(a, true)
        } catch (e) {
          // with the switch on, a list without prices would offer models
          // that cost credits: the failure goes up, and magpie keeps the
          // list it had
          if (freeOnly()) throw e
          return provider.models
        }
        if (!ms.length && !freeOnly()) return provider.models
        return Object.fromEntries(onlyFree(ms).map((m) => [m.id, modelOf(site, provider, m)]))
      },
    },
    auth: {
      provider: site.id,
      // magpie renews a browser sign-in LEAD_MS before its end (an hour's
      // token), once for the account, before its requests, models and
      // usage ask; the check before each request stays for OpenCode,
      // which doesn't call this. Desktop's sign-in has no expiry stored
      // and is renewed as before.
      refreshLead: LEAD_MS,
      refresh: (auth) => refreshed(site, auth),
      // the account's daily check-in: magpie can run it once a day per
      // account, when its WorkBuddy check-in switch is on; the button in
      // Settings asks right away. China's meter only: the AI build has no
      // check-in (#47), so the hook stays off its plugin. Errors leave as
      // throws, not as failed answers: host.js answers a throwing hook to
      // magpie as an error, whose wbCheckinFailed keeps the offline words
      // and magpie's 1-minute backoff, where a returned failed waits the
      // full 30 minutes (magpie-community/plugins#149). checkinOf returns
      // an outcome only for answers it read and classified.
      ...(site.ai ? {} : {
        async checkin(getAuth) {
          const auth = await getAuth()
          // an API key reads no credits (see usage), so it has no day to claim
          if (auth?.type === "api") return { outcome: "ineligible", message: "check-in needs a signed-in account, not an API key" }
          if (auth?.type !== "oauth" || !(auth.access || auth.source)) return { outcome: "failed", message: "not signed in" }
          const a = await current(site, client, auth)
          return await checkinOf(site, a, { waits: [2000, 4000] })
        },
      }),
      options: [
        {
          key: FREE_ONLY,
          label: "Free models only",
          description: `Lists only the models ${site.name} serves at no cost, and turns away a request for any other here instead of sending it, so no credits are spent. A model free only at night counts as paid.`,
        },
      ],
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "oauth" && auth?.type !== "api") return {}
        return {
          // no baseURL: a model's own api.url says where it is served —
          // <endpoint>/v2 for a chat, <endpoint>/v1 for a Claude model on
          // Messages. A provider-wide base would put /messages under /v2.
          baseURL: "",
          apiKey: "",
          async fetch(input, init) {
            const stored = await getAuth()
            const keyed = stored?.type === "api" ? keyAccount(stored) : null
            if (stored?.type !== "oauth" && !keyed) throw new Error(`${site.name} isn't signed in`)
            let a = keyed ?? (await current(site, client, stored))
            const req = input instanceof Request ? input : null
            const headers = new Headers(init?.headers ?? req?.headers)
            headers.delete("authorization")
            headers.delete("x-api-key")
            headers.delete("content-length")
            const session = sessionOf(headers)
            sign(site, a, headers)
            let body = init?.body
            if (body === undefined && req) body = await req.clone().text()
            // An Anthropic request goes as the agent sent it: WorkBuddy
            // serves these models on Messages itself, and the rewrites
            // below (a default system message, the chat endpoint's
            // max_tokens spelling, tool shapes, the move of a refused
            // system prompt) exist for the chat endpoint alone. Claude
            // Code's own system prompt is taken there as it is — measured
            // 2026-10-24: the billing line, the "official CLI" line,
            // Codex's and DeepSeek Harness's openings all answer on
            // /v1/messages, where a chat is refused 11128.
            const native = isMessages(req ? req.url : String(input), body)
            // read once (prepared): nothing below parses the body again on
            // its way out, and nothing keeps the parsed chat once it is
            // written (plugins#461)
            let chat, changed, names
            ;({ body, chat, changed, names } = prepared(body, native))
            if (native) names = {}
            // the switch is checked before anything is sent: a model not
            // free, or one whose price can't be read, never reaches
            // WorkBuddy. The model is read off the chat parsed above; a body
            // prepared leaves unread (bytes on Messages) is read for it.
            if (freeOnly()) {
              const model = (chat ?? chatOf(typeof body === "string" ? body : bodyString(body)))?.model
              let list
              try {
                list = await listed(a)
              } catch (e) {
                return notFree(site, model, e?.message ?? String(e))
              }
              if (!list.some((m) => m.id === model && m.free)) return notFree(site, model)
            }
            // a chat that names no effort is asked at the model's default,
            // as WorkBuddy's client asks it (withDefaultEffort); with no
            // list to read (effortList) the chat goes as it came
            const completion = !native && isCompletion(req ? req.url : input, chat)
            if (completion && chat && !namesEffort(chat) && withDefaultEffort(chat, await effortList(a))) changed = true
            chatHeaders(site, headers)
            let who = scopeOf(a)
            let ids = attendChat(headers, chat, session, who)
            const post = (b) => {
              // a chat goes gzipped, as WorkBuddy's client sends it
              // (gzipped); its size on the wire is what unanswered weighs
              const z = gzipped(completion, b)
              if (z) headers.set("Content-Encoding", "gzip")
              else headers.delete("Content-Encoding")
              return fetch(req ? req.url : input, { ...init, method: init?.method ?? req?.method, headers, body: z ?? b }).catch((e) => unanswered(site, a, z ?? b, e, init?.signal))
            }
            // a 401 is answered once, on whichever try meets it: by a
            // sign-in with another access token (reissued), the request
            // sent once more with it, never again after that; else, or
            // when that is refused too, by signedOut. The body is a
            // string here (or bytes), which goes again as it is; one that
            // can't be read twice isn't sent again.
            //
            // The account is marked (expired) only on WorkBuddy's word
            // that the sign-in is gone: it turned the refresh token away,
            // or refused the access token itself (invalidToken) with none
            // to renew it with, or refused even the token just renewed. A
            // desktop sign-in is never marked: the app's file is read on
            // each request, so signing in to the app again is enough.
            let renewed = false
            const ours = new WeakSet() // the answers signedOut gave, passed on as they are
            const out = (why, expired, res) => {
              const r = signedOut(site, a, why, expired && a.source !== "desktop", edgeNotes.get(res))
              ours.add(r)
              return r
            }
            const resendable = (b) => b == null || typeof b === "string" || b instanceof ArrayBuffer || ArrayBuffer.isView(b)
            const send = async (b) => {
              const res = await post(b)
              if (res.status !== 401) return res
              if (renewed) return out("it refused the token renewed for it too", invalidToken(res), res)
              // a key isn't renewed: the 401 says the key was refused
              if (a.source === "key") {
                const r = keyRefused(site, invalidToken(res), edgeNotes.get(res))
                ours.add(r)
                return r
              }
              if (!resendable(b)) return res
              await res.body?.cancel().catch(() => {})
              const r = await reissued(site, client, getAuth, a, stored.access)
              if (!r.a) return out(r.why, gone(a, r, invalidToken(res)), res)
              renewed = true
              a = r.a
              sign(site, a, headers)
              ids = reattend(headers, ids, who, (who = scopeOf(a)))
              const again = await post(b)
              if (again.status !== 401) return again
              return out("it refused the token renewed for it too", invalidToken(again), again)
            }
            // a model known to turn tool results then the user's message away
            // gets the empty reply between them up front (see endsAfterTools)
            const model = chat?.model
            // a system prompt WorkBuddy refused before goes as the user's
            // words at once (see systemAsUser)
            const sysKey = native ? "" : systemKeyOf(chat)
            if (sysKey && refusedSystems.has(sysKey) && systemAsUserOn(chat)) changed = true
            // shaped is a body as such a model takes it. The first try's
            // is made on the chat already parsed, after the move above,
            // as shaped would make it of the body written; a resend with
            // the system prompt moved (below) is shaped again, and a body
            // that has the reply already is left as it is.
            const shaped = (b) => (!native && endsAfterTools.has(model) ? replyAfterTools(b) ?? b : b)
            if (!native && endsAfterTools.has(model) && replyAfterToolsOn(chat)) changed = true
            if (changed) body = JSON.stringify(chat)
            chat = null
            let res = await send(body)
            // a signature WorkBuddy's own signing didn't make — a session
            // moved here from another provider keeps its thinking blocks,
            // and a truncated or altered one reads the same way — is 11159
            // too, and none of them can be told apart from a good one
            // before sending. The request goes once more without them.
            // Measured 2026-10-24: another vendor's signature answers 11159
            // on its own, drop_block notwithstanding; without the block the
            // same history answers 200. Only when the history holds a
            // signature that isn't this route's own, so a session on this
            // route never sends twice.
            if (native && res.status >= 400) {
              const text = await res.text()
              const again = BAD_SIGNATURE.test(text) ? withoutSignedThinking(body) : null
              if (again) res = await send(again)
              else res = new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers })
            }
            if (res.status === 400 && !native) {              let text = await res.text()
              const moved = REFUSED.test(text) && sysKey && !refusedSystems.has(sysKey) ? systemAsUser(body) : null
              if (moved) {
                refusedSystems.add(sysKey)
                if (refusedSystems.size > 256) refusedSystems.delete(refusedSystems.values().next().value)
                body = moved
                res = await send(shaped(body))
                if (res.status === 400) text = await res.text()
              }
              const again = res.status === 400 && !endsAfterTools.has(model) && AFTER_TOOLS_REFUSED.test(text) ? replyAfterTools(body) : null
              if (again) {
                endsAfterTools.add(model)
                res = await send(again)
              } else if (res.status === 400) {
                res = new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers })
              }
            }
            if (ours.has(res)) return res
            // renewed here: a mark the account had comes off
            return res.status >= 400 ? explained(res) : kept(native ? res : await renamed(res, names), renewed ? "renewed" : "kept")
          },
        }
      },
      // the account's credits, as magpie's built-in showed them; each
      // read keeps the sign-in (signIn), as the built-in's neither marked
      // an account lapsed nor cleared it, but for a 401 (gone, below)
      async usage(getAuth) {
        const auth = await getAuth()
        // WorkBuddy's own CLI reads no credits with a key, and what the
        // billing API answers one is unknown, so a key's card says so
        if (auth?.type === "api") return { error: `credits unknown with an API key (WorkBuddy's own client reads none with one); see ${site.keys.replace(/\/profile\/keys$/, "")}`, signIn: "kept" }
        if (auth?.type !== "oauth" || !(auth.access || auth.source)) return { error: "not signed in", signIn: "kept" }
        try {
          let a = await current(site, client, auth)
          // the meter has no /v2 prefix, on either site
          const SUMMARY = "/billing/meter/get-user-resource-summary"
          // a 401 is answered as a chat's is: once, by a sign-in with
          // another access token, else the card says WorkBuddy refused
          // the sign-in and what to do; renewed, a mark comes off
          let said = "kept"
          let sum
          try {
            sum = await meter(site, a, SUMMARY)
          } catch (e) {
            if (e?.status !== 401) throw e
            const r = await reissued(site, client, getAuth, a, auth.access)
            if (!r.a) return { error: refusedText(site, a, r.why), signIn: gone(a, r, e.invalidToken) ? "expired" : "kept" }
            a = r.a
            try {
              sum = await meter(site, a, SUMMARY)
            } catch (e) {
              if (e?.status !== 401) throw e
              const why = "it refused the token renewed for it too"
              return { error: refusedText(site, a, why), signIn: a.source !== "desktop" && e.invalidToken ? "expired" : "kept" }
            }
            said = "renewed"
          }
          const out = usageOf(sum, auth.plan)
          // an enterprise account's summary has no packages: its credits
          // are the enterprise meter's (#1904). A personal account's
          // refusal of it (10001 "uid or enterpriseID is empty") leaves
          // the card as the summary said.
          if (!out.windows.length) {
            let ent = null
            try {
              ent = enterpriseUsageOf(await meter(site, a, "/billing/meter/get-enterprise-user-usage"))
            } catch {}
            if (ent) return { plan: auth.plan || "Enterprise", windows: await spareFree(site, a, [ent]), signIn: said }
          }
          // when the plan's credits start again (cycleOf), and when the credits
          // left run out, for routing to spend them first (runsOutOf);
          // a list that can't be read leaves it unknown, the card stands
          const credits = out.windows.find((w) => w.name === "Credits")
          if (credits) {
            try {
              const packages = await packagesOf(site, a)
              Object.assign(credits, cycleOf(sum, packages) ?? {}, runsOutOf(sum, packages) ?? {})
            } catch {}
          }
          await spareFree(site, a, out.windows)
          // the free model's own window, which the credit meter above does
          // not show: what actually refuses a chat long before 160 credits
          // are spent. WorkBuddy AI alone; the China build has no such cap
          // measured (see freeWindowOf)
          if (site.ai) {
            const account = a.accountId || a.user || a.uid || ""
            const rows = freeWindowRows(account)
            const w = rows && freeWindowOf(rows, account)
            if (w) out.windows.push(w)
          }
          return { ...out, signIn: said }
        } catch (e) {
          return { error: e?.message ?? String(e), signIn: "kept" }
        }
      },
      methods: [
        {
          type: "oauth",
          label: `${site.name} account (browser)`,
          authorize: () => browserSignIn(site),
        },
        {
          type: "oauth",
          label: `${site.name} desktop's sign-in`,
          authorize: async () => desktopSignIn(site),
        },
        {
          // a key made at site.keys, sent as WorkBuddy's CLI sends one
          // (keyAccount)
          type: "api",
          label: `${site.name} API key`,
          placeholder: `from ${site.keys.replace(/^https:\/\//, "")}`,
        },
      ],
    },
  }
  }
}

// REFUSED_HINT is what the user can do about WorkBuddy's "Illegal API
// invocation from an unapproved channel": both builds answer it to a chat
// holding words they turn away, whatever the headers. Codex's and Claude
// Code's were the first (magpie #182), DeepSeek Harness's and Claude
// Desktop's came later (#279, #170), and WorkBuddy reads every message, so
// it names no client. FLAGGED rewrites the words known; this is for ones it
// doesn't know. It ends the error's message word for word as magpie's
// Routing page has it (WB_REFUSED in its routing client.js), which says it
// apart from WorkBuddy's own words.
const REFUSED_HINT =
  "WorkBuddy refused words in this client's prompt (most often its system prompt); use it from Hermes, OpenCode or Pi, or add another provider to this group"
const REFUSED = /unapproved channel|illegal api invocation/i

// BAD_SIGNATURE is WorkBuddy's refusal of a thinking block whose signature it
// didn't make: internal code 11159, "Invalid `signature` in `thinking` block.
// The block is bound to a different conversation", else 11133 wrapping
// "thinking_signature_invalid: replay the original thinking block and
// signature unchanged".
const BAD_SIGNATURE = /thinking_signature_invalid|invalid\s+`?signature`?\s+in\s+`?thinking|block is bound to a different conversation|"internal_code"\s*:\s*"?11159/i

// RESTRICTED_HINT is what the user can do about WorkBuddy's 403 code 11140
// "request illegal", whose displayMsg says "Your account has been restricted
// due to unusual activity" (magpie #1849): the account is out until WorkBuddy
// lifts the restriction, which an appeal asks for. It ends the error's
// message as magpie's built-in puts it (provider.WBRestrictedHint), word for
// word, so magpie rests the account for hours rather than minutes.
const RESTRICTED_HINT =
  "WorkBuddy restricted this account for unusual activity; it stays out until WorkBuddy lifts that, which an appeal (Submit feedback in WorkBuddy) asks for"
const RESTRICTED_CODE = 11140
// The code is matched whole, as with 14018: 111400 is another error.
const RESTRICTED_TEXT = /account has been restricted due to unusual activity|账号存在异常行为|帳號存在異常行為|["']code["']\s*:\s*["']?11140(?![\d.])/i

// EXHAUSTED_HINT explains WorkBuddy's requirement of an active package
// even for 0-rate / free models. When an account has no packages or 0 credits,
// WorkBuddy returns code 14018 ("Credits exhausted...").
const EXHAUSTED_HINT =
  "WorkBuddy requires an active credit package even for 0-rate free models; check your account package balance"
// The code is matched whole: a code that only begins with 14018 (140185) is
// another error, and insufficient_quota would rest the account as out of credit.
const EXHAUSTED_TEXT = /credits exhausted|额度已用尽|["']code["']\s*:\s*["']?14018(?![\d.])/i

// kept is an answer that went through, saying the sign-in is kept (the
// built-in never cleared a WorkBuddy account's mark, as it never set one),
// or "renewed" when it went through on a sign-in renewed for a 401, which
// takes a mark off (see signedOut).
function kept(res, said = "kept") {
  const headers = new Headers(res.headers)
  headers.set("X-Magpie-Sign-In", said)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// explained is res with REFUSED_HINT, RESTRICTED_HINT or EXHAUSTED_HINT added to that refusal's message.
// Each refusal says the sign-in is kept: a 401 never comes here, it is
// signedOut's.
async function explained(res) {
  const text = await res.text()
  const again = (b) => {
    const headers = new Headers(res.headers)
    headers.delete("content-length")
    headers.delete("content-encoding")
    headers.set("X-Magpie-Sign-In", "kept")
    return new Response(b, { status: res.status, statusText: res.statusText, headers })
  }
  let v
  try {
    v = JSON.parse(text)
  } catch {}
  const at = v?.error && typeof v.error === "object" ? v.error : v && typeof v === "object" ? v : null
  // the Messages route words its code two more ways (seen 2026-10-24):
  // {"error": {"code": "400001", "internal_code": "11159", …}}, and
  // {"code": 11102, "error": "11158:…"}, the code that says what happened
  // first in a string error, where the outer one only says it failed
  const inner = at?.internal_code ?? (typeof v?.error === "string" ? v.error.match(/^(\d{5}):/)?.[1] : undefined)
  const codes = [inner, at?.data?.code, at?.code, v?.code, v?.data?.code].filter((c) => c != null).map(Number)
  const isRefused = REFUSED.test(text)
  const isRestricted = !isRefused && (codes.includes(RESTRICTED_CODE) || RESTRICTED_TEXT.test(text))
  const isExhausted = !isRestricted && (codes.includes(14018) || EXHAUSTED_TEXT.test(text))
  if (!isRefused && !isRestricted && !isExhausted) return again(text)

  let msg = text.trim()
  if (at && typeof at.message === "string") msg = at.message
  else if (typeof at?.data?.msg === "string") msg = at.data.msg
  else if (typeof v?.error === "string") msg = v.error
  else if (typeof v?.msg === "string" && v.msg) msg = v.msg // WorkBuddy's own {"code", "msg"}
  else if (typeof v?.data?.msg === "string") msg = v.data.msg

  const hint = isRefused ? REFUSED_HINT : isRestricted ? RESTRICTED_HINT : EXHAUSTED_HINT
  const type = isRefused || isRestricted ? "permission_error" : "insufficient_quota"
  const errCode = isRefused ? null : isRestricted ? RESTRICTED_CODE : 14018
  msg = `${msg} — ${hint}`
  const headers = new Headers(res.headers)
  headers.set("content-type", "application/json")
  headers.delete("content-length")
  headers.delete("content-encoding")
  headers.set("X-Magpie-Sign-In", "kept")
  return new Response(JSON.stringify({ error: { message: msg, type, code: errCode } }), { status: res.status, statusText: res.statusText, headers })
}

export const WorkBuddyAuthPlugin = makePlugin(SITES.workbuddy)
export const WorkBuddyAIAuthPlugin = makePlugin(SITES["workbuddy-ai"])

// for tests
export const _internal = { idFor, replyAfterToolsOn, withDefaultEffort, defaultEffortOf, gzipped, FREE_ONLY, PRICE_TTL, keyAccount, remoteConfig, cycleOf, typeUnions, systemAsUser, systemKey, DEFAULT_SYSTEM, EDGE_READS, fitShape, replyAfterTools, AFTER_TOOLS_REFUSED, enterpriseUsageOf, accountName, notDesktop, textOnly, runsOutOf, packagesOf, endOf, enterpriseHeaders, enterpriseOf, liveModels, browserSignIn, withSystem, asReasoning, normalizeToolChoice, fitTools, fitted, renamed, unflagged, usageOf, desktopHeld, explained, REFUSED_HINT, RESTRICTED_HINT, EXHAUSTED_HINT, freeCredits, creditsOf, priceOf, fresh, SITES, renewing, renewed, SESSION, attend, scopeOf, turnKey, conversationKey, signatureOf, isMessages, withoutUnsigned, withoutSignedThinking, prepared, answeredBefore, nativeOf, modelOf, configModels, freeWindowOf, tokensShort, freeWindowRows, freeWindowLedger, readLedgerTail, pinned, rowTime, rowAccount, ofAccount, windowOffset, windowReset, FREE_WINDOW_MODELS, FREE_WINDOW_SPAN, FREE_WINDOW_GAP, FREE_WINDOW_LEAD, checkinOf, API_MESSAGES: NPM_MESSAGES, API_CHAT: NPM }
