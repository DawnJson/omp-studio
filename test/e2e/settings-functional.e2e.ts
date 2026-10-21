// 设置页的功能项（阶段 2.6）：模型与账号缓存、omp 版本检查、omp 设置分组（隐藏终端专用项）、用量。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR；用量用例还把 USERPROFILE 指到临时目录，omp 的 stats.db 不会碰真实 ~/.omp。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

async function localeAndTheme(page: Page, locale: "zh-CN" | "en", theme: "light" | "dark"): Promise<void> {
  await page.evaluate(
    async ({ locale: nextLocale, theme: nextTheme }) => {
      await globalThis.studio.setLocale(nextLocale);
      await globalThis.studio.setTheme(nextTheme);
    },
    { locale, theme },
  );
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function launchSettings(
  extraEnv: Record<string, string> = {},
): Promise<{ launched: LaunchedApp; agentDir: string }> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-"));
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir, ...extraEnv });
  await expect
    .poll(() => launched.page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
      timeout: 30_000,
    })
    .toBe("ready");
  await launched.page.setViewportSize({ width: 1200, height: 800 });
  await launched.page.keyboard.press("Control+,");
  await expect(launched.page.getByTestId("settings")).toBeVisible();
  return { launched, agentDir };
}

async function screenshots(page: Page, name: string, prepare?: () => Promise<void>): Promise<void> {
  for (const locale of ["zh-CN", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await localeAndTheme(page, locale, theme);
      await prepare?.();
      await page.screenshot({ path: path.join(screenshotsDir, `settings-f-${name}-${locale}-${theme}.png`) });
    }
  }
}

test("模型与账号：再次进入时立即显示上次的结果，不再出现“正在读取”", async () => {
  const { launched, agentDir } = await launchSettings();
  try {
    const { page } = launched;
    await localeAndTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-models").click();
    const rows = page.getByTestId("providers").locator(".st-provider-head");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const firstCount = await rows.count();
    expect(firstCount).toBeGreaterThan(0);

    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("settings-nav-models").click();
    // 点击后同一次渲染里就有内容：不等刷新、没有加载提示。
    await expect(page.getByText("正在读取模型…")).toHaveCount(0);
    expect(await rows.count()).toBe(firstCount);
    await page.screenshot({ path: path.join(screenshotsDir, "settings-f-models-cached-zh-CN-light.png") });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("omp 版本：用户自装/他人管理的 omp 也会检查，有新版本时提示（不下载、不改文件）", async () => {
  const body = Buffer.from("not downloaded");
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/")) {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          build: { version: "99.0.0" },
          file: { name: "omp.exe", size: body.length, sha256: createHash("sha256").update(body).digest("hex") },
          download: "/d/omp.exe",
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { launched, agentDir } = await launchSettings({ PI_BUILD_URL: baseUrl });
  try {
    const { page } = launched;
    await page.getByTestId("settings-nav-omp").click();
    // 启动后马上查了一次（不用等一小时）。
    await expect(page.getByTestId("omp-available")).toContainText("99.0.0", { timeout: 15_000 });
    // 手动检查：结果行里同样提示。
    await page.getByRole("button", { name: /检查更新|Check for updates/ }).click();
    await expect(page.getByTestId("omp-available")).toBeVisible();
    await screenshots(page, "omp-update");
    // 没有下载：版本没变。
    const status = await page.evaluate(() => globalThis.studio.getOmpStatus());
    expect(status).toMatchObject({ state: "ready" });
    expect(status.state === "ready" && status.version).not.toBe("99.0.0");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    server.close();
  }
});

test("omp 设置按 omp-studio 的分组显示：终端专用项被隐藏，搜索也找不到；起作用的项都在", async () => {
  const { launched, agentDir } = await launchSettings();
  try {
    const { page } = launched;
    await localeAndTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-cfg-tools").click();
    await expect(page.getByTestId("cfg-bash.enabled")).toBeVisible({ timeout: 30_000 });
    // 一列分节：omp 的"模型与推理"并进"模型与账号"，没有单独的一节。
    await expect(page.getByTestId("settings-nav-cfg-models")).toHaveCount(0);
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("cfg-modelRoles")).toBeVisible();
    for (const hidden of ["appearance", "interaction", "internal", "shell"])
      await expect(page.getByTestId(`settings-nav-cfg-${hidden}`)).toHaveCount(0);
    await page.getByTestId("settings-search").fill("theme.dark");
    await expect(page.getByText("没有匹配")).toBeVisible();
    await page.getByTestId("settings-search").fill("statusLine");
    await expect(page.getByText("没有匹配")).toBeVisible();
    await page.getByTestId("settings-search").fill("tools.approvalMode");
    await expect(page.getByTestId("cfg-tools.approvalMode")).toBeVisible();
    await page.getByTestId("settings-search").fill("");
    await page.getByTestId("settings-nav-cfg-tools").click();
    await expect(page.getByTestId("cfg-bash.enabled")).toBeVisible();
    await screenshots(page, "groups");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

/** 一个会话文件：一条 assistant 消息带用量，时间在 daysAgo 天前的中午（本地时间）。omp stats 会读它。 */
async function seedUsageSession(agentDir: string, index: number, daysAgo: number, tokens: number): Promise<void> {
  const at = new Date();
  at.setDate(at.getDate() - daysAgo);
  at.setHours(12, 0, 0, 0);
  const iso = at.toISOString();
  const dir = path.join(agentDir, "sessions", "--usage-seed--");
  await mkdir(dir, { recursive: true });
  const lines = [
    { type: "session", version: 3, id: `seed-${index}`, timestamp: iso, cwd: path.join(os.tmpdir(), "usage seed") },
    {
      type: "message",
      id: `u${index}`,
      parentId: null,
      timestamp: iso,
      message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: at.getTime() },
    },
    {
      type: "message",
      id: `a${index}`,
      parentId: `u${index}`,
      timestamp: iso,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        api: "openai-completions",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        usage: {
          input: tokens,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: tokens + 10,
          cost: { input: tokens / 1e6, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens / 1e6 },
        },
        stopReason: "stop",
        timestamp: at.getTime() + 1000,
        duration: 1000,
        ttft: 500,
      },
    },
  ];
  await writeFile(
    path.join(dir, `${iso.replaceAll(":", "-").replaceAll(".", "-")}_seed-${index}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    "utf8",
  );
}

test("用量：近一年热力图读 omp 的 stats.db（先同步再读，只读），额度没有账号时说明；中英文 × 浅深主题截图", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "omp-studio-home-"));
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-"));
  // 三天有用量，一天在一年多以前（不应出现在窗口里）。
  const seeded = [
    [0, 5000],
    [3, 120_000],
    [40, 800_000],
    [400, 1_000],
  ] as const;
  for (const [index, [daysAgo, tokens]] of seeded.entries()) await seedUsageSession(agentDir, index, daysAgo, tokens);
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir, USERPROFILE: home, HOME: home });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.keyboard.press("Control+,");
    await page.getByTestId("settings-nav-usage").click();
    await expect(page.getByTestId("usage-quota-empty")).toBeVisible({ timeout: 60_000 });
    // 同步（omp 首次要解出原生库，给足时间）后有 3 个有用量的日子。
    await expect(page.getByTestId("usage-heatmap")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("usage-syncing")).toHaveCount(0, { timeout: 180_000 });
    await expect(page.locator(".usage-grid .usage-cell:not([data-level='0'])")).toHaveCount(3);
    // 换指标：请求数每天都是 1，三个格子同样深。
    await page
      .getByTestId("usage-metric")
      .getByRole("radio", { name: /请求数|Requests/ })
      .click();
    await expect(page.locator(".usage-grid .usage-cell[data-level='4']")).toHaveCount(3);
    await page.getByTestId("usage-metric").getByRole("radio", { name: /Token/ }).click();
    await screenshots(page, "usage");
    // 读库是只读的：不存在我们写的东西，窗口之外的一天没出现。
    const heatmap = await page.evaluate(() => globalThis.studio.getUsageHeatmap(false));
    expect(heatmap.days).toHaveLength(3);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

// MCP / SSH 卡片（S5）：真实 omp（PATH 上的）+ 临时 agent 目录，只用 omp 的内置命令和 CLI，不调模型。
// omp 18.12.5 实测：`/mcp add` 的切词认双引号（所以含空格的参数能存对），`/mcp remove|enable|disable|test` 按空白切词（所以名字里不能有空格）。
async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type Entries = Record<string, Record<string, unknown>>;
const mcpServers = async (agentDir: string): Promise<Entries> =>
  ((await readJson(path.join(agentDir, "mcp.json")))?.["mcpServers"] ?? {}) as Entries;
const sshHosts = async (agentDir: string): Promise<Entries> =>
  ((await readJson(path.join(agentDir, "ssh.json")))?.["hosts"] ?? {}) as Entries;

test("集成：MCP 服务器和 SSH 主机的添加、开关、删除走真实 omp 并写进临时 agent 目录；工具、记忆卡片和更新日志能读到 omp 的输出", async () => {
  // omp 会从用户目录里的别家工具配置（~/.claude.json、~/.cursor/mcp.json 等）发现 MCP 服务器：把用户目录指到空目录，列表才可预期。
  const home = await mkdtemp(path.join(os.tmpdir(), "omp-studio-home-"));
  const { launched, agentDir } = await launchSettings({ USERPROFILE: home, HOME: home });
  try {
    const { page } = launched;
    await localeAndTheme(page, "en", "light");
    await page.getByTestId("settings-nav-cfg-integrations").click({ timeout: 60_000 });

    // ── MCP：本地命令（参数里有空格和单引号，靠 omp 的双引号切词存对）──
    await expect(page.getByTestId("mcp-empty")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("mcp-add").click();
    // 名字里有空格：omp 的 remove/enable/disable 管不了，保存按钮不可用。
    await page.getByTestId("mcp-name").fill("b c");
    await page.getByTestId("mcp-command").fill("node");
    await expect(page.getByTestId("mcp-save")).toBeDisabled();
    await page.getByTestId("mcp-name").fill("demo");
    await page.getByTestId("mcp-args").fill("-e\nconsole.log('x y')\na b");
    await page.getByTestId("mcp-save").click();
    await expect(page.getByTestId("mcp-row-demo")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await mcpServers(agentDir))["demo"])
      .toMatchObject({
        type: "stdio",
        command: "node",
        args: ["-e", "console.log('x y')", "a b"],
      });

    // 同名再加一次：omp 的原话显示在表单里，表单不关。
    await page.getByTestId("mcp-add").click();
    await page.getByTestId("mcp-name").fill("demo");
    await page.getByTestId("mcp-command").fill("node");
    await page.getByTestId("mcp-save").click();
    await expect(page.getByTestId("mcp-form-error")).toContainText("already exists");
    await page.getByTestId("mcp-cancel").click();

    // HTTP 服务器 + 令牌：omp 写成 Authorization 请求头。
    await page.getByTestId("mcp-add").click();
    await page.getByTestId("mcp-name").fill("remote1");
    await page.getByTestId("mcp-kind").getByRole("radio", { name: "HTTP" }).click();
    await page.getByTestId("mcp-url").fill("http://127.0.0.1:9/mcp");
    await page.getByTestId("mcp-token").fill("tok123");
    await page.getByTestId("mcp-save").click();
    await expect(page.getByTestId("mcp-row-remote1")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await mcpServers(agentDir))["remote1"])
      .toMatchObject({
        type: "http",
        url: "http://127.0.0.1:9/mcp",
        headers: { Authorization: "Bearer tok123" },
      });

    // 开关：关掉后配置里 enabled:false，列表同步。
    await page.getByTestId("mcp-enabled-remote1").click();
    await expect.poll(async () => (await mcpServers(agentDir))["remote1"]?.["enabled"]).toBe(false);
    await expect(page.getByTestId("mcp-enabled-remote1")).toHaveAttribute("aria-checked", "false");

    // 测试连接：连不上时显示 omp 的原话。
    await page.getByTestId("mcp-test-remote1").click();
    await expect(page.getByTestId("mcp-test-result-remote1")).toBeVisible({ timeout: 60_000 });

    // 删除先确认。
    await page.getByTestId("mcp-remove-demo").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("mcp-row-demo")).toHaveCount(0);
    await expect.poll(async () => Object.keys(await mcpServers(agentDir))).toEqual(["remote1"]);
    await page.getByTestId("mcp-remove-remote1").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("mcp-empty")).toBeVisible();
    await expect.poll(async () => Object.keys(await mcpServers(agentDir))).toEqual([]);

    // ── SSH ──
    await expect(page.getByTestId("ssh-empty")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("ssh-add").click();
    await page.getByTestId("ssh-name").fill("box");
    await page.getByTestId("ssh-host").fill("127.0.0.1");
    await page.getByTestId("ssh-user").fill("me");
    await page.getByTestId("ssh-port").fill("2222");
    await page.getByTestId("ssh-desc").fill('- my box, with "quotes"');
    await page.getByTestId("ssh-save").click();
    await expect(page.getByTestId("ssh-row-box")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await sshHosts(agentDir))["box"])
      .toMatchObject({
        host: "127.0.0.1",
        username: "me",
        port: 2222,
        description: '- my box, with "quotes"',
      });

    // 同名再加：omp 的原话（错误在 stdout，退出码 1）。
    await page.getByTestId("ssh-add").click();
    await page.getByTestId("ssh-name").fill("box");
    await page.getByTestId("ssh-host").fill("10.0.0.1");
    await page.getByTestId("ssh-save").click();
    await expect(page.getByTestId("ssh-form-error")).toContainText("already exists");
    await page.getByTestId("ssh-cancel").click();

    await page.getByTestId("ssh-remove-box").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("ssh-row-box")).toHaveCount(0);
    await expect.poll(async () => Object.keys(await sshHosts(agentDir))).toEqual([]);
    await page.screenshot({ path: path.join(screenshotsDir, "settings-f-integrations-en-light.png") });

    // ── 可用工具：omp 的 /tools，read 一定在 ──
    await page.getByTestId("settings-nav-cfg-tools").click();
    await expect(page.getByTestId("tool-read")).toBeVisible({ timeout: 60_000 });

    // ── 记忆：卡片在，后端值来自设置项 ──
    await page.getByTestId("settings-nav-cfg-context").click();
    await expect(page.getByTestId("memory-card")).toBeVisible();
    await expect(page.getByTestId("memory-backend")).toHaveText("off");

    // ── omp 更新日志：点开才读，最新一节默认展开 ──
    await page.getByTestId("settings-nav-omp").click();
    await page.getByTestId("changelog-show").click();
    await expect(page.getByTestId("changelog-section-0")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("changelog-section-0").locator(".md")).toBeVisible();
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

// 插件页（S6）：真实 omp + 临时 agent 目录；用户目录指到空目录，omp 的插件目录和市场注册表（<HOME>/.omp/plugins、marketplaces.json）就落在临时目录里，
// 不碰真实 ~/.omp。市场是一个本地目录（只有一个相对路径的小插件），不联网、不调模型。
test("插件：添加本地市场、浏览并安装（先确认第三方代码）、停用、卸载、移除市场，走真实 omp", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "omp-studio-home-"));
  const market = await mkdtemp(path.join(os.tmpdir(), "omp-studio-market-"));
  await mkdir(path.join(market, ".omp-plugin"), { recursive: true });
  await mkdir(path.join(market, "p1"), { recursive: true });
  await writeFile(
    path.join(market, ".omp-plugin", "marketplace.json"),
    JSON.stringify({
      name: "local-mk",
      owner: { name: "Test" },
      plugins: [{ name: "p1", source: "./p1", description: "First local plugin", version: "1.0.0" }],
    }),
  );
  await writeFile(path.join(market, "p1", "package.json"), JSON.stringify({ name: "p1", version: "1.0.0" }));
  const { launched, agentDir } = await launchSettings({ USERPROFILE: home, HOME: home });
  try {
    const { page } = launched;
    await localeAndTheme(page, "en", "light");
    await page.getByTestId("settings-nav-plugins").click();
    await expect(page.getByTestId("plugins-empty")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("marketplace-add")).toBeDisabled();

    // 添加市场（本地目录）。
    await page.getByTestId("marketplace-add-input").fill(market);
    await page.getByTestId("marketplace-add").click();
    await expect(page.getByTestId("marketplace-local-mk")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("marketplace-add-input")).toHaveValue("");
    // 添加市场不影响运行中的任务，不出现重新加载提示。
    await expect(page.getByTestId("plugins-reload")).toHaveCount(0);

    // 浏览并安装：先弹确认，取消不装。
    await page.getByTestId("marketplace-browse-btn-local-mk").click();
    await expect(page.getByTestId("discover-p1@local-mk")).toContainText("First local plugin", { timeout: 60_000 });
    await page.getByTestId("discover-install-p1@local-mk").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("third-party code");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("plugin-row-p1@local-mk")).toHaveCount(0);
    expect((await page.evaluate(() => globalThis.studio.listPlugins(null))).marketplace).toHaveLength(0);

    await page.getByTestId("discover-install-p1@local-mk").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Install and trust" }).click();
    await expect(page.getByTestId("plugin-row-p1@local-mk")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("plugins-reload")).toBeVisible();
    await expect(page.getByTestId("discover-p1@local-mk")).toContainText("Installed");
    await expect(page.getByTestId("plugin-enabled-p1@local-mk")).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () =>
        (await readFile(path.join(home, ".omp", "plugins", "installed_plugins.json"), "utf8")).includes("p1@local-mk"),
      )
      .toBe(true);

    // 停用：omp 里 enabled:false，开关同步。
    await page.getByTestId("plugin-enabled-p1@local-mk").click();
    await expect(page.getByTestId("plugin-enabled-p1@local-mk")).toHaveAttribute("aria-checked", "false", {
      timeout: 60_000,
    });
    const listed = await page.evaluate(() => globalThis.studio.listPlugins(null));
    expect(listed.marketplace[0]?.installs[0]?.enabled).toBe(false);
    await page.screenshot({ path: path.join(screenshotsDir, "settings-f-plugins-en-light.png") });

    // 卸载先确认。
    await page.getByTestId("plugin-uninstall-p1@local-mk").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Uninstall" }).click();
    await expect(page.getByTestId("plugin-row-p1@local-mk")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("plugins-empty")).toBeVisible();

    // 移除市场。
    await page.getByTestId("marketplace-remove-local-mk").click();
    await expect(page.getByTestId("marketplace-local-mk")).toHaveCount(0, { timeout: 60_000 });

    // 中文界面同一页。
    await localeAndTheme(page, "zh-CN", "dark");
    await expect(page.getByTestId("plugins-installed")).toContainText("已安装");
    await page.screenshot({ path: path.join(screenshotsDir, "settings-f-plugins-zh-CN-dark.png") });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(market, { recursive: true, force: true });
  }
});
