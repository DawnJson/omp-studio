// 启动构建产物（先 npm run build）：Playwright 的 _electron.launch。userData 和 omp 的 agent 目录都指到临时目录，
// 和真实数据隔离：会话索引读的是 PI_CODING_AGENT_DIR，里面只有这里造的假会话，真实 ~/.omp 不会出现在界面里。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { findOmpOnPath } from "../../src/main/omp/discover.ts";
import { parseTestOmpOverride } from "../../src/main/omp/launch-args.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  /** 本次启动用的 omp agent 目录（调用方没传 PI_CODING_AGENT_DIR 时是自动造的临时目录）。 */
  agentDir: string;
  close(): Promise<void>;
}

/**
 * 像在文件管理器里选中这些文件按 Cmd/Ctrl+C，往系统剪贴板放真实的文件列表。会改系统剪贴板。
 * Windows：PowerShell 的 Set-Clipboard -LiteralPath（CF_HDROP）。
 * macOS：osascript 的 `set the clipboard to {POSIX file …}`（文件 URL 列表）。mac 分支没有在 mac 上跑过（推测），这台开发机是 Windows。
 */
export async function copyFilesToClipboard(files: readonly string[]): Promise<void> {
  if (process.platform === "darwin") {
    const list = files.map((file) => `POSIX file "${file.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(", ");
    await promisify(execFile)("osascript", ["-e", `set the clipboard to {${list}}`]);
    return;
  }
  const list = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(",");
  await promisify(execFile)("powershell", ["-NoProfile", "-Command", `Set-Clipboard -LiteralPath ${list}`]);
}

const headerLine = (id: string, cwd: string) =>
  `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-10-18T00:00:00.000Z", cwd })}\n`;
const userLine = (text: string) =>
  `${JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: [{ type: "text", text }] } })}\n`;

/** 假会话：标题中英混排、其中一条很长（测省略），修改时间依次相差几小时。cwd 指向 projectDir（可以是任何字符串）。 */
export async function seedFakeSessions(agentDir: string, projectDir: string): Promise<void> {
  const bucket = path.join(agentDir, "sessions", "--fake-project--");
  await mkdir(bucket, { recursive: true });
  const prompts = [
    "整理日志格式并补上单元测试",
    "Fix the flaky login test on CI",
    "把设置页的语言切换改成立即生效，并且在窄窗口下也不要撑破布局，顺便检查一下中英文混排时的行高是否一致",
    "Add pagination to the task list",
    "排查内存泄漏",
    "Write release notes for 0.1",
  ];
  const now = Date.now();
  for (const [index, prompt] of prompts.entries()) {
    const file = path.join(bucket, `2026-10-18T0${index}-00-00-000Z_fake-${index}.jsonl`);
    await writeFile(file, headerLine(`fake-${index}`, projectDir) + userLine(prompt), "utf8");
    const modified = new Date(now - (index + 1) * 3 * 60 * 60 * 1000);
    await utimes(file, modified, modified);
  }
}

/** 主进程的接管询问记录（src/main/omp-manager/takeover-state.ts）。键是 exe 路径，Windows 上小写。 */
async function seedTakeoverDeclined(userDataDir: string, exePaths: string[]): Promise<void> {
  const takeover = Object.fromEntries(
    exePaths.map((exe) => [process.platform === "win32" ? exe.toLowerCase() : exe, "declined"]),
  );
  await writeFile(path.join(userDataDir, "omp-studio-state.json"), JSON.stringify({ takeover }), "utf8");
}

/**
 * askTakeover=false（默认）时预先替用户拒绝接管 PATH 上的 omp 和 STUDIO_TEST_OMP 的假 omp：
 * 不测接管的用例不该被接管弹窗挡住，也绝不能在测试里真的下载 omp、改用户 PATH。
 */
export async function launchApp(
  extraEnv: Record<string, string> = {},
  options: { askTakeover?: boolean } = {},
): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-"));
  if (options.askTakeover !== true) {
    const testOmp = extraEnv["STUDIO_TEST_OMP"] ?? process.env["STUDIO_TEST_OMP"];
    const onPath = await findOmpOnPath().catch(() => null);
    await seedTakeoverDeclined(userDataDir, [
      ...(testOmp ? [parseTestOmpOverride(testOmp).command] : []),
      ...(onPath ? [onPath] : []),
    ]);
  }
  const ownedAgentDir =
    extraEnv["PI_CODING_AGENT_DIR"] === undefined ? await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-")) : null;
  if (ownedAgentDir !== null) await seedFakeSessions(ownedAgentDir, path.join(os.tmpdir(), "omp studio 假项目"));
  const agentDir = ownedAgentDir ?? extraEnv["PI_CODING_AGENT_DIR"] ?? "";
  // 指向 Vite 开发服务器的变量会让应用去加载开发页面；e2e 只跑构建产物。
  // 在 omp-studio 的任务里跑测试时，继承来的 STUDIO_BROWSER_CDP 是那个任务的浏览器：传下去的话，被测应用起的
  // 后台 omp 会带着它，用例可能连到用户正在用的 omp-studio 的浏览器面板上。
  const { ELECTRON_RENDERER_URL: _devUrl, STUDIO_BROWSER_CDP: _outerBrowser, ...baseEnv } = process.env;
  // Windows 上 Electron 退出后文件句柄可能还要一会儿才放（杀毒软件也会扫新文件）：EBUSY/EPERM 时重试。
  const removeDirs = async () => {
    try {
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } finally {
      if (ownedAgentDir !== null)
        await rm(ownedAgentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  };
  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      args: [root],
      cwd: root,
      // 窗口在屏幕外、不抢焦点（main-window.ts 的 e2eBackground）；要看着测试跑就在命令前设 STUDIO_E2E_BACKGROUND=0。
      env: {
        STUDIO_E2E_BACKGROUND: "1",
        ...baseEnv,
        STUDIO_USER_DATA: userDataDir,
        PI_CODING_AGENT_DIR: agentDir,
        ...extraEnv,
      },
    });
    const page = await app.firstWindow();
    const launchedApp = app;
    let exited = false;
    launchedApp.once("close", () => {
      exited = true;
    });
    return {
      app: launchedApp,
      page,
      userDataDir,
      agentDir,
      async close() {
        try {
          // 用例自己让应用退出过（app.quit() 路径）时不再去关（Playwright 对已退出的应用会抛错），只收拾目录。
          if (!exited) await launchedApp.close();
        } finally {
          await removeDirs();
        }
      },
    };
  } catch (error) {
    // 起到一半失败（窗口没出来等）：调用方拿不到 close，在这里收拾，不留进程和临时目录。
    await app?.close().catch(() => {});
    await removeDirs();
    throw error;
  }
}

const fakeTspOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

/**
 * STUDIO_TEST_OMP 的值：用假 omp（伪终端里回放 fixtures/tsp/<fixture>.jsonl 的 omp 录制）顶替 omp。
 * `log` 给了就把假 omp 收到的 TSP 事件和按键逐行追加进这个文件（见 fake-tsp-omp.ts 的 --log）；
 * `speed` 是回放速度（录制里的间隔除以它）。
 */
export function testOmp(fixture: string, options: { log?: string; speed?: number; args?: string[] } = {}): string {
  return JSON.stringify({
    command: process.execPath,
    args: [
      fakeTspOmp,
      fixture,
      `--speed=${options.speed ?? 20}`,
      ...(options.log === undefined ? [] : [`--log=${options.log}`]),
      ...(options.args ?? []),
    ],
  });
}

/**
 * 断言 `container` 里没有东西越界：容器自己不横向溢出，里面每个看得见的元素左右边都在容器内（容差 1px）。
 * 自己会裁剪或横向滚动的子容器（`overflow-x` 不是 visible，比如代码块、省略号文字）只查它本身，不查里面；
 * `position: fixed` 的（挂在别处的浮层）跳过。失败信息列出越界的元素和超出的像素。
 */
export async function expectNoOverflow(container: Locator): Promise<void> {
  const offenders = await container.evaluate((root) => {
    interface Rect {
      left: number;
      right: number;
      width: number;
      height: number;
    }
    interface El {
      children: ArrayLike<El>;
      scrollWidth: number;
      clientWidth: number;
      tagName: string;
      className: unknown;
      getAttribute(name: string): string | null;
      getBoundingClientRect(): Rect;
    }
    const g = globalThis as unknown as {
      getComputedStyle(el: El): { overflowX: string; position: string; visibility: string };
    };
    const top = root as unknown as El;
    const bounds = top.getBoundingClientRect();
    const found: string[] = [];
    if (top.scrollWidth > top.clientWidth + 1)
      found.push(`container: scrollWidth ${top.scrollWidth} > clientWidth ${top.clientWidth}`);
    const visit = (el: El): void => {
      for (const child of Array.from(el.children)) {
        const style = g.getComputedStyle(child);
        if (style.position === "fixed" || style.visibility === "hidden") continue;
        const rect = child.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const over = Math.max(bounds.left - rect.left, rect.right - bounds.right);
        if (over > 1) {
          const id = child.getAttribute("data-testid");
          const cls = typeof child.className === "string" ? child.className : "";
          found.push(
            `${child.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ""}${cls ? `.${cls.split(" ").join(".")}` : ""}: ${Math.round(over)}px`,
          );
          continue;
        }
        if (style.overflowX === "visible") visit(child);
      }
    };
    visit(top);
    return found;
  });
  expect(offenders, "越界的元素").toEqual([]);
}

/** 断言：容器里每个 ⓘ（InfoTip）都和它前面那段标签文字的最后一行在同一行，不会单独掉到下一行。 */
export async function expectInfoTipsOnLabelLine(container: Locator): Promise<void> {
  const offenders = await container.evaluate((root) => {
    interface Rect {
      top: number;
      bottom: number;
    }
    interface El {
      previousElementSibling: El | null;
      textContent: string | null;
      getClientRects(): ArrayLike<Rect>;
      getBoundingClientRect(): Rect & { width: number };
    }
    const tips = Array.from(
      (root as unknown as { querySelectorAll(s: string): ArrayLike<El> }).querySelectorAll(".ui-info"),
    );
    const found: string[] = [];
    for (const tip of tips) {
      const text = tip.previousElementSibling;
      const box = tip.getBoundingClientRect();
      if (text === null || box.width === 0) continue;
      const lines = Array.from(text.getClientRects());
      const last = lines.at(-1);
      if (last === undefined) continue;
      const middle = (box.top + box.bottom) / 2;
      if (middle < last.top || middle > last.bottom) found.push(text.textContent ?? "");
    }
    return found;
  });
  expect(offenders, "ⓘ 单独掉到下一行的标签").toEqual([]);
}

/**
 * 切换语言和主题，等界面真的换好再返回。换主题是整窗交叉淡入（App.tsx 的 view transition）：
 * html 上的 data-theme 已经变了，淡入放完之前量到的还是过渡中的画面。
 */
export async function setLocaleTheme(page: Page, locale: "zh-CN" | "en", theme: "light" | "dark"): Promise<void> {
  await page.evaluate(
    async ({ locale: nextLocale, theme: nextTheme }) => {
      await globalThis.studio.setLocale(nextLocale);
      await globalThis.studio.setTheme(nextTheme);
    },
    { locale, theme },
  );
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(async () => {
    const g = globalThis as unknown as {
      requestAnimationFrame(callback: () => void): number;
      document: {
        getAnimations(): { effect: { pseudoElement?: string | null } | null; finished: Promise<unknown> }[];
      };
    };
    // 过渡的伪元素和动画在更新回调之后的下一帧才建起来：先等两帧，再等它们放完。
    const frames = Promise.withResolvers<void>();
    g.requestAnimationFrame(() => g.requestAnimationFrame(() => frames.resolve()));
    await frames.promise;
    await Promise.all(
      g.document
        .getAnimations()
        .filter((animation) => animation.effect?.pseudoElement?.startsWith("::view-transition") === true)
        .map((animation) => animation.finished),
    );
  });
}

/** 展开侧栏里所有折叠着的文件夹（任务行只在文件夹展开时才画出来）；文件夹还没出现时先等它出现。 */
export async function expandSidebarFolders(page: Page): Promise<void> {
  await page
    .locator(".sb-group-toggle")
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  const collapsed = page.locator('.sb-group-toggle[data-collapsed="true"]');
  while ((await collapsed.count()) > 0) await collapsed.first().click();
}

/** 第 nth 个任务行（先展开折叠的文件夹）。 */
async function taskRow(page: Page, nth = 0) {
  await expandSidebarFolders(page);
  return page.getByTestId("task-row").nth(nth);
}

/** 点开第 nth 个任务（选中它）。 */
export async function openTaskRow(page: Page, nth = 0): Promise<void> {
  await (await taskRow(page, nth)).locator(".sb-row-main").click();
}

/**
 * 让渲染进程以为自己跑在 `platform` 上（只换 getAppInfo 的返回值里的 platform，主进程行为不变），然后重载页面。
 * 渲染进程的主修饰键、快捷键文字、`<html data-platform>` 都只看 AppInfo.platform，所以能在 Windows 上走 mac 分支。
 * getAppInfo 的 locale 取自 `setStubLocale` 设的值（先取真实值），用例里改语言要走 `setStubLocale`，否则收到 settings 事件重取 AppInfo 时会被换回去。
 */
export async function stubPlatform(
  app: ElectronApplication,
  page: Page,
  platform: "win32" | "darwin" | "linux",
): Promise<void> {
  const real = await page.evaluate(() => globalThis.studio.getAppInfo());
  await app.evaluate(
    ({ ipcMain }, info) => {
      Reflect.set(globalThis, "__stubAppInfo", info);
      ipcMain.removeHandler("studio:getAppInfo");
      ipcMain.handle("studio:getAppInfo", () => Reflect.get(globalThis, "__stubAppInfo"));
    },
    { ...real, platform },
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-platform", platform);
}

/** `stubPlatform` 之后改语言：先改假 AppInfo 的 locale，再让主进程切到同一语言（触发渲染进程重取 AppInfo）。 */
export async function setStubLocale(app: ElectronApplication, page: Page, locale: "zh-CN" | "en"): Promise<void> {
  await app.evaluate((_electron, next) => {
    const info = Reflect.get(globalThis, "__stubAppInfo") as Record<string, unknown>;
    info["locale"] = next;
  }, locale);
  await page.evaluate((next) => globalThis.studio.setLocale(next), locale);
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
}
