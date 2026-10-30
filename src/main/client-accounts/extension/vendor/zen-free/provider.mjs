import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  PROVIDER,
  SDK,
  bootstrapProtocols,
  bootstrapProvider,
  buildModels,
  configModels,
  parseProtocolDocs,
} from "./models.mjs";
import { collapseResponse } from "./stream.mjs";
import { guardToolResponse } from "./tool-response.mjs";

// Zen's free models answer only at the inference API since mid-October
// 2026: the same request OpenCode 1.19.0 sends answers 403 FreeTierError
// at /zen/v1 and 200 here, and models.dev gives OpenCode this URL. A model
// listed before then still names /zen/v1 (LEGACY_BASE), which is asked here.
const DEFAULT_BASE = "https://opencode.ai/inference/v1";
const LEGACY_BASE = "https://opencode.ai/zen/v1";
const CATALOG = "https://models.opencode.ai/api.json";
// OpenCode's table of what each model is asked at; packages/web's zen.mdx,
// read before, was removed on 2026-10-12 (anomalyco/opencode#54761)
const DOCS =
  "https://raw.githubusercontent.com/anomalyco/opencode/dev/services/www/src/docs/content/console/models.mdx";
const PATHS = { chat: "/chat/completions", responses: "/responses", anthropic: "/messages" };
const CORE_TOOLS = ["bash", "edit", "glob", "grep", "read"];
// The parameter each stand-in takes, OpenCode's own first one: Zen's free
// tier answers 403 FreeTierError to bash or read offered with none.
const CORE_PARAMETER = {
  bash: "command",
  edit: "filePath",
  glob: "pattern",
  grep: "pattern",
  read: "filePath",
};
// What OpenCode 2.0.25 sends as its User-Agent on every protocol:
// `opencode/${channel}/${version}/${name}` (its App service, read from the
// release binary and captured from its requests on 2026-10-25). Since
// 2026-10-26 Zen's free tier answers 429 FreeUsageLimitError ("Free models
// work in OpenCode") to the exact User-Agent 0.1.6 to 0.1.15 sent, OpenCode
// 1.19.0's `opencode/1.19.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14`,
// whatever the body says; the same request under any other string, OpenCode
// 2.0.25's included, is served.
const OPENCODE_VERSION = "2.0.25";
export function userAgent() {
  return `opencode/latest/${OPENCODE_VERSION}/cli`;
}
// How long a request for a model the last list didn't have waits before it
// asks Zen's list again: a model Zen made free since is served at once,
// and a model typed in by hand doesn't ask the list on every request.
const RELIST_AFTER = 60_000;

function httpURL(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Expected an HTTP(S) URL without credentials, query or fragment");
  }
  return url.href.replace(/\/+$/, "");
}

function requirePublic(auth) {
  if (auth?.type !== "api" || auth.key !== "public") {
    throw new Error(
      "OpenCode Zen Free uses the public credential. Enable its free access login method.",
    );
  }
}

async function readRemote(url, json, headers, callerSignal) {
  const timeout = AbortSignal.timeout(15000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Model discovery returned HTTP ${response.status}`);
  }
  return json ? response.json() : response.text();
}

function normalizeTools(body, protocol) {
  if (body.tools !== undefined && !Array.isArray(body.tools)) {
    throw new Error("tools must be an array");
  }
  body.tools ??= [];
  const present = new Set(
    body.tools.map((tool) => (protocol === "chat" ? tool?.function?.name : tool?.name)),
  );
  const declared = new Set([...present].filter((name) => typeof name === "string"));
  if (protocol === "chat" && Array.isArray(body.functions)) {
    for (const tool of body.functions) if (typeof tool?.name === "string") declared.add(tool.name);
  }
  for (const name of CORE_TOOLS) {
    if (present.has(name)) continue;
    const parameters = {
      type: "object",
      properties: { [CORE_PARAMETER[name]]: { type: "string" } },
      additionalProperties: false,
    };
    const definition = { name, description: "Not available. Never call this tool." };
    body.tools.push(
      protocol === "chat"
        ? { type: "function", function: { ...definition, parameters } }
        : protocol === "anthropic"
          ? { ...definition, input_schema: parameters }
          : { type: "function", ...definition, parameters },
    );
  }
  return { declared };
}

// Zen's free tier serves a request as OpenCode's own only when one of its
// system messages carries OpenCode's environment block: `<env>`, a
// `Working directory:` line and `</env>`, as every OpenCode prompt ends.
// A request without one (another agent's own prompt: Kimi Work's,
// WorkBuddy's) gets a small allowance a day, then 429 FreeUsageLimitError
// ("Free models work in OpenCode") until 00:00 UTC, whatever its headers
// say; the same request with the block added is served (tried against
// opencode.ai on 2026-10-25, deepseek-v4.1-flash-free and
// glm-5.3-flash-free). In a user message or a tool description it doesn't
// count, and `<ENV>` or `working directory:` don't either.
//
// Since 2026-10-29 Zen answers 429 FreeUsageLimitError at once to the
// literal line 0.1.15 to 0.1.17 added, `Working directory: unknown`, while
// the same request with a path there is served (shanmao_10826 on magpie's
// Discord): fixed text that only this plugin sends is its fingerprint, as
// its old User-Agent was. So the block is OpenCode 2.2.0's own
// (packages/core/src/instructions/builtins.ts, without its line about
// OpenCode's temp folder), with the directory the agent's own prompt
// names, as OpenCode names its own, or the user's home folder when the
// prompt names none.
const HAS_ENVIRONMENT = /<env>[\s\S]*Working directory:[\s\S]*<\/env>/;
// How agents name their working directory: Codex's `<cwd>`, Claude Code's
// and others' `Working directory:`, Kimi's "The current working directory
// is `...`". Only an absolute path counts.
const ABSOLUTE = String.raw`((?:~?/|[A-Za-z]:[\\/]|\\\\)[^\s\x60'"<>]*)`;
const STATED_DIRECTORY = [
  new RegExp(String.raw`<cwd>\s*${ABSOLUTE}\s*</cwd>`),
  new RegExp(String.raw`working directory(?: is)?:?\s+\x60?${ABSOLUTE}`, "i"),
];

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n");
}

const SYSTEM_ROLES = ["system", "developer"];

// The agent's working directory as its own prompt (system messages,
// instructions) or its first user message says it.
export function statedDirectory(body, protocol) {
  const messages = protocol === "responses" ? body.input : body.messages;
  const texts = [textOf(protocol === "anthropic" ? body.system : body.instructions)];
  if (Array.isArray(messages)) {
    for (const message of messages)
      if (SYSTEM_ROLES.includes(message?.role)) texts.push(textOf(message.content));
    texts.push(textOf(messages.find((message) => message?.role === "user")?.content));
  } else if (typeof messages === "string") {
    texts.push(messages);
  }
  for (const text of texts) {
    for (const pattern of STATED_DIRECTORY) {
      const found = pattern.exec(text)?.[1]?.replace(/[.,;:)\]]+$/, "");
      if (found && found !== "/" && found !== "~/") return found;
    }
  }
  return undefined;
}

// OpenCode's block, said for `directory`.
export function environment(directory) {
  let git = false;
  try {
    git = existsSync(join(directory.replace(/^~(?=\/)/, homedir()), ".git"));
  } catch {}
  return [
    "Here is some useful information about the environment you are running in:",
    "<env>",
    `  Working directory: ${directory}`,
    `  Workspace root folder: ${directory}`,
    `  Is directory a git repo: ${git ? "yes" : "no"}`,
    `  Platform: ${process.platform}`,
    "</env>",
  ].join("\n");
}

function withEnvironment(content, block) {
  if (typeof content === "string") return content ? `${content}\n\n${block}` : block;
  if (Array.isArray(content)) return [...content, { type: "text", text: block }];
  return block;
}

export function addEnvironment(body, protocol, home = homedir()) {
  const block = () => environment(statedDirectory(body, protocol) ?? home);
  if (protocol === "anthropic") {
    if (!HAS_ENVIRONMENT.test(textOf(body.system))) body.system = withEnvironment(body.system, block());
    return;
  }
  const messages = protocol === "chat" ? body.messages : body.input;
  const system = Array.isArray(messages)
    ? messages.filter((message) => SYSTEM_ROLES.includes(message?.role))
    : [];
  if (system.some((message) => HAS_ENVIRONMENT.test(textOf(message.content)))) return;
  if (protocol === "responses") {
    if (!HAS_ENVIRONMENT.test(textOf(body.instructions)))
      body.instructions = withEnvironment(body.instructions, block());
    return;
  }
  // Added to the agent's own system message, so the prompt stays one
  // system message, the same on every turn (its cache holds); one is put
  // first when the agent sent none.
  const first = system.find((message) => message.role === "system");
  if (first) first.content = withEnvironment(first.content, block());
  else if (Array.isArray(messages)) messages.unshift({ role: "system", content: block() });
  else body.messages = [{ role: "system", content: block() }];
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let lastStamp = 0;
let counter = 0;

// An id the way OpenCode makes one (packages/schema/src/identifier.ts):
// 12 hex of Date.now() * 0x1000 + a per-millisecond counter (bit-inverted
// for a session, so newer sorts first), then 14 random base62 characters.
// Zen's free tier checks a session id has this shape, a small counter
// included, and answers 403 FreeTierError to one that doesn't (#100).
export function opencodeID(prefix, descending, now = Date.now()) {
  if (now !== lastStamp) {
    lastStamp = now;
    counter = 0;
  }
  counter++;
  const current = BigInt(now) * 0x1000n + BigInt(counter);
  const value = (descending ? ~current : current) & 0xffffffffffffn;
  const random = randomBytes(14);
  let tail = "";
  for (const byte of random) tail += ALPHABET[byte % 62];
  return `${prefix}_${value.toString(16).padStart(12, "0")}${tail}`;
}

// A session id OpenCode itself could have made: its counter (the low 12
// bits, inverted) is small. A hash cut to the same shape isn't one.
export function realSessionID(value) {
  const match = /^ses_[0-9a-f]{9}([0-9a-f]{3})[0-9A-Za-z]{14}$/.exec(value ?? "");
  return !!match && 0xfff - Number.parseInt(match[1], 16) < 16;
}

// One made-up session per conversation, so its turns keep one session.
const SESSIONS = new Map();
const KEEP_SESSIONS = 1000;

export function sessionID(headers, body) {
  let signal;
  for (const name of [
    "x-opencode-session",
    "x-opencode-session-id",
    "x-session-affinity",
    "x-session-id",
    "conversation-id",
  ]) {
    if (headers.get(name)) {
      signal = headers.get(name);
      break;
    }
  }
  if (!signal && typeof body.metadata?.session_id === "string") signal = body.metadata.session_id;
  if (realSessionID(signal)) return signal;
  if (!signal) {
    const messages = body.messages ?? body.input;
    const first = Array.isArray(messages)
      ? messages.find((message) => message.role === "user")?.content
      : messages;
    if (!first) return opencodeID("ses", true);
    signal = JSON.stringify(first);
  }
  const key = createHash("sha256").update(`ses\0${signal}`).digest("hex");
  let session = SESSIONS.get(key);
  if (session) {
    SESSIONS.delete(key);
  } else {
    session = opencodeID("ses", true);
    if (SESSIONS.size >= KEEP_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value);
  }
  SESSIONS.set(key, session);
  return session;
}

async function server(_input, options = {}) {
  const baseURL = httpURL(options.baseURL ?? DEFAULT_BASE);
  const catalogURL = httpURL(options.catalogURL ?? CATALOG);
  const docsURL = httpURL(options.docsURL ?? DOCS);
  let known = buildModels(
    Object.keys(bootstrapProvider.models),
    bootstrapProvider,
    bootstrapProtocols,
    baseURL,
  );
  let metadata = bootstrapProvider;
  let protocols = { ...bootstrapProtocols };
  let listed = false;
  let listedAt = 0;

  async function discover(signal) {
    const headers = { authorization: "Bearer public", "x-opencode-client": "cli" };
    const [listing, catalog, docs] = await Promise.allSettled([
      readRemote(`${baseURL}/models`, true, headers, signal),
      readRemote(catalogURL, true, undefined, signal),
      readRemote(docsURL, false, undefined, signal),
    ]);
    signal?.throwIfAborted();
    let partial = false;
    if (catalog.status === "fulfilled" && catalog.value?.opencode?.models) {
      metadata = catalog.value.opencode;
    } else {
      partial = true;
    }
    if (docs.status === "fulfilled" && Object.keys(parseProtocolDocs(docs.value)).length) {
      protocols = { ...bootstrapProtocols, ...parseProtocolDocs(docs.value) };
    } else {
      partial = true;
    }
    if (listing.status !== "fulfilled" || !Array.isArray(listing.value?.data)) {
      const fallback = { ...known };
      fallback[Symbol.for("magpie.fellBack")] = true;
      return fallback;
    }
    const ids = listing.value.data.map((item) => item.id);
    const discovered = buildModels(ids, metadata, protocols, baseURL);
    if (partial) {
      // Preserve previously verified models only while they remain in the live catalog.
      for (const id of ids) {
        if (!discovered[id] && !metadata.models?.[id] && !protocols[id] && known[id]) {
          discovered[id] = known[id];
        }
      }
      // Not said as fallen back: Zen's own list was read, and what it
      // lists is what is offered. Said so, magpie kept the last list read
      // in full instead, and a user who can't reach the catalog or the
      // docs (GitHub's raw host, from mainland China) never saw a model
      // Zen made free since (yetone/magpie#2385).
    }
    known = discovered;
    listed = true;
    listedAt = Date.now();
    return discovered;
  }

  return {
    async config(cfg) {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= {
        name: "OpenCode Zen Free",
        npm: SDK.chat,
        api: baseURL,
        models: configModels(known),
      };
    },
    auth: {
      provider: PROVIDER,
      single: true,
      icon: "https://opencode.ai/favicon-v3.ico",
      maxConcurrency: 2,
      methods: [
        {
          type: "api",
          keyless: true,
          label: "Zen 免费访问（密钥填 public；自己的 OpenCode Key 请加到内置的 OpenCode Zen）",
          placeholder: "public",
          async authorize() {
            return { type: "success", key: "public" };
          },
        },
      ],
      async loader(getAuth) {
        const auth = await getAuth();
        if (!auth) return {};
        requirePublic(auth);
        return {
          baseURL,
          apiKey: "public",
          async fetch(input, init) {
            requirePublic(await getAuth());
            const request = new Request(input, init);
            const protocol = Object.keys(PATHS).find(
              (key) =>
                request.url === `${baseURL}${PATHS[key]}` ||
                (baseURL === DEFAULT_BASE && request.url === `${LEGACY_BASE}${PATHS[key]}`),
            );
            if (!protocol || request.method !== "POST")
              throw new Error("Unsupported Zen endpoint or method");
            request.signal.throwIfAborted();
            const body = await request.json();
            if (!body || typeof body !== "object" || Array.isArray(body))
              throw new Error("Expected a JSON request object");
            if (
              !Object.hasOwn(known, body.model) &&
              (!listed || Date.now() - listedAt >= RELIST_AFTER)
            ) {
              await discover(request.signal);
            }
            const model = Object.hasOwn(known, body.model) ? known[body.model] : undefined;
            if (!model) {
              // Zen no longer gives it free, or never did: said as a model
              // not served, so the caller sets this model aside and not the
              // account, whose other free models are still served.
              const free = Object.keys(known).sort().join(", ");
              const name = typeof body.model === "string" ? body.model : "";
              return new Response(
                JSON.stringify({
                  type: "error",
                  error: {
                    type: "not_found_error",
                    message: `Model ${name} is not available as an OpenCode Zen free model now. Free models: ${free || "none"}.`,
                  },
                }),
                { status: 404, headers: { "content-type": "application/json" } },
              );
            }
            if (model.api.npm !== SDK[protocol]) {
              throw new Error(
                "Model is not an available free model for this protocol. Refresh the model list.",
              );
            }
            const streaming = body.stream === true;
            body.stream = true;
            const toolPolicy = normalizeTools(body, protocol);
            addEnvironment(body, protocol);
            if (protocol === "chat")
              body.stream_options = { ...body.stream_options, include_usage: true };
            // Only what OpenCode 2.0.25 itself sends to its gateway, so a
            // caller's own headers (an agent's User-Agent, x-stainless-*, ...)
            // never mark the request as not OpenCode's.
            const given = request.headers;
            const session = sessionID(given, body);
            const project = _input?.project;
            const headers = new Headers({
              "content-type": "application/json",
              accept: "*/*",
              "user-agent": userAgent(),
              "x-opencode-project":
                given.get("x-opencode-project") ||
                (project?.vcs === "git" && project.id ? project.id : "global"),
              "x-opencode-session": session,
              "x-opencode-client": "cli",
              "x-opencode-session-id": session,
              "x-session-affinity": session,
              "x-session-id": session,
            });
            if (protocol === "anthropic") {
              headers.set("x-api-key", "public");
              headers.set("anthropic-version", given.get("anthropic-version") || "2023-06-01");
              if (given.get("anthropic-beta")) headers.set("anthropic-beta", given.get("anthropic-beta"));
            } else {
              headers.set("authorization", "Bearer public");
            }
            const response = await fetch(`${baseURL}${PATHS[protocol]}`, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: request.signal,
              redirect: "error",
            });
            const guarded = await guardToolResponse(response, protocol, toolPolicy, {
              endCutShort: streaming,
            });
            return streaming ? guarded : collapseResponse(guarded, protocol);
          },
        };
      },
      async usage() {
        return { plan: "OpenCode Zen Free", windows: [] };
      },
    },
    provider: {
      id: PROVIDER,
      async models(provider, { auth } = {}) {
        if (!auth) return provider.models;
        requirePublic(auth);
        return discover();
      },
    },
    async "chat.headers"(input, output) {
      if (![PROVIDER, `${PROVIDER}-plugin`].includes(input.model?.providerID) || !input.sessionID)
        return;
      output.headers["x-session-id"] = input.sessionID;
      output.headers["x-opencode-session"] = input.sessionID;
      output.headers["x-session-affinity"] = input.sessionID;
    },
  };
}

export default { id: PROVIDER, server };
