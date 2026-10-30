export const PROVIDER = "opencode-zen-free";
export const SDK = {
  chat: "@ai-sdk/openai-compatible",
  responses: "@ai-sdk/openai",
  anthropic: "@ai-sdk/anthropic",
};

export function parseProtocolDocs(text) {
  const protocols = {};
  const pattern =
    /\|[^|]+\|\s*`?([^|`\s]+)`?\s*\|\s*`[^`]+\/v1\/(chat\/completions|responses|messages|systemone)`/g;
  for (const match of text.matchAll(pattern)) {
    protocols[match[1]] = {
      "chat/completions": "chat",
      responses: "responses",
      messages: "anthropic",
      systemone: "systemone",
    }[match[2]];
  }
  return protocols;
}

function sdkProtocol(npm) {
  if (npm?.includes("anthropic")) return "anthropic";
  if (npm === SDK.responses) return "responses";
  if (npm?.includes("openai-compatible")) return "chat";
}

function isRetired(model) {
  return (
    model.deprecated === true ||
    ["deprecated", "retired", "disabled"].includes(model.status ?? model.lifecycle) ||
    model.deprecated_at != null ||
    model.retirement_date != null
  );
}

export function isFree(id, model = {}) {
  return (
    !isRetired(model) && (/free/i.test(id) || (model.cost?.input === 0 && model.cost?.output === 0))
  );
}

// A model Zen lists whose id says it is free (Zen names them "-free"), and
// that neither the catalog nor the docs describe yet: Zen made it free
// after they were last written (deepseek-v4.1-flash-free, yetone/magpie#2385),
// or they couldn't be read. It is asked as OpenCode asks a model with no
// package of its own, through the provider's (openai-compatible, chat), so
// a new free model is offered the hour Zen lists it, not when the catalog
// or this plugin catch up. A paid or zero-cost id the id doesn't call free
// still needs the catalog's word.
function listedFree(id) {
  return /-free$/.test(id);
}

// "258K" is the model's working label, not an exact maximum. Zen's live
// catalog lists deepseek-v4.1-flash-free at 200000, but on 2026-10-26 a
// request whose upstream usage was in 576 + cache_read 258,048 = 258,624
// tokens got a 200 from the free tier. That is the measured floor; the
// later 283,545-token attempt was magpie's own estimate, not upstream
// usage, so it is not a ceiling. Reporting more than the vendor accepts
// routes requests that then fail, so the floor is used until a source
// says more. Remove this when the catalog carries the real value.
const CONTEXT_FLOOR = {
  "deepseek-v4.1-flash-free": 258_624,
};

export function buildModels(ids, provider, protocols, baseURL) {
  const result = {};
  for (const id of ids) {
    if (typeof id !== "string" || !id || id === "__proto__") continue;
    const raw = provider.models?.[id];
    const model = raw ?? {};
    const protocol =
      protocols[id] ??
      (raw
        ? sdkProtocol(model.provider?.npm ?? provider.npm)
        : listedFree(id)
          ? (sdkProtocol(provider.npm) ?? "chat")
          : undefined);
    if (!isFree(id, model) || !Object.hasOwn(SDK, protocol)) continue;
    const input = model.modalities?.input ?? ["text"];
    const output = model.modalities?.output ?? ["text"];
    const modalities = (values) =>
      Object.fromEntries(
        ["text", "image", "audio", "video", "pdf"].map((name) => [name, values.includes(name)]),
      );
    const efforts = (model.reasoning_options ?? [])
      .filter((option) => option.type === "effort")
      .flatMap((option) => option.values ?? []);
    result[id] = {
      id,
      providerID: PROVIDER,
      name: model.name ?? id,
      api: { id, url: baseURL, npm: SDK[protocol] },
      limit: {
        output: 4096,
        ...model.limit,
        context: CONTEXT_FLOOR[id]
          ? Math.max(model.limit?.context ?? 0, CONTEXT_FLOOR[id])
          : model.limit?.context ?? 32768,
      },
      capabilities: {
        temperature: model.temperature ?? true,
        reasoning: model.reasoning ?? false,
        attachment: model.attachment ?? input.some((name) => name !== "text"),
        toolcall: model.tool_call ?? true,
        input: modalities(input),
        output: modalities(output),
        interleaved: model.interleaved ?? false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      variants: Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }])),
      options: {},
      headers: {},
      status: model.status ?? "active",
      release_date: model.release_date ?? "",
      free: true,
    };
  }
  return result;
}

// What each free model is asked at, from OpenCode's console docs
// (services/www/src/docs/content/console/models.mdx) on 2026-10-15: used for
// a listed model when the docs can't be read, so the catalog or the docs
// being out of reach never leaves a listed free model out. Jev is a
// SystemOne decision model, not one to chat with.
export const bootstrapProtocols = {
  "big-pickle": "chat",
  "space-bunny-free": "chat",
  "cat-jam-free": "chat",
  "longcat-2.5-preview-free": "chat",
  "step-5-preview-free": "chat",
  "mimo-v2.6-flash-free": "chat",
  "nemotron-3.5-lightning-free": "chat",
  "muse-spark-1.3-contributor-free": "responses",
  "jev-1.13-free": "systemone",
};

// Offline bootstrap metadata from the OpenCode catalog, 2026-10-06; the
// free models listed since added on 2026-10-15.
export const bootstrapProvider = {
  npm: SDK.chat,
  models: {
    "cat-jam-free": {
      name: "Cat Jam Free",
      cost: { input: 0, output: 0 },
      limit: { context: 262144, output: 131072 },
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
      reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
    },
    "step-5-preview-free": {
      name: "Step 5 Preview Free",
      cost: { input: 0, output: 0 },
      limit: { context: 1000000, input: 1000000, output: 65536 },
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
    },
    "longcat-2.5-preview-free": {
      name: "LongCat 2.5 Preview Free",
      cost: { input: 0, output: 0 },
      limit: { context: 1000000, output: 131072 },
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    "mimo-v2.6-flash-free": {
      name: "MiMo-V2.6-Flash Free",
      cost: { input: 0, output: 0 },
      limit: { context: 200000, output: 32000 },
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
      modalities: { input: ["text", "image", "audio", "video"], output: ["text"] },
    },
    "nemotron-3.5-lightning-free": {
      name: "Nemotron 3.5 Lightning Free",
      cost: { input: 0, output: 0 },
      limit: { context: 262144, output: 262144 },
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
    },
    "big-pickle": {
      name: "Big Pickle",
      cost: { input: 0, output: 0 },
      limit: { context: 200000, input: 160000, output: 32000 },
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
    },
    "space-bunny-free": {
      name: "Space Bunny Free",
      cost: { input: 0, output: 0 },
      limit: { context: 1048576, input: 524288, output: 524288 },
      reasoning: true,
      tool_call: true,
    },
    "muse-spark-1.3-contributor-free": {
      name: "Muse Spark 1.3 Free",
      cost: { input: 0, output: 0 },
      provider: { npm: SDK.responses },
      limit: { context: 1048576, output: 131072 },
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image", "video", "pdf", "audio"], output: ["text"] },
      reasoning_options: [
        { type: "effort", values: ["minimal", "low", "medium", "high", "xhigh"] },
      ],
    },
  },
};

export function configModels(models) {
  return Object.fromEntries(
    Object.entries(models).map(([id, model]) => [
      id,
      {
        id,
        name: model.name,
        provider: { npm: model.api.npm, api: model.api.url },
        limit: model.limit,
        reasoning: model.capabilities.reasoning,
        tool_call: model.capabilities.toolcall,
        attachment: model.capabilities.attachment,
        modalities: {
          input: Object.keys(model.capabilities.input).filter(
            (key) => model.capabilities.input[key],
          ),
          output: Object.keys(model.capabilities.output).filter(
            (key) => model.capabilities.output[key],
          ),
        },
        cost: { input: 0, output: 0 },
        variants: model.variants,
        free: true,
      },
    ]),
  );
}
