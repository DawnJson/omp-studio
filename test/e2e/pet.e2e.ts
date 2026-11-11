// 桌面宠物（docs/architecture/pet.md）：第二个窗口（透明、置顶、不抢焦点、只有 PetApi）、孵化起名、摸一下记经验和说话、
// 表情跟着任务状态走、设置开关窗口、位置夹回屏幕。起名和说话的 `omp -p` 是假 omp（fake-omp-print.ts 的 pet 模式）。
// 拖动靠真实光标（主进程按 screen.getCursorScreenPoint 挪窗口），Playwright 的鼠标事件挪不动系统光标，这里不测，见 pet.md「验证」。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loadTspFixture, recordedUserEvents } from "../tsp-fixtures.ts";
import { launchApp, openTaskRow, testOmp, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakePrint = path.join(root, "test", "fake-omp", "fake-omp-print.ts");
const PROMPT = (recordedUserEvents(loadTspFixture("approval"))[0]?.event as { text?: string } | undefined)?.text ?? "";

const petEnv = {
  STUDIO_E2E_NO_PET: "0",
  STUDIO_TEST_PET_OMP: JSON.stringify({ command: process.execPath, args: [fakePrint] }),
  FAKE_PRINT_MODE: "pet",
};

async function petPage(launched: LaunchedApp): Promise<Page> {
  await expect.poll(() => launched.app.windows().some((page) => page.url().endsWith("/pet.html"))).toBe(true);
  return launched.app.windows().find((page) => page.url().endsWith("/pet.html"))!;
}

const petWindowCount = (launched: LaunchedApp) =>
  launched.app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().endsWith("/pet.html")).length,
  );

const petWindowInfo = (launched: LaunchedApp) =>
  launched.app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith("/pet.html"))!;
    const bounds = window.getBounds();
    return {
      bounds,
      onTop: window.isAlwaysOnTop(),
      focusable: window.isFocusable(),
      visible: window.isVisible(),
      area: screen.getDisplayMatching(bounds).workArea,
    };
  });

const readPet = async (userDataDir: string) =>
  JSON.parse(await readFile(path.join(userDataDir, "pet.json"), "utf8")) as {
    seed: string;
    soul: { name: string } | null;
    growth: { totals: { pet: number } };
    spend: { total: { calls: number } };
  };

test("宠物窗口：置顶不抢焦点、拿不到主窗口的接口；孵化起名，摸一下记经验并说话；表情跟着任务；设置开关窗口", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 宠物 e2e-"));
  const project = path.join(work, "项目");
  await mkdir(project);
  const launched = await launchApp({ ...petEnv, STUDIO_TEST_OMP: testOmp("approval") });
  try {
    const pet = await petPage(launched);
    await expect.poll(async () => (await petWindowInfo(launched)).visible).toBe(true);
    const info = await petWindowInfo(launched);
    expect(info).toMatchObject({ onTop: true, focusable: false });
    expect(await pet.evaluate(() => ({ studio: "studio" in globalThis, pet: "pet" in globalThis }))).toEqual({
      studio: false,
      pet: true,
    });
    expect(info.bounds).toMatchObject({ width: 260, height: 400 });

    const sprite = pet.getByTestId("pet-sprite");
    await expect(sprite).toHaveAttribute("data-stage", "egg");
    await expect(sprite).toHaveAttribute("data-mood", "idle");
    // 孵化：假 omp 起名 Pixel，写进 pet.json。
    await expect.poll(async () => (await readPet(launched.userDataDir)).soul?.name).toBe("Pixel");

    // 摸一下：经验记进 pet.json（当天第一次还有签到经验，从 Lv1 升到 Lv2），说话开着时冒一句：升级那句优先（假 omp 原样回显事件）。
    await sprite.click();
    await expect.poll(async () => (await readPet(launched.userDataDir)).growth.totals.pet).toBe(1);
    await expect(pet.getByTestId("pet-badge")).toHaveText("Lv 2");
    await expect(pet.getByTestId("pet-bubble")).toHaveText("said: You just reached level 2.");

    // 花费：孵化 + 升级那句 = 2 次调用，假 omp 每次报 1000 token / $0.002；设置 -> 通用 里今天和累计都是这么多。
    await expect.poll(async () => (await readPet(launched.userDataDir)).spend.total.calls).toBe(2);
    await launched.page.keyboard.press("Control+,");
    await launched.page.getByTestId("settings-nav-general").click();
    for (const row of ["setting-pet-spent-today", "setting-pet-spent-total"])
      await expect(launched.page.getByTestId(row)).toContainText(/2 (次|calls) · 2K tokens? · \$0\.0040/);
    await launched.page.keyboard.press("Escape");
    await expect(launched.page.getByTestId("settings")).toHaveCount(0);

    // 主窗口的 /pet 同一个入口：打开属性卡。
    await launched.page.evaluate(() => globalThis.studio.petAction("card"));
    await expect(pet.getByTestId("pet-name")).toHaveText("Pixel");
    await pet.getByTestId("pet-card-close").click();
    await expect(pet.getByTestId("pet-card")).toHaveCount(0);

    // 任务停在"等你确认"：宠物举手。
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await launched.page.evaluate(async () => {
      const added = await globalThis.studio.addProject();
      if (!added) throw new Error("addProject 没有返回项目");
      await globalThis.studio.createTask({ projectId: added.id });
    });
    await openTaskRow(launched.page);
    const input = launched.page.getByTestId("composer-input");
    await input.fill(PROMPT);
    await launched.page.keyboard.press("Enter");
    await expect(sprite).toHaveAttribute("data-mood", "waiting", { timeout: 30_000 });

    // 设置里关掉：窗口没了；再打开：回到原来的位置。
    await launched.page.evaluate(() => globalThis.studio.setPetEnabled(false));
    await expect.poll(() => petWindowCount(launched)).toBe(0);
    await launched.page.evaluate(() => globalThis.studio.setPetEnabled(true));
    await expect.poll(() => petWindowCount(launched)).toBe(1);
    expect((await petWindowInfo(launched)).bounds).toEqual(info.bounds);
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("pet.json 里的位置在屏幕外：夹回屏幕里；种子不变（还是同一只）", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-pet-"));
  const seed = "00000000-0000-4000-8000-000000000042";
  await writeFile(
    path.join(userData, "pet.json"),
    JSON.stringify({ seed, soul: { name: "Old", personality: "", hatchedAt: 1 }, position: { x: -99999, y: -99999 } }),
  );
  const launched = await launchApp({ ...petEnv, STUDIO_USER_DATA: userData });
  try {
    await petPage(launched);
    const { bounds, area } = await petWindowInfo(launched);
    // 宠物（窗口底部正中 110×115）整个在工作区里。
    const spriteLeft = bounds.x + (bounds.width - 110) / 2;
    const spriteTop = bounds.y + bounds.height - 115;
    expect(spriteLeft).toBeGreaterThanOrEqual(area.x);
    expect(spriteTop).toBeGreaterThanOrEqual(area.y);
    expect(spriteLeft + 110).toBeLessThanOrEqual(area.x + area.width);
    expect(spriteTop + 115).toBeLessThanOrEqual(area.y + area.height);
    const saved = await readPet(userData);
    expect(saved.seed).toBe(seed);
    expect(saved.soul?.name).toBe("Old");
  } finally {
    await launched.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
