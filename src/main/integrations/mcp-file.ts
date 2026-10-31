// 编辑 MCP 服务器：直接改 omp 自己的 MCP 配置文件（用户级 agent 目录 `mcp.json`、项目 `.omp/mcp.json`）里的 `mcpServers.<name>`
// （仓库所有者 2026-10-24 同意的例外，见 docs/architecture/omp-boundaries.md「自己写 omp 配置的例外」和 docs/architecture/plugins.md「编辑 MCP 服务器」）：omp 没有修改命令。
// 规则（不扩大）：
// - 只改表单管的字段：stdio 的 command / args，远程的 url / type（http ↔ sse）/ `headers.Authorization`（omp `/mcp add --token` 写的
//   `Bearer <token>`，实测 18.12.6）；这一项里别的字段、别的服务器、顶层别的键、键的顺序、缩进、换行风格、BOM、末尾换行原样；
// - 解析不了的 JSON 不写；文件里有整数样的键（JSON 解析会把它们提到最前面）时也不写，免得打乱键序；
// - 原子写（src/main/tasks/atomic-write.ts），写前把旧内容留一份 `mcp.json.bak`；同进程内的写入串行；
// - token 只进不出：读出来的信息里只有"有没有"，日志里不出现 token。
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  McpEditErrorCode,
  McpEditInput,
  McpEditOutcome,
  McpEditScope,
  McpServerFile,
  McpTokenState,
} from "../../shared/mcp-edit.ts";
import { isRecord as isObject, isStringArray } from "../../shared/type-guards.ts";
import { log } from "../log/log.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";

type Json = Record<string, unknown>;

/** omp 写的文件路径：用户级在 agent 目录，项目级在项目的 `.omp/`。 */
export function mcpFilePath(scope: McpEditScope, agentDir: string, projectDir: string | null): string {
  if (scope === "user") return path.join(agentDir, "mcp.json");
  if (projectDir === null) throw new Error("project scope needs a project directory");
  return path.join(projectDir, ".omp", "mcp.json");
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

const fail = (code: McpEditErrorCode): { ok: false; code: McpEditErrorCode } => ({ ok: false, code });

/** 整数样的键（`"1"`、`"42"`）：JSON.parse 之后排在对象最前面，写回会打乱原来的顺序。 */
const INDEX_KEY = /^(?:0|[1-9]\d*)$/;

function reordersKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(reordersKeys);
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return (keys.length > 1 && keys.some((key) => INDEX_KEY.test(key))) || Object.values(value).some(reordersKeys);
}

interface Document {
  root: Json;
  bom: boolean;
  eol: "\r\n" | "\n";
  indent: string | number;
  finalNewline: boolean;
  /** 去掉 BOM 的原文，用来判断"改完没变化"。 */
  body: string;
}

function parseDocument(raw: string): Document | null {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(root)) return null;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const indented = /^([ \t]+)\S/.exec(lines.find((line) => /^[ \t]+\S/.test(line)) ?? "");
  const indent = indented?.[1] ?? (lines.length > 1 ? 2 : 0);
  return { root, bom, eol, indent, finalNewline: /\r?\n$/.test(body), body };
}

function render(doc: Document): string {
  let text = JSON.stringify(doc.root, null, doc.indent);
  if (doc.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  if (doc.finalNewline) text += doc.eol;
  return doc.bom ? `\uFEFF${text}` : text;
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** `headers` 里 Authorization 的键名（大小写不敏感）。 */
function authorizationKey(headers: Json): string | undefined {
  return Object.keys(headers).find((key) => key.toLowerCase() === "authorization");
}

/** 这一项的传输方式：显式的 `type`，没有就按 omp 发现时的推断（有 url 是 http，否则 stdio）；不认识的返回 null。 */
function transportOf(entry: Json): McpServerFile["transport"] | null {
  const type = entry["type"];
  if (type === undefined) return typeof entry["url"] === "string" ? "http" : "stdio";
  return type === "stdio" || type === "http" || type === "sse" ? type : null;
}

/** 找到 `mcpServers.<name>`；顶层没有 `mcpServers` 或没有这一项都是 not-found。 */
function findEntry(root: Json, name: string): Json | null {
  const servers = root["mcpServers"];
  if (!isObject(servers) || !Object.hasOwn(servers, name)) return null;
  const entry = servers[name];
  return isObject(entry) ? entry : null;
}

function describe(name: string, scope: McpEditScope, entry: Json): McpEditOutcome<McpServerFile> {
  const transport = transportOf(entry);
  if (transport === null) return fail("unsupported");
  if (transport === "stdio") {
    const args = entry["args"] ?? [];
    if (typeof entry["command"] !== "string" || !isStringArray(args) || args.some((arg) => /[\r\n]/.test(arg)))
      return fail("unsupported");
    return { ok: true, value: { name, scope, transport, command: entry["command"], args, url: "", token: "none" } };
  }
  const headers = entry["headers"];
  if (typeof entry["url"] !== "string" || (headers !== undefined && !isObject(headers))) return fail("unsupported");
  let token: McpTokenState = "none";
  if (headers !== undefined) {
    const key = authorizationKey(headers);
    if (key !== undefined) {
      if (typeof headers[key] !== "string") return fail("unsupported");
      token = "set";
    }
  }
  return { ok: true, value: { name, scope, transport, command: "", args: [], url: entry["url"], token } };
}

async function load(file: string, name: string): Promise<McpEditOutcome<{ doc: Document; entry: Json }>> {
  const raw = await readIfExists(file);
  if (raw === null) return fail("not-found");
  const doc = parseDocument(raw);
  if (doc === null) return fail("bad-json");
  if (reordersKeys(doc.root)) return fail("key-order");
  const entry = findEntry(doc.root, name);
  return entry === null ? fail("not-found") : { ok: true, value: { doc, entry } };
}

/** 编辑表单的初值。token 的值不返回。 */
export async function readMcpServer(
  file: string,
  name: string,
  scope: McpEditScope,
): Promise<McpEditOutcome<McpServerFile>> {
  const loaded = await load(file, name);
  return loaded.ok ? describe(name, scope, loaded.value.entry) : loaded;
}

function applyStdio(entry: Json, input: McpEditInput): void {
  entry["command"] = input.command;
  // 原来没写 args、现在也没有参数时不凭空加一个空数组。
  if (entry["args"] !== undefined || input.args.length > 0) entry["args"] = input.args;
}

function applyRemote(entry: Json, input: McpEditInput): void {
  entry["url"] = input.url;
  // 没写 type 时 omp 按有 url 推断成 http：选 http 就不加。
  if (entry["type"] !== input.transport && !(entry["type"] === undefined && input.transport === "http"))
    entry["type"] = input.transport;
  const token = input.token;
  if (token.kind === "keep") return;
  const headers: Json = isObject(entry["headers"]) ? entry["headers"] : {};
  const key = authorizationKey(headers);
  if (token.kind === "set") {
    headers[key ?? "Authorization"] = `Bearer ${token.value}`;
    entry["headers"] = headers;
    return;
  }
  if (key !== undefined) delete headers[key];
  // 只在这次把它删空时才去掉 headers（原来就写着空对象的不动）。
  if (key !== undefined && Object.keys(headers).length === 0) delete entry["headers"];
}

/** 同进程内 mcp.json 的写入串行：读-改-写之间不能被另一次写入插进来。 */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * 改 `mcpServers.<name>` 里表单管的字段。文件不存在、里面没有这一项、JSON 解析不了都不写。
 * 改完内容没变化时不写（也不留 `.bak`）。
 */
export function saveMcpServer(file: string, input: McpEditInput): Promise<McpEditOutcome<null>> {
  const run = async (): Promise<McpEditOutcome<null>> => {
    const loaded = await load(file, input.name);
    if (!loaded.ok) return loaded;
    const { doc, entry } = loaded.value;
    const current = describe(input.name, input.scope, entry);
    if (!current.ok) return current;
    if ((current.value.transport === "stdio") !== (input.transport === "stdio")) return fail("kind-mismatch");

    if (input.transport === "stdio") applyStdio(entry, input);
    else applyRemote(entry, input);

    const text = render(doc);
    if (text === (doc.bom ? `\uFEFF${doc.body}` : doc.body)) return { ok: true, value: null };
    await copyFile(file, `${file}.bak`);
    await writeFileAtomic(file, text, `omp-studio-${process.pid}`);
    log.info(
      `mcp ${input.scope} ${input.name}: edited ${input.transport}${input.token.kind === "keep" ? "" : ` token ${input.token.kind}`}`,
    );
    return { ok: true, value: null };
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}
