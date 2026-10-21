// S5（设置页的 MCP / SSH / 工具 / 记忆 / 更新日志）的解析器和命令文本。样本是 omp 18.12.5 rpc-ui 的原文（临时 PI_CODING_AGENT_DIR 实测，2026-10-21）。
import { describe, expect, it } from "vitest";
import { builtinCommandText, parseBuiltinCommand } from "../src/shared/omp-output/index.ts";
import { splitChangelog } from "../src/shared/omp-output/changelog.ts";
import { isManageableMcpName, mcpOutcome, parseMcpList, parseMcpTest } from "../src/shared/omp-output/mcp.ts";
import { parseSshList, sshWriteResult } from "../src/shared/omp-output/ssh.ts";
import { parseTools, toolConfigKey } from "../src/shared/omp-output/tools.ts";

describe("parseMcpList（/mcp list）", () => {
  it("空列表", () => {
    expect(parseMcpList("No MCP servers configured.")).toEqual({ servers: [], unparsed: [] });
  });

  it("多个服务器：传输、启用、目标、范围；名字带空格也认", () => {
    const text = [
      "real | stdio | enabled | node [user]",
      "win | stdio | enabled | C:\\Program Files\\nodejs\\node.exe [user]",
      "x1 | http | disabled | http://127.0.0.1:9/mcp [user]",
      "p q | stdio | enabled | node [project]",
    ].join("\n");
    const list = parseMcpList(text);
    expect(list.unparsed).toEqual([]);
    expect(list.servers).toEqual([
      { name: "real", transport: "stdio", enabled: true, target: "node", scope: "user" },
      { name: "win", transport: "stdio", enabled: true, target: "C:\\Program Files\\nodejs\\node.exe", scope: "user" },
      { name: "x1", transport: "http", enabled: false, target: "http://127.0.0.1:9/mcp", scope: "user" },
      { name: "p q", transport: "stdio", enabled: true, target: "node", scope: "project" },
    ]);
  });

  it("认不出的行原样放进 unparsed，不吞", () => {
    const list = parseMcpList("a | stdio | enabled | node [user]\nsomething new");
    expect(list.servers).toHaveLength(1);
    expect(list.unparsed).toEqual(["something new"]);
  });

  it("名字带空格的服务器 remove/enable/disable/test 管不了（omp 按空白切词）", () => {
    expect(isManageableMcpName("real")).toBe(true);
    expect(isManageableMcpName("b c")).toBe(false);
    expect(isManageableMcpName("../y")).toBe(false);
  });
});

describe("mcpOutcome：只认已知的成功句式", () => {
  it.each([
    'Added MCP server "a" (user).',
    'Added MCP server "b c" (project).',
    'Removed server "a" from user config.',
    'Server "a" disabled (user config).',
    'Server "a" enabled (user config).',
    "MCP runtime reload requested.",
  ])("成功：%s", (text) => {
    expect(mcpOutcome(text).ok).toBe(true);
  });

  it.each([
    "Unknown option: --header",
    'Failed to add server: Server "x1" already exists in C:\\agent\\mcp.json',
    "Invalid --transport value. Use http or sse.",
    "Server name required. Usage: /mcp add <name> ...",
    'Failed to remove MCP server: Server "nope" not found in C:\\agent\\mcp.json',
    'Server "x1" not found. Run /mcp list to see configured servers.',
    "/mcp reauth requires OAuth or browser flows only available in the TUI client.",
  ])("失败，原文保留：%s", (text) => {
    expect(mcpOutcome(text)).toEqual({ ok: false, message: text });
  });
});

describe("parseMcpTest（/mcp test）", () => {
  it("连上：工具数和工具名", () => {
    expect(parseMcpTest('Server "real" connected (1 tools).\n  - ping')).toEqual({
      connected: true,
      toolCount: 1,
      tools: ["ping"],
    });
  });

  it("连不上：原文", () => {
    const text = 'Connection to "a" failed: MCP subprocess closed stdout before responding';
    expect(parseMcpTest(text)).toEqual({ connected: false, message: text });
  });
});

describe("/mcp add 的命令文本（实测切词：只有 add 认双引号，不认转义）", () => {
  const stdio = (command: string, args: string[]) =>
    builtinCommandText(
      parseBuiltinCommand({
        kind: "mcp",
        op: "add",
        name: "demo",
        scope: "user",
        spec: { type: "stdio", command, args },
      }),
    );

  it("含空格的命令和参数加双引号，其余不动", () => {
    expect(stdio("C:\\Program Files\\nodejs\\node.exe", ["-e", "console.log('x y')", "a b"])).toBe(
      '/mcp add demo --scope user -- "C:\\Program Files\\nodejs\\node.exe" -e "console.log(\'x y\')" "a b"',
    );
    expect(stdio("node", ["server.js", "--flag"])).toBe("/mcp add demo --scope user -- node server.js --flag");
  });

  it("参数里有双引号或换行：拒绝，不改写", () => {
    expect(() => stdio("node", ['say "hi"'])).toThrow(/double quotes/);
    expect(() => stdio("node", ["a\n/mcp remove x"])).toThrow(/single-line/);
    expect(() => stdio("", [])).toThrow();
  });

  it("http / sse：url、transport、可选 token", () => {
    const remote = (token?: string) =>
      builtinCommandText(
        parseBuiltinCommand({
          kind: "mcp",
          op: "add",
          name: "r",
          scope: "project",
          spec: { type: "remote", transport: "sse", url: "http://127.0.0.1:9/sse", ...(token && { token }) },
        }),
      );
    expect(remote()).toBe("/mcp add r --scope project --url http://127.0.0.1:9/sse --transport sse");
    expect(remote("abc")).toBe("/mcp add r --scope project --url http://127.0.0.1:9/sse --transport sse --token abc");
    expect(() => remote("a b")).toThrow();
  });

  it("rpc-ui 里做不了的 reauth / unauth / reconnect 不在允许的命令里", () => {
    for (const op of ["reauth", "unauth", "reconnect"])
      expect(() => parseBuiltinCommand({ kind: "mcp", op, name: "x" })).toThrow();
  });
});

describe("parseTools（/tools）", () => {
  const sample = "* read\n* bash\n- ast_edit\n* web_search\n~ xd://ast_edit\n~ xd://lsp";

  it("启用 / 可选未启用 / xd 设备", () => {
    expect(parseTools(sample)).toEqual({
      tools: [
        { name: "read", state: "enabled" },
        { name: "bash", state: "enabled" },
        { name: "ast_edit", state: "inactive" },
        { name: "web_search", state: "enabled" },
        { name: "xd://ast_edit", state: "device" },
        { name: "xd://lsp", state: "device" },
      ],
      unparsed: [],
    });
  });

  it("认不出的行放进 unparsed", () => {
    expect(parseTools("* read\n?? what").unparsed).toEqual(["?? what"]);
  });

  it("工具名 → 设置项：snake 和 camel 两种写法都试，快照里没有就没有开关", () => {
    const keys = new Set(["astEdit.enabled", "web_search.enabled", "lsp.enabled"]);
    expect(toolConfigKey("ast_edit", keys)).toBe("astEdit.enabled");
    expect(toolConfigKey("web_search", keys)).toBe("web_search.enabled");
    expect(toolConfigKey("lsp", keys)).toBe("lsp.enabled");
    expect(toolConfigKey("read", keys)).toBeNull();
  });
});

describe("ssh --json", () => {
  const listing = JSON.stringify({
    project: { pbox: { host: "10.0.0.1" } },
    user: {
      box: {
        host: "127.0.0.1",
        username: "me",
        port: 2222,
        keyPath: "C:\\Users\\me\\.ssh\\id rsa",
        description: 'my box, with "quotes"',
      },
      cmp: { host: "h", compat: true },
    },
  });

  it("list：两个范围、全部字段", () => {
    const hosts = parseSshList(listing);
    expect(hosts.map((host) => `${host.scope}:${host.name}`)).toEqual(["user:box", "user:cmp", "project:pbox"]);
    expect(hosts[0]).toEqual({
      name: "box",
      scope: "user",
      host: "127.0.0.1",
      username: "me",
      port: 2222,
      keyPath: "C:\\Users\\me\\.ssh\\id rsa",
      description: 'my box, with "quotes"',
      compat: false,
    });
    expect(hosts[1]?.compat).toBe(true);
  });

  it("空列表", () => {
    expect(parseSshList('{"project":{},"user":{}}')).toEqual([]);
  });

  it("不是预期的 JSON：抛错并带原文", () => {
    expect(() => parseSshList("No hosts")).toThrow(/did not print JSON: No hosts/);
    expect(() => parseSshList('{"user":{}}')).toThrow(/project/);
  });

  it("写操作：成功返回原话；失败（错误在 stdout）带原话抛出", () => {
    expect(sshWriteResult({ code: 0, stdout: 'Added SSH host "box" to user config\n', stderr: "" })).toBe(
      'Added SSH host "box" to user config',
    );
    expect(() =>
      sshWriteResult({
        code: 1,
        stdout: "Error: --host is required\nUsage: omp ssh add <name> --host <address>\n",
        stderr: "",
      }),
    ).toThrow(/^--host is required/);
    expect(() =>
      sshWriteResult({ code: 1, stdout: "", stderr: "error: Option '--desc' argument is ambiguous." }),
    ).toThrow(/ambiguous/);
    expect(() => sshWriteResult({ code: 2, stdout: "", stderr: "" })).toThrow(/code 2/);
  });
});

describe("splitChangelog（/changelog）", () => {
  const sample = [
    "## [18.12.3] - 2026-10-19",
    "",
    "### Added",
    "",
    "- Added the **Ask and remember** approval mode",
    "",
    "## [18.12.2] - 2026-10-14",
    "",
    "### Fixed",
    "",
    "- Fixed `/mcp reauth` and `/mcp add` opening an unrelated origin-root authorization server's login page",
  ].join("\n");

  it("按版本分节", () => {
    const sections = splitChangelog(sample);
    expect(sections.map((section) => [section.version, section.date])).toEqual([
      ["18.12.3", "2026-10-19"],
      ["18.12.2", "2026-10-14"],
    ]);
    expect(sections[0]?.body.startsWith("### Added")).toBe(true);
    expect(sections[1]?.body).toContain("/mcp reauth");
  });

  it("omp 按时间正序输出：排成从新到旧，最新的在最上面", () => {
    const ascending = [
      "## [18.12.3] - 2026-10-19",
      "- a",
      "## [18.12.4] - 2026-10-20",
      "- b",
      "## [18.12.5] - 2026-10-21",
      "- c",
    ];
    expect(splitChangelog(ascending.join("\n")).map((section) => section.version)).toEqual([
      "18.12.5",
      "18.12.4",
      "18.12.3",
    ]);
    expect(
      splitChangelog("## [18.9.0] - x\n## [Unreleased]\n## [18.12.0] - y").map((section) => section.version),
    ).toEqual(["Unreleased", "18.12.0", "18.9.0"]);
  });

  it("代码块里的 `## ` 不算标题", () => {
    const sections = splitChangelog("## [1.0.0] - 2026-01-01\n\n```md\n## [fake] - x\n```\n");
    expect(sections).toHaveLength(1);
  });

  it("没有节标题：整段当一节；空文本没有节", () => {
    expect(splitChangelog("just text")).toEqual([{ version: null, date: null, body: "just text" }]);
    expect(splitChangelog("  ")).toEqual([]);
  });
});
