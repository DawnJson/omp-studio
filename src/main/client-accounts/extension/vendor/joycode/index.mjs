#!/usr/bin/env bun
/**
 * opencode-joycode-auth — JoyCode (JD Cloud JoyCoder IDE credits) as a
 * magpie / OpenCode provider.
 *
 * Protocol derived from the JoyCode IDE's bundled extension.js:
 *   POST https://api-ai.jd.com/api?appid=joycode_ide&functionId=<protocol>_completions&t=<ms>&sign=<hmac>
 *   headers: ptKey (account ticket), loginType, optional tenant
 *   body:    Chat Completions, Responses, or Anthropic Messages JSON
 *
 * The model catalogue's extJson.adapterType selects the model's SDK. We sign
 * each request on the matching gateway, inject credential headers, and add
 * authenticated account identity to the body. We inspect response prefixes
 * for bare JSON gateway errors; valid SSE bytes are replayed unchanged,
 * including tool-call deltas. JoyCode's Anthropic and Responses gateways add
 * an extra SSE framing layer; we remove it incrementally so the official
 * Anthropic and OpenAI SDKs receive standard events without extra buffering.
 *
 * Options (magpie plugin options joycode '{"…"}'):
 *   { "flatten": true }  — flatten multi-turn messages into a single prompt
 *   before sending (fallback if JoyCode rejects multi-turn / tool-call
 *   payloads). Drops tools; useful for plain chat only.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const PROVIDER = 'joycode'
const BASE = 'https://api-ai.jd.com'
const GATEWAY_PATH = '/api'
const APPID = 'joycode_ide'
const FUNCTION_IDS = {
  chat: 'chat_completions',
  responses: 'responses_completions',
  anthropic: 'anthropic_completions',
}
const SDK = {
  chat: '@ai-sdk/openai-compatible',
  responses: '@ai-sdk/openai',
  anthropic: '@ai-sdk/anthropic',
}
const LOGIN_TYPE = 'PIN_JD_CLOUD'

// HMAC signing key, extracted from the JoyCode IDE's bundled extension.js.
//
// This is a PUBLIC PROTOCOL CONSTANT, not a secret: it is baked into every
// copy of the IDE and identifies the client, nothing more. It cannot
// authorize a request on its own — the account credential is the `ptKey`
// header, which magpie stores in its plugin-auth.json (mode 600), never in
// this folder.
//
// If JoyCode ever rotates the key, re-extract it from extension.js and update
// this constant (or override at runtime via JOYCODE_SIGN_KEY).
const SIGN_KEY = process.env.JOYCODE_SIGN_KEY || '0691a3f0b37b4a85aeb63ad0fc7db3ed'

/** Models the JoyCode backend offers (from /joycode_modelList). */
const MODELS = {
  'JoyAI-Code-1.6': {
    name: 'JoyAI Code 1.6',
    limit: { context: 200000, output: 64000 },
    tool_call: true,
  },
  'GLM-5.3-agent': {
    name: 'GLM 5.3',
    limit: { context: 200000, output: 64000 },
    reasoning: true,
    tool_call: true,
    modalities: { input: ['text'] },
  },
  'Kimi-K2.6-agent': {
    name: 'Kimi K2.6',
    limit: { context: 200000, output: 64000 },
    reasoning: true,
    tool_call: true,
    modalities: { input: ['text', 'image'] },
  },
  'MiniMax-M3-agent': {
    name: 'MiniMax M3',
    limit: { context: 200000, output: 64000 },
    reasoning: true,
    tool_call: true,
    modalities: { input: ['text', 'image'] },
  },
  'Doubao-Seed-2.0-pro-agent': {
    name: 'Doubao Seed 2.0 Pro',
    limit: { context: 200000, output: 64000 },
    reasoning: true,
    tool_call: true,
    modalities: { input: ['text', 'image'] },
  },
}

// ---------------------------------------------------------------- helpers
// (not exported as module functions: the plugin host treats every exported
// function as a plugin and calls it — v1 default {id, server} below keeps
// them out of that. The test surface is `_internal`.)

/**
 * JoyCode gateway signature (mirrors extension.js module 68327):
 *   merged = { ...extra, appid, functionId, t: Date.now() }
 *   h      = sortedKeys.map(k => merged[k]).filter(non-empty).join('&')
 *   sign   = hex( HMAC-SHA256(h, secret) )
 *
 * The timestamp `t` is part of the signed material, so this MUST be called
 * per request — never cache the result.
 */
function signQuery(functionId, extra = {}) {
  const merged = { ...extra, appid: APPID, functionId, t: Date.now() }
  const h = Object.keys(merged)
    .sort()
    .map((k) => merged[k])
    .filter((v) => v !== '' && v !== undefined && v !== null)
    .join('&')
  const sig = createHmac('sha256', SIGN_KEY).update(h).digest('hex')
  return { ...merged, sign: sig }
}

/** Build the signed gateway URL for one request. */
function buildGatewayUrl(functionId) {
  const u = new URL(GATEWAY_PATH, BASE)
  for (const [k, v] of Object.entries(signQuery(functionId))) u.searchParams.set(k, String(v))
  return u.toString()
}

/** Credential headers the gateway expects (ptKey is the account auth). */
function buildGatewayHeaders(ptKey, tenant, loginType = LOGIN_TYPE) {
  return {
    ptkey: ptKey,
    logintype: loginType,
    ...(tenant ? { tenant: encodeURIComponent(tenant) } : {}),
  }
}

/** JoyCode's model catalogue names the wire protocol in extJson.adapterType. */
function adapterProtocol(model) {
  let ext = model?.extJson
  if (typeof ext === 'string') {
    try { ext = JSON.parse(ext) } catch { ext = undefined }
  }
  const type = ext?.adapterType ?? model?.adapterType
  if (typeof type !== 'string') return 'chat'
  if (type === 'anthropic') return 'anthropic'
  if (type === 'openai-response' || type === 'openai-responses' || type === 'responses') return 'responses'
  return 'chat'
}

function requestPath(input) {
  try {
    return input instanceof Request ? new URL(input.url).pathname : new URL(String(input)).pathname
  } catch {
    return ''
  }
}

function isCountTokensRequest(input) {
  return /\/messages\/count_tokens\/?$/.test(requestPath(input))
}

/** The URL the host builds from a model's api.url says which request shape it sent. */
function requestProtocol(input, payload) {
  const path = requestPath(input)
  if (/\/responses\/?$/.test(path)) return 'responses'
  if (/\/messages(?:\/count_tokens)?\/?$/.test(path)) return 'anthropic'
  if (/\/chat\/completions\/?$/.test(path)) return 'chat'

  if (Array.isArray(payload?.system)) return 'anthropic'
  const tools = Array.isArray(payload?.tools) ? payload.tools : []
  if (tools.some(tool => tool && typeof tool === 'object' && 'input_schema' in tool && !tool.function)) {
    return 'anthropic'
  }
  if (payload?.input !== undefined && payload?.messages === undefined) return 'responses'
  return 'chat'
}

/**
 * Reasoning ids belong to items the upstream stored. Codex replays reasoning
 * history with `store: false`, so JoyCode cannot resolve those ids and rejects
 * the whole Responses request ("Item with id 'rs_…' not found"). The item's
 * summary and encrypted content remain valid inline; only the stored-item id
 * has to go.
 */
function withoutUnstoredReasoningIds(payload) {
  if (payload?.store === true || !Array.isArray(payload?.input)) return payload
  let changed = false
  const input = payload.input.map((item) => {
    if (!item || typeof item !== 'object' || item.type !== 'reasoning' ||
      !Object.prototype.hasOwnProperty.call(item, 'id')) return item
    changed = true
    const { id, ...inline } = item
    return inline
  })
  return changed ? { ...payload, input } : payload
}

/**
 * OpenAI `messages` -> { prompt, system } — fallback for accounts/backends
 * that reject multi-turn or tool-call payloads.
 */
function flattenMessages(messages) {
  const systemParts = []
  const turns = []

  for (const m of messages ?? []) {
    const role = m.role
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content
            .map((c) => {
              if (typeof c === 'string') return c
              if (c?.type === 'text') return c.text ?? ''
              if (c?.type === 'image_url') return '[image omitted]'
              return ''
            })
            .join('')
        : ''

    if (role === 'system' || role === 'developer') {
      if (content.trim()) systemParts.push(content.trim())
      continue
    }
    if (!content.trim()) continue

    if (role === 'user') turns.push(`User: ${content}`)
    else if (role === 'assistant') turns.push(`Assistant: ${content}`)
    else if (role === 'tool') turns.push(`Tool result: ${content}`)
  }

  let prompt
  if (turns.length === 1 && turns[0].startsWith('User: ')) {
    prompt = turns[0].slice('User: '.length)
  } else if (turns.length === 0) {
    prompt = systemParts.join('\n\n') || ''
  } else {
    prompt = `${turns.join('\n\n')}\n\nAssistant:`
  }

  return { prompt, system: systemParts.join('\n\n') }
}

/** Flatten a chat completions body into the minimal shape JoyCode accepts. */
function flattenBody(payload) {
  const { prompt, system } = flattenMessages(payload.messages)
  return {
    model: payload.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    stream: payload.stream === true,
    ...(payload.stream ? {} : { max_tokens: 64000 }),
  }
}

// ---------------------------------------------------------------- browser login

/**
 * Loopback OAuth, mirroring JoyCode IDE's own login flow (reversed from
 * extension.js):
 *
 *   1. We start a localhost server on a random port and hand magpie the URL
 *      https://joycode.jd.com/login/?ideAppName=…&fromIde=ide&redirect=0
 *      &authPort=<port>&authKey=<random>  (magpie opens it in the browser)
 *   2. After the user signs in with their JD account, joycode.jd.com calls
 *      back  http://localhost:<port>/…?authPort&authKey&pt_key&loginType&callbackUrl
 *   3. We verify authKey matches (CSRF), call joycode_userInfo with the
 *      pt_key to confirm it works and to learn the account name, then hand
 *      magpie the completed login.
 */
const LOGIN_URL = 'https://joycode.jd.com/login/'

function callUserInfo(ptKey, loginType, tenant) {
  return fetch(buildGatewayUrl('joycode_userInfo'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildGatewayHeaders(ptKey, tenant, loginType || LOGIN_TYPE),
    },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  }).then(async (r) => {
    const json = await r.json().catch(() => null)
    const user = json?.data
    return {
      ok: r.ok && json?.code === 0 && typeof user?.userId === 'string' && user.userId.length > 0,
      status: r.status,
      user,
    }
  })
}

/**
 * magpie oauth method contract:
 *   authorize() returns { url, method: "auto", callback }
 *   magpie opens `url`; callback() resolves when our loopback server gets
 *   the redirect.
 */
async function browserLogin() {
  const authKey = randomBytes(16).toString('hex')

  // Start the loopback server first so the port in the URL is live.
  let resolveLogin
  const promise = new Promise((resolve) => { resolveLogin = resolve })

  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost')
    const q = u.searchParams
    const finish = (ok, message, extra = {}) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px/1.6 system-ui;padding:40px">${
        ok
          ? '<h2>JoyCode 登录成功 ✓</h2><p>可以回到 magpie 了，此页面会自动关闭。</p>'
          : `<h2>JoyCode 登录失败</h2><p>${message}</p><p>请回到 magpie 重新开始登录。</p>`
      }<script>setTimeout(()=>window.close(),2000)</script></body>`)
      clearTimeout(expiry)
      server.close()
      resolveLogin(ok ? { ok: true, ...extra } : { ok: false, error: message })
    }
    if (q.get('authKey') !== authKey || Number(q.get('authPort')) !== server.address()?.port) {
      res.writeHead(404)
      return res.end()
    }
    const ptKey = q.get('pt_key')
    const loginType = q.get('loginType') || LOGIN_TYPE
    const tenant = q.get('tenant') || ''
    if (!ptKey) return finish(false, '登录页没有返回 pt_key')
    // The gateway wraps user information in { code: 0, data: { userId, ... } }.
    // Never display its raw response: it contains private account fields.
    callUserInfo(ptKey, loginType, tenant)
      .then(({ ok, status, user }) => {
        if (ok) {
          finish(true, '', { ptKey, loginType, tenant, userName: user.userName || user.userId })
        } else {
          finish(false, `JoyCode 账号信息校验未通过（HTTP ${status}），请重新登录`)
        }
      })
      .catch(() => finish(false, '验证票据时网络请求失败或超时，请重试'))
  })

  await new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  // Auto-expire after 10 minutes (JoyCode IDE uses the same timeout).
  const expiry = setTimeout(() => {
    try { server.close() } catch {}
    resolveLogin({ ok: false, error: '登录超时（10 分钟未完成）' })
  }, 600_000)
  expiry.unref?.()

  const port = server.address().port
  const url = `${LOGIN_URL}?ideAppName=JoyCode&fromIde=ide&redirect=0&authPort=${port}&authKey=${authKey}`
  return {
    url,
    instructions: '在打开的浏览器里登录你的京东账号（可扫码）。完成后此窗口会自动继续。',
    method: 'auto',
    async callback() {
      const result = await promise
      if (!result.ok) return { type: 'failed', error: result.error }
      return {
        type: 'success',
        key: result.ptKey,            // saved as { type: "api", key }
        accountId: result.userName || undefined,
        metadata: { loginType: result.loginType, tenant: result.tenant },
      }
    },
  }
}

// ---------------------------------------------------------------- chat responses

function chatError(status, code, message) {
  return Response.json({ error: { type: 'upstream_error', code, message } }, {
    status,
    headers: { 'x-magpie-sign-in': status === 401 ? 'expired' : 'kept' },
  })
}

function isSuccessfulJson(json, protocol) {
  if (!json || typeof json !== 'object') return false
  if (protocol === 'chat') return Boolean(json.choices)
  if (protocol === 'anthropic') {
    return Boolean(Array.isArray(json.content) || json.type === 'message' || json.stop_reason)
  }
  if (protocol === 'responses') {
    return Boolean(json.object === 'response' || (json.id && Array.isArray(json.output)))
  }
  return false
}

/**
 * JoyCode returns Anthropic events with one extra SSE framing layer:
 *
 *   data: event: message_start
 *   data: data: {"type":"message_start",…}
 *
 * The official Anthropic SDK ignores `data:` events without an `event:` line,
 * so passing those bytes through produces an empty stream. Rewrite only the
 * two non-standard prefixes and coalesce their separating blank line into one
 * standard SSE event, incrementally and without buffering the model output.
 * Standard Anthropic SSE is left untouched. Buffering until a newline also
 * handles either prefix being split across upstream chunks.
 */
function normalizeAnthropicSse(source) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''
  let heldEvent

  const processLine = (line, controller) => {
    const ending = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : line.endsWith('\r') ? '\r' : ''
    const body = ending ? line.slice(0, -ending.length) : line

    if (!body) {
      // JoyCode puts a blank line between `data: event` and `data: data`.
      // Hold that separator back until both halves become one SSE event.
      if (!heldEvent) controller.enqueue(encoder.encode(ending))
      return
    }

    if (body.startsWith('data: event: ')) {
      if (heldEvent) controller.enqueue(encoder.encode(heldEvent.text + heldEvent.ending))
      heldEvent = { text: `event: ${body.slice('data: event: '.length)}`, ending }
      return
    }

    if (body.startsWith('data: data: ')) {
      if (heldEvent) {
        controller.enqueue(encoder.encode(heldEvent.text + heldEvent.ending))
        heldEvent = undefined
      }
      controller.enqueue(encoder.encode(`data: ${body.slice('data: data: '.length)}${ending}`))
      return
    }

    if (heldEvent) {
      controller.enqueue(encoder.encode(heldEvent.text + heldEvent.ending))
      heldEvent = undefined
    }
    controller.enqueue(encoder.encode(line))
  }

  return source.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      let newline
      while ((newline = pending.indexOf('\n')) !== -1) {
        processLine(pending.slice(0, newline + 1), controller)
        pending = pending.slice(newline + 1)
      }
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending) processLine(pending, controller)
      if (heldEvent) controller.enqueue(encoder.encode(heldEvent.text + heldEvent.ending))
    },
  }))
}

/**
 * JoyCode's Responses gateway wraps each SSE payload as `data: data: {…}`.
 * Remove that extra layer without waiting for the response to finish.
 * Standard Responses SSE, and every other line, is passed through unchanged.
 */
function normalizeResponsesSse(source) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''

  const processLine = (line, controller) => {
    const ending = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : line.endsWith('\r') ? '\r' : ''
    const body = ending ? line.slice(0, -ending.length) : line
    const normalized = body.startsWith('data: data: ')
      ? `data: ${body.slice('data: data: '.length)}${ending}`
      : line
    controller.enqueue(encoder.encode(normalized))
  }

  return source.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      let newline
      while ((newline = pending.indexOf('\n')) !== -1) {
        processLine(pending.slice(0, newline + 1), controller)
        pending = pending.slice(newline + 1)
      }
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending) processLine(pending, controller)
    },
  }))
}

async function normalizeResponse(response, protocol = 'chat') {
  if (!response.ok) {
    const headers = new Headers(response.headers)
    headers.set('x-magpie-sign-in', response.status === 401 ? 'expired' : 'kept')
    return new Response(response.body, { status: response.status, headers })
  }
  if (!response.body) return chatError(502, 'empty_response', 'JoyCode 返回空响应')
  const reader = response.body.getReader()
  const buffered = []
  const decoder = new TextDecoder()
  let prefix = ''
  let bytes = 0
  // The gateway can label a plain JSON error as HTTP 200 text/event-stream.
  // Inspect the prefix before exposing success headers to magpie.
  while (!prefix.trim() && bytes <= 65536) {
    const next = await reader.read()
    if (next.done) break
    buffered.push(next.value)
    bytes += next.value.byteLength
    prefix += decoder.decode(next.value, { stream: true })
  }
  if (!prefix.trim()) {
    await reader.cancel()
    return chatError(502, 'empty_response', 'JoyCode 返回空响应')
  }
  if (prefix.trimStart().startsWith('{')) {
    while (bytes <= 1024 * 1024) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      prefix += decoder.decode(next.value, { stream: true })
    }
    await reader.cancel()
    prefix += decoder.decode()
    let json
    try { json = JSON.parse(prefix) } catch {}
    if (json?.error || (json?.code !== undefined && Number(json.code) !== 0)) {
      const code = json.error?.code ?? json.code
      const status = code === 'AI_GRAY_ACCESS_DENIED' ? 403 : Number(code) === 401 ? 401 : 502
      const message = json.error?.message ?? json.message ?? json.msg
      return chatError(status, code, typeof message === 'string' ? message.slice(0, 500) : 'JoyCode 请求被拒绝')
    }
    if (isSuccessfulJson(json, protocol)) return Response.json(json)
    return chatError(502, 'invalid_response', 'JoyCode 未返回有效的对话响应')
  }
  // Replay the inspected bytes and then stream normally, preserving tool deltas.
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  const stream = new ReadableStream({
    async pull(controller) {
      if (buffered.length) { controller.enqueue(buffered.shift()); return }
      try {
        const next = await reader.read()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) { controller.error(error) }
    },
    cancel(reason) { return reader.cancel(reason) },
  })
  const normalized = protocol === 'anthropic'
    ? normalizeAnthropicSse(stream)
    : protocol === 'responses'
      ? normalizeResponsesSse(stream)
      : stream
  return new Response(normalized, {
    status: response.status,
    headers,
  })
}

// ---------------------------------------------------------------- account data

async function fetchAccountData(auth, functionId, body = {}) {
  if (auth?.type !== 'api' || !auth.key) {
    throw Object.assign(new Error('请先登录 JoyCode'), { signIn: 'expired' })
  }
  let response
  try {
    response = await fetch(buildGatewayUrl(functionId), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        ...buildGatewayHeaders(auth.key, auth.metadata?.tenant, auth.metadata?.loginType || LOGIN_TYPE),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error('JoyCode 数据查询网络失败或超时')
  }
  const json = await response.json().catch(() => null)
  if (response.status === 401 || Number(json?.code) === 401) {
    throw Object.assign(new Error('JoyCode 登录已失效，请重新登录'), { signIn: 'expired' })
  }
  if (!response.ok || !json || (json.code !== undefined && Number(json.code) !== 0)) {
    const message = json?.error?.message ?? json?.message ?? json?.msg
    throw new Error(`JoyCode 数据查询失败（HTTP ${response.status}）${typeof message === 'string' ? `：${message.slice(0, 500)}` : ''}`)
  }
  return json.data ?? json
}

function quotaFromData(data) {
  const items = data?.usageItems
  if (!Array.isArray(items) || !items.length) throw new Error('JoyCode 暂未返回额度数据')
  if (items.some(item => !item || typeof item.title !== 'string' ||
    !['used', 'total', 'remain', 'usedPercent'].every(key => Number.isFinite(item[key])))) {
    throw new Error('JoyCode 额度数据格式不完整')
  }
  const format = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
  const plans = [...new Set(items.map(item => item.badge).filter(value => typeof value === 'string' && value))]
  return {
    ...(plans.length ? { plan: plans.join(' / ') } : {}),
    // Different buckets may overlap; do not manufacture a summed balance.
    ...(items.length === 1 ? { balance: `${format(items[0].remain)} ${items[0].unit || '积分'}` } : {}),
    windows: items.map(item => ({
      name: item.title,
      used: item.usedPercent,
      amount: item.used,
      limit: item.total,
      unit: item.unit || '积分',
      display: `${format(item.used)} / ${format(item.total)} · 剩余 ${format(item.remain)}${item.expireText ? ` · ${item.expireText}` : ''}`,
      // Bucket applicability is unspecified, and free models can remain usable.
      // Show the balance without blocking the entire account at 100%.
      aside: true,
    })),
  }
}

function multiplier(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?\s*[x×]?$/i.test(value.trim())) return undefined
  return multiplier(Number(value.trim().replace(/[x×]$/i, '').trim()))
}

function billingScene(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return undefined
  if (value.billingRate && typeof value.billingRate === 'object') return value.billingRate
  if (Array.isArray(value.billingRates)) return value
  for (const key of ['data', 'result', 'config', 'content', 'value']) {
    const found = billingScene(value[key], depth + 1)
    if (found) return found
  }
}

async function accountModels(provider, { auth } = {}) {
  if (auth?.type !== 'api' || !auth.key) return provider.models
  const [catalogue, pricing] = await Promise.allSettled([
    fetchAccountData(auth, 'joycode_modelList'),
    fetchAccountData(auth, 'plugin_config', { sceneType: 'billingRate' }),
  ])
  for (const result of [catalogue, pricing]) {
    if (result.status === 'rejected' && result.reason?.signIn === 'expired') throw result.reason
  }
  if (catalogue.status !== 'fulfilled' || !Array.isArray(catalogue.value)) return provider.models
  const scene = pricing.status === 'fulfilled' ? billingScene(pricing.value) : undefined
  const tenant = auth.metadata?.tenant?.trim()
  const excluded = (scene?.excludeTenants ?? []).some(value => typeof value === 'string' && value.trim() === tenant)
  const rates = new Map(tenant && !excluded && Array.isArray(scene?.billingRates)
    ? scene.billingRates.map(row => [row.chatApiModel, multiplier(row.billingRate)]) : [])
  const models = {}
  for (const model of catalogue.value) {
    const id = model?.chatApiModel
    if (typeof id !== 'string' || !id || model.hidden || model.isHidden ||
      (model.modelFunctionType && !['ALL', 'chat', 'agent'].includes(model.modelFunctionType))) continue
    const base = provider.models?.[id] ?? {}
    const features = Array.isArray(model.features) ? model.features : []
    const image = features.includes('vision')
    const rate = multiplier(model.billingRate) ?? rates.get(id)
    const protocol = adapterProtocol(model)
    // Remove old rate fields so unavailable pricing never becomes fake free usage.
    const { rate: oldRate, rateWas, free, ...rest } = base
    models[id] = {
      ...rest,
      id,
      name: model.label || id,
      api: { id, url: `${BASE}/v1`, npm: SDK[protocol] },
      limit: {
        ...base.limit,
        context: Number.isFinite(model.maxTotalTokens) ? model.maxTotalTokens : base.limit?.context ?? 200000,
        output: Number.isFinite(model.respMaxTokens) ? model.respMaxTokens : base.limit?.output ?? 64000,
      },
      capabilities: {
        ...base.capabilities,
        toolcall: features.includes('function_call'),
        input: { ...base.capabilities?.input, text: true, image },
      },
      modalities: { input: image ? ['text', 'image'] : ['text'] },
      ...(rate !== undefined ? { rate, free: rate === 0 } : {}),
    }
  }
  return models
}

// ---------------------------------------------------------------- plugin

export const JoyCodeAuthPlugin = async (_input, options) => {
  const flatten = options?.flatten === true

  return {
    // Provider + models available before anyone signs in.
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[PROVIDER] ??= {
        name: 'JoyCode',
        npm: '@ai-sdk/openai-compatible', // chat completions
        api: BASE,
        models: MODELS,
      }
    },

    provider: { id: PROVIDER, models: accountModels },

    auth: {
      provider: PROVIDER,
      methods: [
        {
          type: 'oauth',
          label: '浏览器登录（京东账号）',
          authorize: browserLogin,
        },
        {
          type: 'api',
          label: 'JoyCode ptKey',
          placeholder: 'pt_key…（JoyCode IDE 登录态里的 ptKey）',
          prompts: [
            {
              type: 'text',
              key: 'tenant',
              message: 'Tenant（企业租户名，个人账号留空）',
              placeholder: '留空 = 个人账号',
            },
          ],
        },
      ],

      // What every request for this account carries.
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth?.type !== 'api') return {}
        const ptKey = auth.key
        const tenant = (auth.metadata?.tenant ?? '').trim()
        const loginType = auth.metadata?.loginType || LOGIN_TYPE
        if (!ptKey) return {}
        // Resolve native chat identity once per account loader, never globally.
        let identityPromise
        const identity = () => {
          identityPromise ??= fetchAccountData(auth, 'joycode_userInfo').then(user => {
            if (typeof user?.userId !== 'string' || !user.userId) throw new Error('JoyCode 未返回账号身份')
            return { userId: user.userId, tenant: user.tenant || tenant, orgFullName: user.orgFullName || '' }
          }).catch(error => { identityPromise = undefined; throw error })
          return identityPromise
        }

        return {
          // Each model's api.url carries the base. The fetch below rewrites the
          // full URL because the gateway signature embeds a fresh timestamp.
          baseURL: '',

          async fetch(input, init) {
            // JoyCode has no token-count endpoint. Let magpie fall back to its
            // local estimator instead of signing a paid generation request.
            if (isCountTokensRequest(input)) {
              return Response.json({
                error: {
                  type: 'unsupported_endpoint',
                  message: 'JoyCode does not provide token counting',
                },
              }, { status: 404 })
            }

            // Preserve chat structure; the IDE also adds authenticated metadata.
            const account = await identity()
            const request = input instanceof Request ? input : undefined
            let source = init?.body
            if (source === undefined && request) source = await request.clone().text()
            source = typeof source === 'string'
              ? source
              : source == null
                ? '{}'
                : new TextDecoder().decode(source)
            const payload = JSON.parse(source)
            const protocol = requestProtocol(request ?? input, payload)
            const forwarded = protocol === 'responses' ? withoutUnstoredReasoningIds(payload) : payload
            const body = JSON.stringify({
              ...(flatten && protocol === 'chat' ? flattenBody(payload) : forwarded),
              ...account,
              language: 'UNKNOWN',
            })

            // 2) URL: fresh signature per request, on the model's wire protocol.
            const url = buildGatewayUrl(FUNCTION_IDS[protocol])

            // 3) Headers: keep what magpie synthesized (content-type, …),
            //    add the gateway credentials, drop the OpenAI-style bearer
            //    JoyCode does not understand.
            const headers = new Headers(init?.headers ?? request?.headers)
            for (const [k, v] of Object.entries(buildGatewayHeaders(ptKey, account.tenant, loginType))) {
              headers.set(k, v)
            }
            headers.delete('authorization')
            headers.delete('x-api-key')
            headers.delete('content-length')
            headers.delete('host')

            // 4) Forward (...init carries the abort signal).
            const resp = await fetch(url, {
              ...init,
              method: init?.method ?? request?.method,
              headers,
              body,
              signal: init?.signal ?? request?.signal,
            })

            return normalizeResponse(resp, protocol)
          },
        }
      },

      async usage(getAuth) {
        try {
          return quotaFromData(await fetchAccountData(await getAuth(), 'get_newpoint_ide'))
        } catch (error) {
          return {
            error: error.message,
            windows: [],
            signIn: error.signIn === 'expired' ? 'expired' : 'kept',
          }
        }
      },

      // No refresh protocol has been verified; rejected tickets require sign-in.
    },
  }
}

// Test surface (bun test). Everything testable lives on this object so the
// entry module exports no bare functions besides the plugin — see the note
// on the helpers above.
export const _internal = {
  signQuery,
  buildGatewayUrl,
  buildGatewayHeaders,
  flattenMessages,
  adapterProtocol,
  requestProtocol,
  MODELS,
}

// OpenCode v1 form: with default { id, server } the host takes only
// `server` as the plugin and never iterates the module's other exports.
export default { id: PROVIDER, server: JoyCodeAuthPlugin }
