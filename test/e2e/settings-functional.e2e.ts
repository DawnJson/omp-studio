// 设置页的功能项（阶段 2.6）：提供商与账号缓存、omp 版本检查、omp 设置分节（常用项 / 高级，隐藏终端专用项）、用量对话框。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR；用量用例还把 USERPROFILE 指到临时目录，omp 的 stats.db 不会碰真实 ~/.omp。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoOverflow, launchApp, setLocaleTheme, type LaunchedApp } from "./launch.ts";

async function launchSettings(
  extraEnv: Record<string, string> = {},
  seedAgentDir?: (agentDir: string) => Promise<void>,
): Promise<{ launched: LaunchedApp; agentDir: string }> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-"));
  // omp 启动时才发现 skill：要放进 agent 目录的文件在应用启动前写好。
  await seedAgentDir?.(agentDir);
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir, ...extraEnv });
  try {
    await expect
      .poll(() => launched.page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await launched.page.setViewportSize({ width: 1200, height: 800 });
    // omp 可能比界面先就绪：等 React 挂上（快捷键监听才在），再按 Ctrl ,。
    await expect(launched.page.getByTestId("app-root")).toBeVisible();
    await launched.page.keyboard.press("Control+,");
    await expect(launched.page.getByTestId("settings")).toBeVisible();
  } catch (error) {
    // 中途失败调用方拿不到 launched：在这里关掉应用、删掉目录，不留进程和临时目录。
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
  return { launched, agentDir };
}

test("提供商与账号：再次进入时立即显示上次的结果，不再出现“正在读取”", async () => {
  const { launched, agentDir } = await launchSettings();
  try {
    const { page } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-providers").click();
    // 左下角的版本号在导航里水平居中（文字的中线对齐导航的中线）。
    const versionOffset = await page.getByTestId("settings-nav-version").evaluate((element) => {
      type R = { left: number; right: number };
      const doc = (
        globalThis as unknown as {
          document: { createRange(): { selectNodeContents(n: unknown): void; getBoundingClientRect(): R } };
        }
      ).document;
      const range = doc.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = (element as unknown as { getBoundingClientRect(): R }).getBoundingClientRect();
      return Math.abs((text.left + text.right) / 2 - (box.left + box.right) / 2);
    });
    expect(versionOffset).toBeLessThan(2);
    // 没连接的提供商不铺开，也没有"其他提供商"小节：入口只有页头的"连接提供商…"。
    const connect = page.getByTestId("providers-connect");
    await expect(connect).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId("providers-others")).toHaveCount(0);
    await expect(page.getByText("其他 provider")).toHaveCount(0);

    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("settings-nav-providers").click();
    // 点击后同一次渲染里就有内容：不等刷新、没有加载提示。
    await expect(page.getByText("正在读取模型…")).toHaveCount(0);
    await expect(connect).toBeEnabled();
    // "连接提供商…"打开可搜索的对话框，能搜到并走到填 key 入口。对话框里只有没连接的提供商；
    // 哪些已连接取决于本机环境变量（如 DEEPSEEK_API_KEY），所以取列表里第一个能填 key 的，不写死名字。
    await connect.click();
    const pick = page.getByTestId("provider-pick");
    const firstKey = pick.locator('[data-testid^="provider-key-"]').first();
    const id = ((await firstKey.getAttribute("data-testid")) ?? "").slice("provider-key-".length);
    expect(id).not.toBe("");
    await page.getByTestId("provider-search").fill(id);
    await expect(pick.getByTestId(`provider-${id}`)).toBeVisible();
    await pick.getByTestId(`provider-key-${id}`).click();
    const flow = page.getByTestId(`provider-flow-${id}`);
    await expect(flow).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(flow).toHaveCount(0);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("填 API key：存进 omp 的凭据库（终端版也用），卡片写“已设置 key”；清除 key 删掉它。只有环境变量的写“已配置”", async () => {
  const { launched, agentDir } = await launchSettings({ TAVILY_API_KEY: "tvly-e2e-env" });
  const storedKeys = () => {
    const out = execFileSync("omp", ["auth", "export"], {
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      encoding: "utf8",
    });
    const { credentials } = JSON.parse(out) as { credentials: { provider: string; credential: { key?: string } }[] };
    return credentials.filter((entry) => entry.provider === "kagi").map((entry) => entry.credential.key);
  };
  try {
    const { page } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-providers").click();
    await expect(page.getByTestId("providers-connect")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("providers-connect").click();
    await page.getByTestId("provider-search").fill("kagi");
    await page.getByTestId("provider-pick").getByTestId("provider-key-kagi").click();
    const flow = page.getByTestId("provider-flow-kagi");
    await flow.getByRole("textbox").fill("  kagi-e2e-key  ");
    await page.getByTestId("provider-key-save").click();
    await expect(flow).toHaveCount(0);

    // 回到"已连接"：徽标按凭据来源写，元信息是 omp 给这条凭据起的名字，按钮变成"更换 key"、"清除 key"。
    const card = page.getByTestId("providers").getByTestId("provider-kagi");
    await expect(card).toContainText("已设置 key", { timeout: 30_000 });
    await expect(card).not.toContainText("已登录");
    await expect(card).toContainText("API key #");
    await expect(card.getByTestId("provider-key-kagi")).toHaveText("更换 key");
    await expect(card.getByTestId("provider-signout-kagi")).toHaveText("清除 key");
    // 已经存过 key：更换时输入框写明留空保持不变。
    await card.getByTestId("provider-key-kagi").click();
    await expect(page.getByTestId("provider-flow-kagi").getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "已存进 omp 的凭据库，留空保持不变",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-flow-kagi")).toHaveCount(0);
    expect(storedKeys()).toEqual(["kagi-e2e-key"]);

    // 只有环境变量里的 key（omp 认可、凭据库里没有账号）：不是登录，写"已配置"，没有退出按钮；元信息写出是哪个变量。
    const envCard = page.getByTestId("providers").getByTestId("provider-tavily");
    await expect(envCard).toContainText("已配置");
    await expect(envCard).toContainText("环境变量 · TAVILY_API_KEY");
    await expect(envCard.getByTestId("provider-signout-tavily")).toHaveCount(0);
    expect(storedKeys()).toEqual(["kagi-e2e-key"]);
    // key 在系统环境变量里：设置 API key 的对话框说清楚这里存的不生效。
    await envCard.getByTestId("provider-key-tavily").click();
    await expect(page.getByTestId("provider-key-note")).toHaveText(
      "系统环境变量 TAVILY_API_KEY 里已有 key，omp 优先用它，这里存的不生效",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-flow-tavily")).toHaveCount(0);

    await card.getByTestId("provider-signout-kagi").click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    expect(storedKeys()).toEqual([]);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("设置 API key：key 的变量写在 agent 目录 .env 里时改那一行（omp 优先用 .env），不存凭据库", async () => {
  // 跑测试的 shell 可能真有 TAVILY_API_KEY：传空值，omp 和 studio 都当没设置。
  const { launched, agentDir } = await launchSettings({ TAVILY_API_KEY: "" }, (dir) =>
    writeFile(path.join(dir, ".env"), "# 搜索\nTAVILY_API_KEY=tvly-old\nOTHER=1\n", "utf8"),
  );
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, TAVILY_API_KEY: "" };
  try {
    const { page } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-providers").click();
    const card = page.getByTestId("providers").getByTestId("provider-tavily");
    await expect(card).toContainText("环境变量 · TAVILY_API_KEY", { timeout: 30_000 });
    await card.getByTestId("provider-key-tavily").click();
    const flow = page.getByTestId("provider-flow-tavily");
    await expect(flow.getByTestId("provider-key-note")).toHaveText(
      "替换 agent 目录 .env 里的 TAVILY_API_KEY，omp 优先用它",
    );
    // 900 宽窗口、中英文下说明都不越界。
    await page.setViewportSize({ width: 900, height: 800 });
    await expectNoOverflow(flow);
    await setLocaleTheme(page, "en", "dark");
    await expect(flow.getByTestId("provider-key-note")).toHaveText(
      "Replaces TAVILY_API_KEY in the agent folder's .env, which omp uses first",
    );
    await expectNoOverflow(flow);
    await flow.getByRole("textbox").fill("  tvly-new  ");
    await page.getByTestId("provider-key-save").click();
    await expect(flow).toHaveCount(0);

    expect(await readFile(path.join(agentDir, ".env"), "utf8")).toBe("# 搜索\nTAVILY_API_KEY=tvly-new\nOTHER=1\n");
    expect(await readFile(path.join(agentDir, ".env.bak"), "utf8")).toContain("tvly-old");
    expect(execFileSync("omp", ["token", "tavily"], { env, encoding: "utf8" }).trim()).toBe("tvly-new");
    const exported = JSON.parse(execFileSync("omp", ["auth", "export"], { env, encoding: "utf8" })) as {
      credentials: { provider: string }[];
    };
    expect(exported.credentials.filter((entry) => entry.provider === "tavily")).toEqual([]);
    await expect(card).toContainText("Env var · TAVILY_API_KEY");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("Hugging Face 的 key 写在 .env 的 HF_TOKEN（omp 的 fallback 变量）：卡片写出它，对话框一打开就是 .env 的说明，保存改 HF_TOKEN 那一行", async () => {
  // 跑测试的 shell 可能真有这两个变量：传空值，omp 和 studio 都当没设置。
  const unset = { HUGGINGFACE_HUB_TOKEN: "", HF_TOKEN: "" };
  const { launched, agentDir } = await launchSettings(unset, (dir) =>
    writeFile(path.join(dir, ".env"), "HF_TOKEN=hf-old\n", "utf8"),
  );
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...unset };
  try {
    const { page } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-providers").click();
    const card = page.getByTestId("providers").getByTestId("provider-huggingface");
    await expect(card).toContainText("环境变量 · HF_TOKEN", { timeout: 30_000 });
    // 记下说明出现过的每一种文字：打开时不能先显示"存进凭据库"再跳成 .env 的说明。
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        __notes: string[];
        document: { body: unknown; querySelector(selector: string): { textContent: string | null } | null };
        MutationObserver: new (cb: () => void) => { observe(target: unknown, options: unknown): void };
      };
      g.__notes = [];
      new g.MutationObserver(() => {
        const text = g.document.querySelector('[data-testid="provider-key-note"]')?.textContent;
        if (text != null && g.__notes.at(-1) !== text) g.__notes.push(text);
      }).observe(g.document.body, { childList: true, subtree: true, characterData: true });
    });
    await card.getByTestId("provider-key-huggingface").click();
    const flow = page.getByTestId("provider-flow-huggingface");
    await expect(flow.getByTestId("provider-key-note")).toHaveText("替换 agent 目录 .env 里的 HF_TOKEN，omp 优先用它");
    await expect(flow.getByRole("textbox")).toHaveAttribute("placeholder", "已写在 .env 里，留空保持不变");
    // 说明已经是最终的文字：之前出现过的都在记录里（闪一下的话是"先默认、后 .env"两条）。
    expect(await page.evaluate(() => (globalThis as unknown as { __notes: string[] }).__notes)).toEqual([
      "替换 agent 目录 .env 里的 HF_TOKEN，omp 优先用它",
    ]);
    await flow.getByRole("textbox").fill("hf-new");
    await page.getByTestId("provider-key-save").click();
    await expect(flow).toHaveCount(0);

    expect(await readFile(path.join(agentDir, ".env"), "utf8")).toBe("HF_TOKEN=hf-new\n");
    expect(execFileSync("omp", ["token", "huggingface"], { env, encoding: "utf8" }).trim()).toBe("hf-new");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("关于 → omp：用户自装/他人管理的 omp 也会检查，有新版本时提示（不下载、不改文件）", async () => {
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
    await page.getByTestId("settings-nav-about").click();
    // 启动后马上查了一次（不用等一小时）。
    await expect(page.getByTestId("omp-available")).toContainText("99.0.0", { timeout: 15_000 });
    // 手动检查（omp 那张卡上的按钮；上面那张是 omp-studio 自己的）：结果行里同样提示。
    await page
      .getByTestId("omp-info")
      .getByRole("button", { name: /检查更新|Check for updates/ })
      .click();
    await expect(page.getByTestId("omp-available")).toBeVisible();
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

test("omp 设置：各节只放常用项，其余在“高级”；终端专用项被隐藏，搜索也找不到", async () => {
  const { launched, agentDir } = await launchSettings();
  try {
    const { page } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-tools").click();
    await expect(page.getByTestId("cfg-bash.enabled")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("settings-nav-models").click();
    // 模型角色直接展开成每个角色一格下拉，不再是 modelRoles 一行"编辑…"。
    await expect(page.getByTestId("setting-role-smol")).toBeVisible();
    await expect(page.getByTestId("cfg-modelRoles")).toHaveCount(0);
    // 插话 / 稍后消息的处理方式和 Enter 的行为在"通用"同一张卡里。
    await page.getByTestId("settings-nav-general").click();
    await expect(page.getByTestId("cfg-steeringMode")).toBeVisible();
    // 高级：页内目录 + 选中分组的行平铺（没有折叠），常用项不重复出现。
    await page.getByTestId("settings-nav-advanced").click();
    await expect(page.getByTestId("advanced-toc")).toBeVisible();
    await page.getByTestId("advanced-toc-tools").click();
    await expect(page.getByTestId("cfg-advanced-tools")).toBeVisible();
    await expect(page.getByTestId("cfg-tools.approvalMode")).toHaveCount(0);
    await page.getByTestId("settings-search").fill("theme.dark");
    await expect(page.getByText("没有匹配")).toBeVisible();
    await page.getByTestId("settings-search").fill("statusLine");
    await expect(page.getByText("没有匹配")).toBeVisible();
    await page.getByTestId("settings-search").fill("tools.approvalMode");
    await expect(page.getByTestId("cfg-tools.approvalMode")).toBeVisible();
    await page.getByTestId("settings-search").fill("");
    await page.getByTestId("settings-nav-tools").click();
    await expect(page.getByTestId("cfg-bash.enabled")).toBeVisible();
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

test("用量对话框：近一年热力图读 omp 的 stats.db（先同步再读，只读），额度没有账号时说明", async () => {
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
    // 设置页里没有"用量"了：从发送键左边的费用打开对话框。
    await expect(page.getByTestId("app-root")).toBeVisible();
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("settings")).toBeVisible();
    await expect(page.getByTestId("settings-nav-usage")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("usage-cost").click();
    const dialog = page.getByTestId("usage-dialog");
    await expect(dialog.getByTestId("usage-quota-empty")).toBeVisible({ timeout: 60_000 });
    // 同步（omp 首次要解出原生库，给足时间）后有 3 个有用量的日子，按花费着色：最贵的那天最深。
    await expect(dialog.locator(".usage-grid")).toBeVisible({ timeout: 180_000 });
    await expect(dialog.getByTestId("usage-syncing")).toHaveCount(0, { timeout: 180_000 });
    await expect(dialog.locator(".usage-grid .usage-cell:not([data-level='0'])")).toHaveCount(3);
    await expect(dialog.locator(".usage-grid .usage-cell[data-level='4']")).toHaveCount(1);
    await expect(dialog.getByTestId("usage-summary")).toBeVisible();
    // ↻ 刷新：先让 omp 清掉额度缓存（omp usage invalidate）再重读；按钮在读完前禁用，读完恢复，额度仍是"没有账号"。
    const refresh = dialog.getByTestId("usage-refresh");
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 180_000 });
    await expect(dialog.getByTestId("usage-quota-empty")).toBeVisible();
    // 更新时间在标题行（↻ 左边），不在额度区里。
    await expect(dialog.locator(".ui-dialog-head").getByTestId("usage-checked")).toHaveText("刚刚更新");
    await expect(dialog.getByTestId("quota-section").getByTestId("usage-checked")).toHaveCount(0);
    // 读库是只读的：不存在我们写的东西，窗口之外的一天没出现。
    const heatmap = await page.evaluate(() => globalThis.studio.getUsageHeatmap(false));
    expect(heatmap.days).toHaveLength(3);
  } finally {
    await launched.close();
    // omp 的原生库（home 里的 .omp/natives）在进程退出后还要一会儿才放开：EPERM/EBUSY 时重试。
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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
    await setLocaleTheme(page, "en", "light");
    await expect(page.getByTestId("settings-nav-integrations")).toHaveCount(0);
    await expect(page.getByTestId("settings-nav-plugins")).toHaveCount(0);
    await page.getByTestId("settings-nav-extensions").click({ timeout: 60_000 });
    // 集成与插件是一页：MCP、SSH、插件、市场都在这一页里。
    await expect(page.getByTestId("mcp-empty")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("ssh-add")).toBeVisible();
    await expect(page.getByTestId("plugins-installed")).toBeVisible();
    await expect(page.getByTestId("marketplace-add-open")).toBeVisible();

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

    // 测试连接：连不上时卡片右上角一个"连接失败"徽标，omp 的原话在悬停里，元信息下面不再写。
    await page.getByTestId("mcp-test-remote1").click();
    const mcpFailed = page.getByTestId("mcp-row-remote1").getByTestId("mcp-test-failed-remote1");
    await expect(mcpFailed).toHaveText("Connection failed", { timeout: 60_000 });
    await expect(mcpFailed).not.toHaveAttribute("title", "");
    await expect(page.getByTestId("mcp-test-result-remote1")).toHaveCount(0);
    await expectNoOverflow(page.getByTestId("mcp-card"));

    // 编辑：直接改 omp 的 mcp.json 里这一项，别的字段原样。先在文件里补上表单不管的字段（timeout、oauth、别的 header、env），再改。
    const mcpFile = path.join(agentDir, "mcp.json");
    const seeded = JSON.parse(await readFile(mcpFile, "utf8")) as { mcpServers: Entries };
    const seededRemote = seeded.mcpServers["remote1"];
    const seededDemo = seeded.mcpServers["demo"];
    if (seededRemote === undefined || seededDemo === undefined) throw new Error("mcp.json 里少了 remote1 / demo");
    seededRemote["timeout"] = 5000;
    seededRemote["oauth"] = { clientId: "abc" };
    seededRemote["headers"] = { "X-Trace": "on", ...(seededRemote["headers"] as Record<string, string>) };
    seededDemo["env"] = { A: "1" };
    await writeFile(mcpFile, JSON.stringify(seeded, null, 2), "utf8");
    const keysBefore = Object.keys(seededRemote);
    await page.getByTestId("mcp-more-remote1").click();
    await page.getByTestId("mcp-edit-remote1").click();
    await expect(page.getByTestId("mcp-form")).toContainText("Edit remote1");
    await expect(page.getByTestId("mcp-name")).toBeDisabled();
    await expect(page.getByTestId("mcp-url")).toHaveValue("http://127.0.0.1:9/mcp");
    // token 的现有值不回传：默认"保持不变"，没有输入框；选"改成…"才出现。
    await expect(page.getByTestId("mcp-token-mode-keep")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("mcp-token")).toHaveCount(0);
    await expect(page.getByTestId("mcp-form")).not.toContainText("tok123");
    await page.getByTestId("mcp-url").fill("http://127.0.0.1:9/changed");
    await page.getByTestId("mcp-save").click();
    await expect(page.getByTestId("mcp-form")).toHaveCount(0);
    await expect
      .poll(async () => (await mcpServers(agentDir))["remote1"])
      .toEqual({
        type: "http",
        url: "http://127.0.0.1:9/changed",
        headers: { "X-Trace": "on", Authorization: "Bearer tok123" },
        enabled: false,
        timeout: 5000,
        oauth: { clientId: "abc" },
      });
    expect(Object.keys((await mcpServers(agentDir))["remote1"] ?? {})).toEqual(keysBefore);
    expect(await readFile(`${mcpFile}.bak`, "utf8")).toContain("127.0.0.1:9/mcp");
    await expect(page.getByTestId("mcp-row-remote1")).toContainText("http://127.0.0.1:9/changed");
    // 换 token、本地命令的参数。
    await page.getByTestId("mcp-more-remote1").click();
    await page.getByTestId("mcp-edit-remote1").click();
    await page.getByTestId("mcp-token-mode-literal").click();
    await expect(page.getByTestId("mcp-save")).toBeDisabled();
    await page.getByTestId("mcp-token").fill("tok456");
    await page.getByTestId("mcp-save").click();
    await expect(page.getByTestId("mcp-form")).toHaveCount(0);
    await expect
      .poll(async () => (await mcpServers(agentDir))["remote1"]?.["headers"])
      .toEqual({ "X-Trace": "on", Authorization: "Bearer tok456" });
    await page.getByTestId("mcp-more-demo").click();
    await page.getByTestId("mcp-edit-demo").click();
    await expect(page.getByTestId("mcp-command")).toHaveValue("node");
    await expect(page.getByTestId("mcp-kind")).toHaveCount(0);
    await page.getByTestId("mcp-args").fill("-v\nserver.js");
    await page.getByTestId("mcp-save").click();
    await expect(page.getByTestId("mcp-form")).toHaveCount(0);
    await expect
      .poll(async () => (await mcpServers(agentDir))["demo"])
      .toEqual({ type: "stdio", command: "node", args: ["-v", "server.js"], env: { A: "1" } });
    // 窗口 900 宽、长内容：编辑表单和卡片里没有东西越界（中英文各一次）。
    await page.setViewportSize({ width: 900, height: 700 });
    await page.getByTestId("mcp-more-remote1").click();
    await page.getByTestId("mcp-edit-remote1").click();
    await page.getByTestId("mcp-url").fill(`http://127.0.0.1:9/${"long-path-".repeat(30)}`);
    await page.getByTestId("mcp-token-mode-literal").click();
    await page.getByTestId("mcp-token").fill("t".repeat(200));
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(page.getByTestId("mcp-form").locator(".ui-dialog-body"));
    }
    await page.getByTestId("mcp-cancel").click();
    await expect(page.getByTestId("mcp-form")).toHaveCount(0);
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(page.getByTestId("mcp-card"));
    }
    await page.setViewportSize({ width: 1200, height: 800 });

    // 删除先确认。
    await page.getByTestId("mcp-more-demo").click();
    await page.getByTestId("mcp-remove-demo").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("mcp-row-demo")).toHaveCount(0);
    await expect.poll(async () => Object.keys(await mcpServers(agentDir))).toEqual(["remote1"]);
    await page.getByTestId("mcp-more-remote1").click();
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
    // 窗口 900 宽、长内容：对话框正文里没有东西越界（并排的“用户名 / 端口”列不被撑出边框；中英文各一次）。
    await page.setViewportSize({ width: 900, height: 700 });
    await page.getByTestId("ssh-host").fill("h".repeat(200));
    await page.getByTestId("ssh-key").fill("C:/Users/x/.ssh/" + "folder-".repeat(30));
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(page.getByTestId("ssh-form").locator(".ui-dialog-body"));
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.getByTestId("ssh-name").fill("box");
    await page.getByTestId("ssh-host").fill("10.0.0.1");
    await page.getByTestId("ssh-save").click();
    await expect(page.getByTestId("ssh-form-error")).toContainText("already exists");
    await page.getByTestId("ssh-cancel").click();

    await page.getByTestId("ssh-remove-box").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("ssh-row-box")).toHaveCount(0);
    await expect.poll(async () => Object.keys(await sshHosts(agentDir))).toEqual([]);

    // ── 可用工具：omp 的 /tools，read 一定在 ──
    await page.getByTestId("settings-nav-tools").click();
    await expect(page.getByTestId("tool-read")).toBeVisible({ timeout: 60_000 });
    // 没有开关的行不显得像坏了：徽标的 tooltip 写明原因。init_experiment 由 omp 的模式启用、xd 设备是同一个工具的入口。
    await expect(page.getByTestId("tool-switch-init_experiment")).toHaveCount(0);
    await expect(page.getByTestId("tool-badge-init_experiment")).toHaveAttribute("title", /mode|模式/);
    await expect(page.getByTestId("tool-badge-xd://lsp")).toHaveAttribute("title", /entry|入口/);
    await expect(page.getByTestId("tool-switch-lsp")).toBeVisible();

    // ── 记忆：卡片在，后端是同一页上面的常用设置项 ──
    await page.getByTestId("settings-nav-context").click();
    await expect(page.getByTestId("memory-card")).toBeVisible();
    await expect(page.getByTestId("cfg-memory.backend")).toBeVisible();

    // ── 更新日志（在"关于"里）：omp-studio 和 omp 各一项，只有最新一版，默认收起；omp 的点开才读 ──
    await page.getByTestId("settings-nav-about").click();
    const info = await page.evaluate(() => globalThis.studio.getAppInfo());
    const studioEntry = page.getByTestId("changelog-studio");
    await expect(studioEntry.getByTestId("changelog-studio-toggle")).toContainText(info.version);
    await expect(studioEntry.getByTestId("changelog-studio-toggle")).toHaveAttribute("aria-expanded", "false");
    await studioEntry.getByTestId("changelog-studio-toggle").click();
    await expect(studioEntry.locator(".md")).toBeVisible();
    const ompEntry = page.getByTestId("changelog-omp");
    await expect(ompEntry.locator(".md")).toHaveCount(0);
    await ompEntry.getByTestId("changelog-omp-toggle").click();
    await expect(ompEntry.locator(".md")).toBeVisible({ timeout: 60_000 });
    // 两项各一段正文，不再按版本列出一串。
    await expect(page.locator('[data-testid="changelog"] .md')).toHaveCount(2);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

// Skills 卡片：数据来自 `omp skill list --json`。临时 agent 目录里放一个测试 skill，用户目录指到空目录（别家工具的 skill 不混进来）。
test("集成与插件：Skills 分组列出 omp 能用的 skill（名称、范围、说明），中英文 900/1200 宽不越界", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "omp-studio-home-"));
  const description = `E2E probe skill. ${"A long description that must be clamped inside the card. ".repeat(8)}`;
  const { launched, agentDir } = await launchSettings({ USERPROFILE: home, HOME: home }, async (dir) => {
    const skillDir = path.join(dir, "skills", "e2e-probe-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: e2e-probe-skill\ndescription: ${description}\n---\nBody\n`,
    );
  });
  try {
    const { page } = launched;
    await setLocaleTheme(page, "en", "light");
    await page.getByTestId("settings-nav-extensions").click({ timeout: 60_000 });
    const row = page.getByTestId("skill-row-e2e-probe-skill");
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).not.toContainText("User (global)");
    await expect(row).toContainText("E2E probe skill.");
    await expect(page.getByTestId("skills-empty")).toHaveCount(0);
    for (const locale of ["en", "zh-CN"] as const) {
      await setLocaleTheme(page, locale, "light");
      for (const width of [900, 1200]) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoOverflow(page.getByTestId("skills-card"));
      }
    }
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

// Skills 管理：添加（两个目的地各一次）、停用 / 启用（经 omp config disabledExtensions，别的条目保留）、删除（移进回收站）。
// USERPROFILE / HOME / PI_CODING_AGENT_DIR 都指到临时目录：`~/.agents` 就是临时目录里的，真实目录不会被碰。
// 选文件夹的系统对话框在主进程里打桩；源文件夹名、skill 名都带空格或中文。回收站是真的系统回收站，但里面只有这个临时 skill。
test("集成与插件：Skills 添加（共用 / 只有 omp）、停用与启用、删除进回收站，路径带空格和中文", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "omp-studio-home-"));
  const sources = await mkdtemp(path.join(os.tmpdir(), "omp-studio-skill-src-"));
  const env = (agentDir: string) => ({ ...process.env, PI_CODING_AGENT_DIR: agentDir, USERPROFILE: home, HOME: home });
  const sharedName = "e2e-shared-skill";
  const ownName = "e2e-own-skill";
  const longDescription = `Shared skill. ${"A long description that must be clamped inside the dialog. ".repeat(8)}`;
  const sharedSource = path.join(sources, "源 skill 一");
  const ownSource = path.join(sources, "own skill source");
  await mkdir(path.join(sharedSource, "scripts"), { recursive: true });
  await writeFile(
    path.join(sharedSource, "SKILL.md"),
    `---\nname: ${sharedName}\ndescription: ${longDescription}\n---\nBody\n`,
  );
  await writeFile(path.join(sharedSource, "scripts", "run.txt"), "你好\n");
  await mkdir(ownSource, { recursive: true });
  await writeFile(path.join(ownSource, "SKILL.md"), `---\nname: ${ownName}\ndescription: Own skill\n---\nBody\n`);
  // 配置里原有一条别的停用项：停用 / 启用 skill 不能动它。
  const otherEntry = "context-file:user:E2E-OTHER.md";
  const { launched, agentDir } = await launchSettings({ USERPROFILE: home, HOME: home }, async (dir) => {
    execFileSync("omp", ["config", "set", "--json", "disabledExtensions", "--", JSON.stringify([otherEntry])], {
      env: env(dir),
      encoding: "utf8",
    });
  });
  const disabledEntries = () =>
    (
      JSON.parse(
        execFileSync("omp", ["config", "get", "--json", "disabledExtensions"], {
          env: env(agentDir),
          encoding: "utf8",
        }),
      ) as { value: string[] }
    ).value;
  const exists = (target: string) =>
    access(target).then(
      () => true,
      () => false,
    );
  try {
    const { page, app } = launched;
    await setLocaleTheme(page, "en", "light");
    // 900 宽时设置导航收成下拉：先切到集成页再收窄。
    await page.getByTestId("settings-nav-extensions").click({ timeout: 60_000 });
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.getByTestId("skills-card")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("skills-add")).toBeEnabled({ timeout: 60_000 });

    const pickFolder = async (folder: string) => {
      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      }, folder);
      await page.getByTestId("skills-add").click();
      await page.getByTestId("skill-pick").click();
    };

    // 对话框里的 ⓘ 说明整块可见：弹层不被对话框正文（overflow: auto）裁掉，四条边的中点上看到的都是弹层自己
    // （不取角：圆角外的点本来就不算弹层）。
    await page.getByTestId("skills-add").click();
    await page.getByTestId("skill-form").locator(".ui-info-btn").hover();
    const tip = page.getByRole("tooltip").filter({ hasText: "~/.agents/skills" });
    await expect(tip).toBeVisible();
    const hidden = await tip.evaluate((element) => {
      type Box = { left: number; right: number; top: number; bottom: number };
      const doc = globalThis as unknown as {
        document: { elementFromPoint(x: number, y: number): unknown };
      };
      const node = element as unknown as { getBoundingClientRect(): Box; contains(other: unknown): boolean };
      const box = node.getBoundingClientRect();
      const midX = (box.left + box.right) / 2;
      const midY = (box.top + box.bottom) / 2;
      const points: [string, number, number][] = [
        ["top", midX, box.top + 2],
        ["bottom", midX, box.bottom - 2],
        ["left", box.left + 2, midY],
        ["right", box.right - 2, midY],
      ];
      return points.filter(([, x, y]) => !node.contains(doc.document.elementFromPoint(x, y))).map(([edge]) => edge);
    });
    expect(hidden).toEqual([]);
    await page.getByTestId("skill-cancel").click();
    await expect(page.getByTestId("skill-form")).toHaveCount(0);

    // 添加 1：默认目的地 = 各家 agent 共用（~/.agents/skills）。界面只看到文件夹名和解析出的名字 / 说明，没有路径。
    await pickFolder(sharedSource);
    await expect(page.getByTestId("skill-picked-folder")).toHaveText("源 skill 一");
    await expect(page.getByTestId("skill-picked-name")).toHaveText(sharedName);
    await expect(page.getByTestId("skill-picked-description")).toContainText("Shared skill.");
    await expect(page.getByTestId("skill-form")).not.toContainText(sources);
    await expectNoOverflow(page.getByTestId("skill-form"));
    await expect(page.getByTestId("skill-target-shared")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("skill-save").click();
    await expect(page.getByTestId("skill-form")).toHaveCount(0);
    await expect(page.getByTestId(`skill-row-${sharedName}`)).toBeVisible({ timeout: 30_000 });
    // 卡片右上角标出装在哪。
    await expect(page.getByTestId(`skill-source-${sharedName}`)).toHaveText("Shared");
    const sharedDir = path.join(home, ".agents", "skills", sharedName);
    expect(await readFile(path.join(sharedDir, "scripts", "run.txt"), "utf8")).toBe("你好\n");
    // 添加后提示运行中的任务需要重新加载（同插件区的那条）。
    await expect(page.getByTestId("plugins-reload")).toBeVisible();

    // 添加 2：只有 omp（agent 目录的 skills/）。
    await pickFolder(ownSource);
    await expect(page.getByTestId("skill-picked-name")).toHaveText(ownName);
    await page.getByTestId("skill-target-omp").click();
    await expect(page.getByTestId("skill-target-omp")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("skill-save").click();
    await expect(page.getByTestId("skill-form")).toHaveCount(0);
    await expect(page.getByTestId(`skill-row-${ownName}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`skill-source-${ownName}`)).toHaveText("omp");
    const ownDir = path.join(agentDir, "skills", ownName);
    expect(await exists(path.join(ownDir, "SKILL.md"))).toBe(true);

    // 同名再添加：拒绝，对话框里给出原因，已有的文件夹不变。
    await pickFolder(ownSource);
    await page.getByTestId("skill-target-omp").click();
    await page.getByTestId("skill-save").click();
    await expect(page.getByTestId("skill-form-error")).toContainText("already exists");
    await page.getByTestId("skill-cancel").click();
    await expect(page.getByTestId("skill-form")).toHaveCount(0);

    // 停用：行显示"已停用"，omp 配置里多一条 skill:<name>，原有的条目还在。
    const row = page.getByTestId(`skill-row-${sharedName}`);
    const toggle = page.getByTestId(`skill-enabled-${sharedName}`);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(page.getByTestId(`skill-disabled-${sharedName}`)).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(disabledEntries()).toEqual([otherEntry, `skill:${sharedName}`]);
    // 被停用的行只剩名字：不能删除。
    await expect(page.getByTestId(`skill-remove-${sharedName}`)).toBeDisabled();
    await expect(row).toBeVisible();

    // 启用：徽标没了，配置里只剩原来那条。
    await toggle.click();
    await expect(page.getByTestId(`skill-disabled-${sharedName}`)).toHaveCount(0, { timeout: 30_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(disabledEntries()).toEqual([otherEntry]);
    await expect(row).toContainText("Shared skill.");

    // 删除（在 ~/.agents 里的）：确认框写出文件夹（~ 开头）和"其他 agent 工具也会失去它"；先取消，文件夹还在。
    await page.getByTestId(`skill-remove-${sharedName}`).click();
    await expect(page.getByTestId("skill-remove-folder")).toHaveText(`~/.agents/skills/${sharedName}`);
    await expect(page.getByTestId("skill-remove-shared")).toBeVisible();
    await page.getByTestId("skill-remove-confirm-dialog-cancel").click();
    await expect(page.getByTestId("skill-remove-confirm-dialog")).toHaveCount(0);
    expect(await exists(sharedDir)).toBe(true);
    await page.getByTestId(`skill-remove-${sharedName}`).click();
    await page.getByTestId("skill-remove-confirm-dialog-confirm").click();
    await expect(page.getByTestId(`skill-row-${sharedName}`)).toHaveCount(0, { timeout: 30_000 });
    expect(await exists(sharedDir)).toBe(false);

    // 删除（只有 omp 的）：没有"其他 agent 工具"那句。
    await page.getByTestId(`skill-remove-${ownName}`).click();
    await expect(page.getByTestId("skill-remove-folder")).toContainText(ownName);
    await expect(page.getByTestId("skill-remove-shared")).toHaveCount(0);
    await page.getByTestId("skill-remove-confirm-dialog-confirm").click();
    await expect(page.getByTestId(`skill-row-${ownName}`)).toHaveCount(0, { timeout: 30_000 });
    expect(await exists(ownDir)).toBe(false);

    // 中文下对话框也不越界。
    await setLocaleTheme(page, "zh-CN", "light");
    await pickFolder(sharedSource);
    await expect(page.getByTestId("skill-picked-name")).toHaveText(sharedName);
    await expectNoOverflow(page.getByTestId("skill-form"));
    await page.getByTestId("skill-cancel").click();
    await expect(page.getByTestId("skill-form")).toHaveCount(0);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rm(sources, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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
      plugins: [
        {
          name: "p1",
          source: "./p1",
          description: `First local plugin. ${"A long description that must stay within two lines. ".repeat(10)}`,
          version: "1.0.0",
        },
      ],
    }),
  );
  await writeFile(path.join(market, "p1", "package.json"), JSON.stringify({ name: "p1", version: "1.0.0" }));
  const { launched, agentDir } = await launchSettings({ USERPROFILE: home, HOME: home });
  try {
    const { page } = launched;
    await setLocaleTheme(page, "en", "light");
    await page.getByTestId("settings-nav-extensions").click();
    await expect(page.getByTestId("plugins-empty")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("marketplace-add-open").click();
    await expect(page.getByTestId("marketplace-add")).toBeDisabled();

    // 添加市场（本地目录）。
    await page.getByTestId("marketplace-add-input").fill(market);
    await page.getByTestId("marketplace-add").click();
    await expect(page.getByTestId("marketplace-add-dialog")).toHaveCount(0);
    await expect(page.getByTestId("marketplace-local-mk")).toBeVisible({ timeout: 60_000 });
    // 添加市场不影响运行中的任务，不出现重新加载提示。
    await expect(page.getByTestId("plugins-reload")).toHaveCount(0);

    // 浏览并安装：先弹确认，取消不装。
    await page.getByTestId("marketplace-browse-btn-local-mk").click();
    await expect(page.getByTestId("discover-p1@local-mk")).toContainText("First local plugin", { timeout: 60_000 });
    // 描述只显示两行（完整的在悬停提示里）。
    const lines = await page
      .getByTestId("discover-p1@local-mk")
      .locator(".ui-list-meta")
      .evaluate((element) => {
        const el = element as unknown as { getBoundingClientRect(): { height: number } };
        const style = (
          globalThis as unknown as { getComputedStyle(node: unknown): { lineHeight: string } }
        ).getComputedStyle(element);
        return el.getBoundingClientRect().height / Number.parseFloat(style.lineHeight);
      });
    expect(Math.round(lines)).toBe(2);
    await page.getByTestId("discover-install-p1@local-mk").click();
    const dialog = page.getByTestId("plugin-install-confirm");
    await expect(dialog).toContainText("third-party code");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("plugin-row-p1@local-mk")).toHaveCount(0);
    expect((await page.evaluate(() => globalThis.studio.listPlugins(null))).marketplace).toHaveLength(0);

    await page.getByTestId("discover-install-p1@local-mk").click();
    await page.getByTestId("plugin-install-confirm").getByRole("button", { name: "Install and trust" }).click();
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

    // 卸载先确认。
    await page.getByTestId("plugin-uninstall-p1@local-mk").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Uninstall" }).click();
    await expect(page.getByTestId("plugin-row-p1@local-mk")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("plugins-empty")).toBeVisible();

    // 移除市场。
    await page.getByTestId("marketplace-remove-local-mk").click();
    await expect(page.getByTestId("marketplace-local-mk")).toHaveCount(0, { timeout: 60_000 });

    // 中文界面同一页。
    await setLocaleTheme(page, "zh-CN", "dark");
    await expect(page.getByTestId("plugins-installed")).toContainText("已安装");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(market, { recursive: true, force: true });
  }
});

// 预设市场：不联网，所以不点预设的“添加”（会去 GitHub 拉仓库）。用一个本地目录市场，清单里 name 取预设的市场名，
// omp 回报的市场名与预设一致 → 该预设行隐藏，其余三个仍在；900 宽中英文不越界。
test("插件：预设市场行显示，已添加的预设隐藏，900 宽中英文不越界", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "omp-studio-home-"));
  const market = await mkdtemp(path.join(os.tmpdir(), "omp-studio-market-"));
  await mkdir(path.join(market, ".omp-plugin"), { recursive: true });
  await mkdir(path.join(market, "p1"), { recursive: true });
  await writeFile(
    path.join(market, ".omp-plugin", "marketplace.json"),
    JSON.stringify({
      name: "anthropic-agent-skills",
      owner: { name: "Test" },
      plugins: [{ name: "p1", source: "./p1", description: "First local plugin" }],
    }),
  );
  await writeFile(path.join(market, "p1", "package.json"), JSON.stringify({ name: "p1", version: "1.0.0" }));
  const { launched, agentDir } = await launchSettings({ USERPROFILE: home, HOME: home });
  try {
    const { page } = launched;
    await setLocaleTheme(page, "en", "light");
    await page.getByTestId("settings-nav-extensions").click({ timeout: 60_000 });
    await expect(page.getByTestId("plugins-empty")).toBeVisible({ timeout: 60_000 });
    const names = ["claude-plugins-official", "claude-community", "knowledge-work-plugins", "anthropic-agent-skills"];
    for (const name of names) await expect(page.getByTestId(`marketplace-preset-${name}`)).toBeVisible();
    await expect(page.getByTestId("marketplace-preset-claude-plugins-official")).toContainText(
      "anthropics/claude-plugins-official",
    );
    await expect(page.getByTestId("marketplace-preset-add-claude-community")).toBeEnabled();
    for (const locale of ["en", "zh-CN"] as const) {
      await setLocaleTheme(page, locale, "light");
      await page.setViewportSize({ width: 900, height: 800 });
      await expectNoOverflow(page.getByTestId("plugins-marketplaces"));
    }

    await page.getByTestId("marketplace-add-open").click();
    await page.getByTestId("marketplace-add-input").fill(market);
    await page.getByTestId("marketplace-add").click();
    await expect(page.getByTestId("marketplace-anthropic-agent-skills")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("marketplace-preset-anthropic-agent-skills")).toHaveCount(0);
    for (const name of names.slice(0, 3)) await expect(page.getByTestId(`marketplace-preset-${name}`)).toBeVisible();
    await expectNoOverflow(page.getByTestId("plugins-marketplaces"));
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(market, { recursive: true, force: true });
  }
});

test("OAuth 登录对话框：进度按顺序保留并按级别着色，omp 撤销输入后输入框收起（不运行真实登录，主进程 IPC 换成替身）", async () => {
  const { launched, agentDir } = await launchSettings();
  try {
    const { page, app } = launched;
    // startLogin 挂起到测试放行；login 事件由主进程推给渲染进程，和真实登录同一条通道。
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as unknown as { finishLogin?: () => void; loginAnswers?: unknown[][] };
      state.loginAnswers = [];
      ipcMain.removeHandler("studio:startLogin");
      ipcMain.handle(
        "studio:startLogin",
        (_event, providerId: string) =>
          new Promise((resolve) => {
            state.finishLogin = () => resolve({ ok: true, providerId });
          }),
      );
      ipcMain.removeHandler("studio:answerLoginInput");
      ipcMain.handle("studio:answerLoginInput", (_event, ...args: unknown[]) => {
        state.loginAnswers?.push(args);
      });
      ipcMain.removeHandler("studio:cancelLogin");
      ipcMain.handle("studio:cancelLogin", () => {
        state.finishLogin?.();
      });
    });
    const push = (payload: object) =>
      app.evaluate(({ BrowserWindow }, event) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("studio:event:login", event);
      }, payload);

    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-providers").click();
    await page.getByTestId("providers-connect").click();
    const pick = page.getByTestId("provider-pick");
    await expect(pick).toBeVisible({ timeout: 30_000 });
    // 取列表里第一个 OAuth 登录入口，不写死 provider 名字（哪些已连接取决于本机环境变量）。
    const login = pick.locator('[data-testid^="provider-login-"]').first();
    const id = ((await login.getAttribute("data-testid")) ?? "").slice("provider-login-".length);
    expect(id).not.toBe("");
    await login.click();
    const flow = page.getByTestId(`provider-flow-${id}`);
    await expect(flow).toBeVisible();

    await push({ type: "progress", level: "info", message: "Starting local callback server" });
    await push({ type: "progress", level: "warning", message: "Callback port busy, using fallback" });
    await push({ type: "progress", level: "error", message: "Token refresh failed, retrying" });
    await push({ type: "input", inputId: "i1", title: "Paste the authorization code" });
    const items = flow.getByTestId("login-progress").locator("li");
    // 历史条目按到达顺序全部保留，不只显示最后一条。
    await expect(items).toHaveText([
      "Starting local callback server",
      "Callback port busy, using fallback",
      "Token refresh failed, retrying",
    ]);
    await expect(items.nth(0)).toHaveAttribute("data-level", "info");
    await expect(items.nth(1)).toHaveAttribute("data-level", "warning");
    await expect(items.nth(2)).toHaveAttribute("data-level", "error");
    const input = flow.getByRole("textbox", { name: "Paste the authorization code" });
    await expect(input).toBeVisible();
    await input.fill("half-typed");

    // omp 超时 / 取消了这个输入：输入框收起，进度历史还在；"提交"按钮也一起消失。
    await push({ type: "input_closed", inputId: "i1" });
    await expect(input).toHaveCount(0);
    await expect(flow.getByRole("button", { name: /提交|Submit/ })).toHaveCount(0);
    await expect(items).toHaveCount(3);

    // 又来一个新输入：上一个输入框里没提交的字不带过来。
    await push({ type: "input", inputId: "i2", title: "Paste the authorization code" });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("");

    await page.getByTestId("provider-login-cancel").click();
    await expect(flow).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as unknown as { loginAnswers: unknown[] }).loginAnswers)).toEqual([]);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

/**
 * 应用内终端登录（docs/architecture/login.md "应用内登录"）：github-copilot 这类 rpc 里被 omp 拒绝的 provider，应用起一个临时 omp 跑 `/login`。
 * 未打包时 STUDIO_TEST_LOGIN_OMP（JSON `{command, args}`，同 STUDIO_TEST_OMP）指向假 omp，回放 omp 18.12.6 的真实录制
 * `fixtures/tsp/login-github-copilot.jsonl`（企业域名输入 → Continue → 设备码页）；假 omp 的 pid 记在文件里，用来确认进程真的结束。
 */
const fakeLoginOmp = path.resolve(import.meta.dirname, "..", "fake-omp", "fake-tsp-omp.ts");

async function readPids(file: string): Promise<number[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(Number);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("应用内终端登录：对话框里看到企业域名输入、设备码和链接，Open 走系统浏览器，取消 / Esc 后临时 omp 进程结束；非法 id 被拒", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp-studio-login-e2e-"));
  const pidFile = path.join(work, "pids.txt");
  const log = path.join(work, "fake-omp.jsonl");
  const { launched, agentDir } = await launchSettings({
    STUDIO_TEST_LOGIN_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeLoginOmp, "login-github-copilot", "--speed=20", `--log=${log}`],
    }),
    FAKE_OMP_PID_FILE: pidFile,
    // 本机环境变量会让 omp 把 github-copilot 算成已连接，它就没有"登录"按钮了。
    COPILOT_GITHUB_TOKEN: "",
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
  });
  try {
    const { page, app } = launched;
    const terminal = page.getByTestId("terminal-login");
    const flow = page.getByTestId("provider-flow-github-copilot");
    const openDialog = async () => {
      await page.getByTestId("providers-connect").click();
      const pick = page.getByTestId("provider-pick");
      await expect(pick).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("provider-search").fill("github-copilot");
      await pick.getByTestId("provider-terminal-login-github-copilot").click();
      await expect(flow).toBeVisible();
    };
    /** 点登录窗里 omp 的按钮（按节点 id 找，文字是 omp 的英文）。 */
    const ompButton = (id: string) => terminal.locator(`button[data-id="r.^sheet/0/actions/${id}"]`);
    /** 等假 omp 的进程结束（pid 文件里的都已不在）。 */
    const expectAllEnded = async (count: number) => {
      await expect.poll(async () => (await readPids(pidFile)).length).toBe(count);
      await expect.poll(async () => (await readPids(pidFile)).some(isAlive)).toBe(false);
    };

    // 渲染进程传来的 providerId 不可信：不在 omp 登录 provider 列表里的 id 被拒绝，也不会起进程。
    for (const bad of ["not-a-provider", "github-copilot --model x", "../../x"]) {
      const rejected = await page.evaluate(
        (id) =>
          globalThis.studio.startTerminalLogin(id).then(
            () => "resolved",
            (error: unknown) => (error instanceof Error ? error.message : String(error)),
          ),
        bad,
      );
      expect(rejected).toContain("unknown login provider");
    }
    expect(await readPids(pidFile)).toEqual([]);

    // 外链：Open sign-in page 走主进程的 shell.openExternal（只放行 http/https），这里换成记录器，不真的开浏览器。
    await app.evaluate(({ shell }) => {
      const state = globalThis as unknown as { opened: string[] };
      state.opened = [];
      shell.openExternal = (url: string) => {
        state.opened.push(url);
        return Promise.resolve();
      };
    });

    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-providers").click();

    // 第一次：走到设备码页，按 Esc 关对话框 → 进程结束。
    await openDialog();
    await expect(terminal).toContainText("GitHub Enterprise URL/domain");
    await ompButton("submit").click();
    const code = terminal.locator('[data-role="omp.login.code"]');
    await expect(code).toContainText("WDJB-MJHT");
    await expect(terminal).toContainText("https://github.com/login/device");
    await ompButton("openLink").click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
      .toEqual(["https://github.com/login/device"]);
    // omp 自己的 Cancel 按钮不画（页脚的"取消"是同一件事）。
    await expect(ompButton("cancel")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(flow).toHaveCount(0);
    await expectAllEnded(1);

    // 第二次：重新打开是一个新进程，从企业域名那一步重新开始（上一次的画面不残留）；点页脚的取消。
    await openDialog();
    await expect(terminal).toContainText("GitHub Enterprise URL/domain");
    await expect(code).toHaveCount(0);
    await ompButton("submit").click();
    await expect(code).toContainText("WDJB-MJHT");
    await page.getByTestId("provider-terminal-cancel").click();
    await expect(flow).toHaveCount(0);
    await expectAllEnded(2);

    // 假 omp 收到的是 `/login github-copilot`（主进程按 provider 拼的命令），而且没有别的文字。
    const sent = (await readFile(log, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { kind: string; body?: { ev?: string; text?: string } });
    const texts = sent.filter((record) => record.body?.ev === "send").map((record) => record.body?.text);
    expect(texts).toEqual(["/login github-copilot", "/login github-copilot"]);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
