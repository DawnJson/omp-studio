// 设置页的功能项（阶段 2.6）：模型与账号缓存、omp 版本检查、omp 设置分组（隐藏终端专用项）、用量。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR；用量用例还把 USERPROFILE 指到临时目录，omp 的 stats.db 不会碰真实 ~/.omp。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
