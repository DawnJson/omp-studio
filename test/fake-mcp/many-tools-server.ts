// 测试用的 MCP 服务器（stdio，按行的 JSON-RPC，MCP 规范的最小子集）：给出很多个长名字的工具，
// 让真实 omp 的 `/mcp test` 连上它，验证"测试连接"的结果在卡片里不会把整串工具名摊开（test/e2e/settings-functional.e2e.ts）。
// 用法：node test/fake-mcp/many-tools-server.ts [工具数，默认 60]
import { createInterface } from "node:readline";

const count = Number(process.argv[2] ?? 60);
const tools = Array.from({ length: count }, (_, index) => ({
  name: `workspace_long_tool_name_number_${String(index + 1).padStart(3, "0")}`,
  description: `Tool ${index + 1}`,
  inputSchema: { type: "object", properties: {} },
}));

function reply(id: unknown, body: { result: unknown } | { error: { code: number; message: string } }): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`);
}

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") continue;
  const message = JSON.parse(line) as { id?: unknown; method?: string; params?: { protocolVersion?: string } };
  if (message.id === undefined) continue; // 通知（notifications/initialized 等）不回。
  switch (message.method) {
    case "initialize":
      reply(message.id, {
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "many-tools", version: "1.0.0" },
        },
      });
      break;
    case "tools/list":
      reply(message.id, { result: { tools } });
      break;
    case "ping":
      reply(message.id, { result: {} });
      break;
    default:
      reply(message.id, { error: { code: -32601, message: `Method not found: ${message.method ?? ""}` } });
  }
}
