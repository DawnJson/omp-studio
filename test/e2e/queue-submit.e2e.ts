// 真实官方 omp + 本地流式假模型：首请求不结束，只有中断当前轮才能让排队消息进入下一请求。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { findOmpOnPath } from "../../src/main/omp/discover.ts";
import { launchApp, type LaunchedApp } from "./launch.ts";

const FIRST = "QUEUE_FIRST_REQUEST";
const QUEUED = "QUEUE_PRIORITY_REQUEST";
const ANSWER = "QUEUE_PRIORITY_PROCESSED";

async function start() {
  const requests: string[][] = [];
  let interrupted = false;
  let finishQueued: (() => void) | undefined;
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: ["queue-one", "queue-title"].map((id) => ({ id, object: "model" })) }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        messages: { role: string; content: string | { text?: string }[] }[];
      };
      const users = body.messages
        .filter((message) => message.role === "user")
        .map((message) =>
          typeof message.content === "string"
            ? message.content
            : message.content.map((part) => part.text ?? "").join(""),
        );
      // 标题使用独立 tiny/smol 模型，不能把它带出的对话原文算成主会话重复发送。
      const main = body.model === "queue-one";
      const lastUser = users.at(-1) ?? "";
      const first = main && lastUser.includes(FIRST);
      const queued = main && lastUser.includes(QUEUED);
      if (main) requests.push(users);
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = (delta: unknown, finish: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id: "queue-response", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      send({ role: "assistant", content: "" });
      if (!first && !queued) {
        send({ content: "<title>Process queue test</title>" });
        send({}, "stop");
        response.end("data: [DONE]\n\n");
        return;
      }
      if (!queued) {
        send({ content: "ORIGINAL_REQUEST_PENDING" });
        response.on("close", () => {
          if (!response.writableEnded) interrupted = true;
        });
        return;
      }
      finishQueued = () => {
        send({ content: ANSWER });
        send({}, "stop");
        response.end("data: [DONE]\n\n");
      };
    });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const work = await mkdtemp(path.join(os.tmpdir(), "omp queue submit e2e-"));
  const agentDir = path.join(work, "agent");
  const project = path.join(work, "项目 目录");
  let launched: LaunchedApp | undefined;
  const cleanup = async () => {
    try {
      await launched?.close();
    } finally {
      server.closeAllConnections();
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
      await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await mkdir(project);
    await writeFile(
      path.join(agentDir, "models.yml"),
      `providers:\n  queue-local:\n    baseUrl: ${baseUrl}\n    auth: none\n    api: openai-completions\n    models:\n      - id: queue-one\n      - id: queue-title\n`,
      "utf8",
    );
    await writeFile(
      path.join(agentDir, "config.yml"),
      "startup:\n  setupWizard: false\nmodelRoles:\n  default: queue-local/queue-one\n  tiny: queue-local/queue-title\n  smol: queue-local/queue-title\ntitle:\n  generator: tiny\n",
      "utf8",
    );
    launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir, HOME: work, USERPROFILE: work });
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    const input = page.getByTestId("composer-input");
    await input.fill(FIRST);
    await input.press("Enter");
    await expect(page.getByTestId("tsp-view")).toContainText("ORIGINAL_REQUEST_PENDING", { timeout: 30_000 });
    await input.fill(QUEUED);
    await input.press("Enter");
    await expect(page.locator('[data-role="omp.queue.item"]')).toContainText(QUEUED, { timeout: 15_000 });
    await expect(input).toHaveValue("");
    expect(requests.some((users) => users.some((text) => text.includes(QUEUED)))).toBe(false);
    return {
      launched,
      requests,
      interrupted: () => interrupted,
      queuedReady: () => finishQueued !== undefined,
      finish: () => finishQueued?.(),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test("排队后空输入框再次 Enter：中断原请求，新请求只接收一次排队消息，不取回或重复发送", async () => {
  test.skip((await findOmpOnPath().catch(() => null)) === null, "PATH 上没有 omp");
  test.setTimeout(90_000);
  const h = await start();
  try {
    const { page } = h.launched;
    await page.getByTestId("composer-input").press("Enter");
    await expect.poll(h.interrupted, { timeout: 10_000 }).toBe(true);
    await expect.poll(h.queuedReady, { timeout: 15_000 }).toBe(true);
    h.finish();
    await expect(page.getByTestId("tsp-view")).toContainText(ANSWER, { timeout: 15_000 });
    await expect(page.getByTestId("send-button")).toBeVisible();
    await expect(page.getByTestId("composer-input")).toHaveValue("");
    await expect(page.locator('[data-role="omp.queue.item"]')).toHaveCount(0);
    const delivered = h.requests.filter((users) => users.some((text) => text.includes(QUEUED)));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.filter((text) => text.includes(QUEUED))).toHaveLength(1);
  } finally {
    await h.cleanup();
  }
});
