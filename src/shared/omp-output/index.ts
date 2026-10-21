// omp 斜杠命令的"确定性文本"：渲染进程只能传下面两个封闭的联合类型，主进程把它们拼成 `/命令` 文本再交给 omp。
// 渲染进程从不发自由文本（AGENTS.md "preload 不暴露执行任意命令"）。
//
// - TaskCommand：会话级命令，在任务自己的 omp 进程里执行（TSP 任务走伪终端里的 `send`，rpc 任务走 `prompt`）。
// - BuiltinCommand：和会话无关的内置命令，在服务进程（用户范围）或项目目录里的短命 rpc-ui（项目范围）里执行。
//
// 每个功能切片在自己的注释块里追加联合成员、`parse*` 的 case 和 `*CommandText` 的 case；先重读再改，不动别人的块。
// 命令文本的格式不是 omp 的契约：用 omp 18.12.5 实测原文（native-ui-plan §2.1/§2.2）写单测，解析不了的输出界面显示原文。

// ───────── 共用校验 ─────────

/** 命令里的名字（MCP 服务器名、预设名等）：字母数字和 `._-`，不含空白和引号，拼进命令行不会被切开。 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** 已有预设的引用名（switch / delete）：omp 把参数按空白切开再用单个空格拼回，所以只能含"单个空格隔开的词"（实测 18.12.5：`my preset` 能切换，`a  b` 报 Preset not found: a b）。 */
// eslint-disable-next-line no-control-regex
const PRESET_REF = /^[^\s\u0000-\u001f\u007f]+(?: [^\s\u0000-\u001f\u007f]+)*$/;
/** 新预设名（save）：omp 18.12.5 的 `/modelpreset save` 只收 `^[a-zA-Z][\w-]*$`（读 omp 二进制得到，未逐条实测），这里同一规则加长度上限，不让用户撞 omp 的报错。 */
const PRESET_NEW = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
/** 命令参数里的单个词：不含空白、引号、控制字符。 */
// eslint-disable-next-line no-control-regex
const WORD = /^[^\s"'`\\\u0000-\u001f\u007f]{1,2000}$/;
/** 行内路径：可以有空格和反斜杠，但不能有换行等控制字符（否则会变成第二条命令）。 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function fail(message: string): never {
  throw new Error(`invalid command: ${message}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("expected an object");
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
    fail(`${label} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function name(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAME.test(value)) fail(`${label} must be 1-100 chars of letters, digits, . _ -`);
  return value;
}

function presetName(op: "save" | "switch" | "delete", value: unknown): string {
  if (op === "save") {
    if (typeof value !== "string" || !PRESET_NEW.test(value))
      fail("name must start with a letter, then letters, digits, _ or -");
    return value;
  }
  if (typeof value !== "string" || value.length > 200 || !PRESET_REF.test(value))
    fail("name must be words separated by single spaces");
  return value;
}

function word(value: unknown, label: string): string {
  if (typeof value !== "string" || !WORD.test(value))
    fail(`${label} must be a single word without whitespace or quotes`);
  return value;
}

/**
 * `/mcp add` 的 `-- <命令> <参数…>` 里的一个词。实测 omp 18.12.5：`add` 的切词认双引号（`"a b"` 是一个词，引号内的单引号和反斜杠照原样保留，
 * `"C:\Program Files\x.exe"` 保存成 `C:\Program Files\x.exe`），但**不认转义**：`\"` 里的引号照样开合，所以词里不能有 `"`。
 * 含空白或单引号的词加双引号；不合法的抛错，不改写用户的值。
 */
function plainArg(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || value.length > 2000 || CONTROL.test(value) || value.includes('"'))
    fail(`${label} must be a non-empty single-line string without double quotes`);
  return value;
}

function quoteArg(value: unknown, label: string): string {
  const text = plainArg(value, label);
  return /[\s']/.test(text) ? `"${text}"` : text;
}

/** 路径等"整行剩余部分"参数：非空、无控制字符。 */
function line(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 4096 || CONTROL.test(value))
    fail(`${label} must be a non-empty single-line string`);
  return value;
}

// ───────── TaskCommand：会话级，在任务自己的 omp 里执行 ─────────

// ── S0 基础（切换、置顶、重试、压缩、作业、插件、工作区目录、模型预设、浏览器、prewalk）──

export const TOGGLE_NAMES = ["skillful", "extendedContext", "computer", "advisor", "fast", "slow"] as const;
/** 开关名 → omp 斜杠命令名（`extendedContext` 的命令是 `/extended-context`）。 */
const TOGGLE_SLASH: Record<(typeof TOGGLE_NAMES)[number], string> = {
  skillful: "skillful",
  extendedContext: "extended-context",
  computer: "computer",
  advisor: "advisor",
  fast: "fast",
  slow: "slow",
};
/** `arm` = 不带参数的 `/prewalk`（单发动作）。 */
export const PREWALK_OPS = ["arm", "restart", "off"] as const;
export const MODEL_PRESET_OPS = ["list", "save", "switch", "delete"] as const;
export const BROWSER_MODES = ["headless", "visible"] as const;

export type TaskCommand =
  | { kind: "toggle"; name: (typeof TOGGLE_NAMES)[number]; on: boolean }
  | { kind: "pin" }
  | { kind: "retry" }
  | { kind: "compact" }
  /** `id` 是作业 id（如 `bg_1`）或 "all"。 */
  | { kind: "jobsKill"; id: string }
  | { kind: "reloadPlugins" }
  | { kind: "dirs" }
  | { kind: "addDir"; path: string }
  | { kind: "removeDir"; path: string }
  | { kind: "modelPreset"; op: "list" }
  | { kind: "modelPreset"; op: "save" | "switch" | "delete"; name: string }
  | { kind: "browserMode"; mode: (typeof BROWSER_MODES)[number] }
  | { kind: "prewalk"; op: (typeof PREWALK_OPS)[number] };

// ── 各切片在这里下面追加自己的 TaskCommand 成员（`| { kind: ... }`）并在两个 switch 里加 case ──

/** 校验来自渲染进程的值；不合法抛 Error（validate.ts 包成 IpcValidationError）。 */
export function parseTaskCommand(value: unknown): TaskCommand {
  const input = asRecord(value);
  switch (input["kind"]) {
    case "toggle":
      return { kind: "toggle", name: oneOf(input["name"], TOGGLE_NAMES, "name"), on: bool(input["on"], "on") };
    case "pin":
    case "retry":
    case "compact":
    case "reloadPlugins":
    case "dirs":
      return { kind: input["kind"] };
    case "jobsKill": {
      const id = input["id"];
      return { kind: "jobsKill", id: id === "all" ? "all" : name(id, "id") };
    }
    case "addDir":
    case "removeDir":
      return { kind: input["kind"], path: line(input["path"], "path") };
    case "modelPreset": {
      const op = oneOf(input["op"], MODEL_PRESET_OPS, "op");
      return op === "list"
        ? { kind: "modelPreset", op }
        : { kind: "modelPreset", op, name: presetName(op, input["name"]) };
    }
    case "browserMode":
      return { kind: "browserMode", mode: oneOf(input["mode"], BROWSER_MODES, "mode") };
    case "prewalk":
      return { kind: "prewalk", op: oneOf(input["op"], PREWALK_OPS, "op") };
    default:
      return fail(`unknown task command ${JSON.stringify(input["kind"])}`);
  }
}

/** TaskCommand → omp 的 `/命令` 文本。 */
export function taskCommandText(cmd: TaskCommand): string {
  switch (cmd.kind) {
    case "toggle":
      return `/${TOGGLE_SLASH[cmd.name]} ${cmd.on ? "on" : "off"}`;
    case "pin":
      return "/pin";
    case "retry":
      return "/retry";
    case "compact":
      return "/compact";
    case "jobsKill":
      return `/jobs kill ${cmd.id}`;
    case "reloadPlugins":
      return "/reload-plugins";
    case "dirs":
      return "/dirs";
    case "addDir":
      return `/add-dir ${line(cmd.path, "path")}`;
    case "removeDir":
      return `/remove-dir ${line(cmd.path, "path")}`;
    case "modelPreset":
      return cmd.op === "list" ? "/modelpreset list" : `/modelpreset ${cmd.op} ${presetName(cmd.op, cmd.name)}`;
    case "browserMode":
      return `/browser ${cmd.mode}`;
    case "prewalk":
      return cmd.op === "arm" ? "/prewalk" : `/prewalk ${cmd.op}`;
  }
}

// ───────── BuiltinCommand：和会话无关，在服务进程 / 项目 rpc-ui 里执行 ─────────

// ── S0 基础（tools / session / mcp / memory / changelog）──

export const MCP_SCOPES = ["user", "project"] as const;
/** rpc-ui 下 `/mcp reauth|unauth|reconnect` 只回 "only available in the TUI client"（实测 18.12.5），不收。 */
export const MCP_SIMPLE_OPS = ["enable", "disable", "test"] as const;
export const MCP_TRANSPORTS = ["http", "sse"] as const;
export const MEMORY_OPS = ["view", "stats", "diagnose", "queue", "sync", "clear", "reset", "rebuild"] as const;

export type McpAddSpec =
  | { type: "stdio"; command: string; args: string[] }
  /** `token` 变成 omp 写进配置的 `Authorization: Bearer <token>` 头（实测 18.12.5：`--token abc`）。 */
  | { type: "remote"; transport: (typeof MCP_TRANSPORTS)[number]; url: string; token?: string };

export type BuiltinCommand =
  | { kind: "tools" }
  | { kind: "session" }
  | { kind: "changelog" }
  | { kind: "mcp"; op: "list" }
  | { kind: "mcp"; op: "add"; name: string; scope: (typeof MCP_SCOPES)[number]; spec: McpAddSpec }
  | { kind: "mcp"; op: "remove"; name: string; scope: (typeof MCP_SCOPES)[number] }
  | { kind: "mcp"; op: (typeof MCP_SIMPLE_OPS)[number]; name: string }
  | { kind: "memory"; op: (typeof MEMORY_OPS)[number] };

// ── 各切片在这里下面追加自己的 BuiltinCommand 成员并在两个 switch 里加 case ──

export function parseBuiltinCommand(value: unknown): BuiltinCommand {
  const input = asRecord(value);
  switch (input["kind"]) {
    case "tools":
    case "session":
    case "changelog":
      return { kind: input["kind"] };
    case "memory":
      return { kind: "memory", op: oneOf(input["op"], MEMORY_OPS, "op") };
    case "mcp":
      return parseMcp(input);
    default:
      return fail(`unknown builtin command ${JSON.stringify(input["kind"])}`);
  }
}

function parseMcp(input: Record<string, unknown>): BuiltinCommand {
  const op = oneOf(input["op"], ["list", "add", "remove", ...MCP_SIMPLE_OPS] as const, "op");
  if (op === "list") return { kind: "mcp", op };
  const serverName = name(input["name"], "name");
  if (op === "remove") return { kind: "mcp", op, name: serverName, scope: oneOf(input["scope"], MCP_SCOPES, "scope") };
  if (op !== "add") return { kind: "mcp", op, name: serverName };
  const scope = oneOf(input["scope"], MCP_SCOPES, "scope");
  const spec = asRecord(input["spec"]);
  if (spec["type"] === "stdio") {
    const args = spec["args"];
    if (!Array.isArray(args) || args.length > 64) fail("spec.args must be an array");
    return {
      kind: "mcp",
      op,
      name: serverName,
      scope,
      spec: {
        type: "stdio",
        command: plainArg(spec["command"], "spec.command"),
        args: args.map((arg) => plainArg(arg, "spec.args")),
      },
    };
  }
  if (spec["type"] === "remote") {
    const token = spec["token"];
    return {
      kind: "mcp",
      op,
      name: serverName,
      scope,
      spec: {
        type: "remote",
        transport: oneOf(spec["transport"], MCP_TRANSPORTS, "spec.transport"),
        url: word(spec["url"], "spec.url"),
        ...(token === undefined ? {} : { token: word(token, "spec.token") }),
      },
    };
  }
  return fail("spec.type must be stdio or remote");
}

/** BuiltinCommand → omp 的 `/命令` 文本（格式见 native-ui-plan §2.2，omp 18.12.5 实测）。 */
export function builtinCommandText(cmd: BuiltinCommand): string {
  switch (cmd.kind) {
    case "tools":
      return "/tools";
    case "session":
      return "/session";
    case "changelog":
      return "/changelog";
    case "memory":
      return `/memory ${cmd.op}`;
    case "mcp":
      return mcpText(cmd);
  }
}

function mcpText(cmd: Extract<BuiltinCommand, { kind: "mcp" }>): string {
  switch (cmd.op) {
    case "list":
      return "/mcp list";
    case "remove":
      return `/mcp remove ${name(cmd.name, "name")} --scope ${cmd.scope}`;
    case "add": {
      const head = `/mcp add ${name(cmd.name, "name")} --scope ${cmd.scope}`;
      if (cmd.spec.type === "remote") {
        const remote = `${head} --url ${word(cmd.spec.url, "url")} --transport ${cmd.spec.transport}`;
        return cmd.spec.token === undefined ? remote : `${remote} --token ${word(cmd.spec.token, "token")}`;
      }
      return [
        head,
        "--",
        quoteArg(cmd.spec.command, "command"),
        ...cmd.spec.args.map((arg) => quoteArg(arg, "arg")),
      ].join(" ");
    }
    default:
      return `/mcp ${cmd.op} ${name(cmd.name, "name")}`;
  }
}

/** 命令文本的第一个词（不含 `/`），`runBuiltin` 用它去 get_available_commands 里核对。 */
export function commandName(text: string): string {
  const match = /^\/([^\s]+)/.exec(text);
  if (!match?.[1]) throw new Error(`not a slash command: ${text}`);
  return match[1];
}
