// 本地假的 OpenAI 兼容服务（node http）：`GET /v1/models` 和 `POST /v1/chat/completions`（流式 SSE 和非流式），
// 另有 `GET /api.json` 当假的公开模型目录（models.dev，STUDIO_MODELS_DEV_URL 指过来）。
// 给"自定义模型"的单测、真实 omp 冒烟和 e2e 用：不连任何真实服务，也不需要 key。
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeOpenAiOptions {
  models?: string[];
  reply?: string;
  /** 设了就要求 `Authorization: Bearer <apiKey>`，否则回 401。 */
  apiKey?: string;
  /** `GET /api.json` 回的公开模型目录（models.dev 的形状）；不设回 404。不要求 key。 */
  catalog?: unknown;
  /** `/v1/models` 里给这些模型带 `supported_endpoint_types`（new-api 系中转站的写法），没列的模型不带。 */
  endpointTypes?: Record<string, string[]>;
}

export interface FakeOpenAi {
  /** 形如 `http://127.0.0.1:PORT/v1`。 */
  baseUrl: string;
  /** 假的公开模型目录：`http://127.0.0.1:PORT/api.json`。 */
  catalogUrl: string;
  /** 收到的 chat completions 请求体里最后一条用户消息文本（测"任务真的把 prompt 发到了这里"）。 */
  prompts: string[];
  /** 收到的请求数（按路径）。 */
  hits: Record<string, number>;
  close(): Promise<void>;
}

function lastUserText(body: unknown): string {
  if (typeof body !== "object" || body === null || !("messages" in body) || !Array.isArray(body.messages)) return "";
  for (const message of body.messages.toReversed()) {
    if (typeof message !== "object" || message === null || !("role" in message) || message.role !== "user") continue;
    const content = "content" in message ? message.content : "";
    if (typeof content === "string") return content;
    if (Array.isArray(content))
      return content
        .map((part: unknown) => (typeof part === "object" && part !== null && "text" in part ? String(part.text) : ""))
        .join("");
  }
  return "";
}

export async function startFakeOpenAi(options: FakeOpenAiOptions = {}): Promise<FakeOpenAi> {
  const models = options.models ?? ["fake-chat", "fake-mini"];
  const reply = options.reply ?? "FAKE-REPLY-OK";
  const prompts: string[] = [];
  const hits: Record<string, number> = {};

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.method === "GET" && url.pathname === "/api.json" && options.catalog !== undefined) {
      json(200, options.catalog);
      return;
    }
    if (options.apiKey !== undefined && request.headers.authorization !== `Bearer ${options.apiKey}`) {
      json(401, { error: { message: "invalid api key", type: "invalid_request_error" } });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      json(200, {
        object: "list",
        data: models.map((id) => {
          const endpoints = options.endpointTypes?.[id];
          return {
            id,
            object: "model",
            created: 0,
            owned_by: "fake",
            ...(endpoints !== undefined && { supported_endpoint_types: endpoints }),
          };
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        let body: unknown = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          json(400, { error: { message: "bad json" } });
          return;
        }
        prompts.push(lastUserText(body));
        const model = typeof body === "object" && body !== null && "model" in body ? String(body.model) : "fake";
        const base = { id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model };
        if (typeof body === "object" && body !== null && "stream" in body && body.stream === true) {
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
          const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
          send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
          send({ ...base, choices: [{ index: 0, delta: { content: reply }, finish_reason: null }] });
          send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          send({ ...base, choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
          response.end("data: [DONE]\n\n");
          return;
        }
        json(200, {
          id: "chatcmpl-fake",
          object: "chat.completion",
          created: 0,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      });
      return;
    }
    json(404, { error: { message: `no route ${url.pathname}` } });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    catalogUrl: `http://127.0.0.1:${port}/api.json`,
    prompts,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
