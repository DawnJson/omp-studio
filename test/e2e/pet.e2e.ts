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
    species: string;
    branch: string | null;
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
    expect(info.bounds).toMatchObject({ width: 260, height: 470 });

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

test("pet.json 里的位置在屏幕外：夹回屏幕左上角，窗口整个在屏幕里、属性卡放到宠物下方且不撑出卡片；种子不变", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-pet-"));
  const seed = "00000000-0000-4000-8000-000000000042";
  // 名字够长：标题行（名字、稀有度、物种不换行）的最小宽度曾把属性卡撑出窗口。
  const name = "一二三四五六七八九十一二三四五六七八九十";
  await writeFile(
    path.join(userData, "pet.json"),
    JSON.stringify({ seed, soul: { name, personality: "", hatchedAt: 1 }, position: { x: -99999, y: -99999 } }),
  );
  const launched = await launchApp({ ...petEnv, STUDIO_USER_DATA: userData });
  try {
    const pet = await petPage(launched);
    const { bounds, area } = await petWindowInfo(launched);
    expect(bounds.x).toBe(area.x);
    expect(bounds.y).toBe(area.y);
    // 宠物贴着窗口左上角（工作区左上角），浮层在下方。
    const stage = (await pet.locator(".pet-stage").boundingBox())!;
    expect(stage).toMatchObject({ x: 0, y: 0 });
    await expect(pet.locator(".pet-root")).toHaveAttribute("data-below", "true");

    await launched.page.evaluate(() => globalThis.studio.petAction("card"));
    const card = pet.getByTestId("pet-card");
    await expect(pet.getByTestId("pet-name")).toHaveText(name);
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(stage.y + stage.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.width);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.height);
    const widths = await card.evaluate((element) => {
      const sizes = element as unknown as { scrollWidth: number; clientWidth: number };
      return { content: sizes.scrollWidth, card: sizes.clientWidth };
    });
    expect(widths.content).toBeLessThanOrEqual(widths.card);
    await expect(pet.getByTestId("pet-card-close")).toBeInViewport({ ratio: 1 });

    // 长句子的气泡不比窗口宽（曾因内边距不算进 max-width 被夹出左边），脚下摆放时也不压住升级提示。
    await pet.getByTestId("pet-card-close").click();
    await launched.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith("/pet.html"))!;
      window.webContents.send("pet:event:reaction", {
        kind: "say",
        text: "一句足够长的话，长到气泡要按窗口宽度换行才放得下，看它会不会出窗口",
      });
      window.webContents.send("pet:event:reaction", { kind: "levelUp", level: 3 });
    });
    const bubble = (await pet.getByTestId("pet-bubble").boundingBox())!;
    const badge = (await pet.getByTestId("pet-badge").boundingBox())!;
    expect(bubble.x).toBeGreaterThanOrEqual(0);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(bounds.width);
    expect(bubble.y).toBeGreaterThanOrEqual(badge.y + badge.height);

    const saved = await readPet(userData);
    expect(saved.seed).toBe(seed);
    expect(saved.soul?.name).toBe(name);
  } finally {
    await launched.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("满级的老宠物：补存物种、定下路线，觉醒形态带满档粒子和光圈；属性卡名字前有 ★，显示陪伴天数", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-pet-"));
  await writeFile(
    path.join(userData, "pet.json"),
    JSON.stringify({
      seed: "00000000-0000-4000-8000-000000000044",
      soul: { name: "Old", personality: "", hatchedAt: 1 },
      // Lv99 = 20 × 98²；没有 species、branch（物种表扩充之前的文件）
      growth: { xp: 192_080, totals: { daily: 123 } },
    }),
  );
  const launched = await launchApp({ ...petEnv, STUDIO_USER_DATA: userData });
  try {
    const pet = await petPage(launched);
    const sprite = pet.getByTestId("pet-sprite");
    await expect(sprite).toHaveAttribute("data-stage", "awakened");
    await expect.poll(async () => (await readPet(userData)).branch).not.toBeNull();
    const saved = await readPet(userData);
    expect(["pi", "duck", "cat", "owl", "ghost", "robot", "axolotl"]).toContain(saved.species);
    await expect(sprite).toHaveAttribute("data-branch", saved.branch!);
    await expect(sprite.locator(".pet-particle")).toHaveCount(6);
    await expect(sprite.locator(".pet-art[data-glow]")).toHaveCount(1);
    await launched.page.evaluate(() => globalThis.studio.petAction("card"));
    await expect(pet.getByTestId("pet-name")).toHaveText("★ Old");
    await expect(pet.getByTestId("pet-together")).toContainText("123");
  } finally {
    await launched.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("右键重新孵化：宠物窗口里的 studio 样式确认框；Esc 和取消都不动，确认后换新种子、重新起名", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-pet-"));
  const seed = "00000000-0000-4000-8000-000000000043";
  await writeFile(
    path.join(userData, "pet.json"),
    JSON.stringify({ seed, soul: { name: "Old", personality: "", hatchedAt: 1 } }),
  );
  const launched = await launchApp({ ...petEnv, STUDIO_USER_DATA: userData });
  // 右键菜单是系统菜单，Playwright 点不到：直接推菜单项发的那个动作。
  const openConfirm = () =>
    launched.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith("/pet.html"))!;
      window.webContents.send("pet:event:reaction", { kind: "confirmRehatch" });
    });
  try {
    const pet = await petPage(launched);
    const confirm = pet.getByTestId("pet-rehatch-confirm");
    await expect.poll(async () => (await petWindowInfo(launched)).visible).toBe(true);

    await openConfirm();
    await expect(confirm).toBeVisible();
    // 打开时窗口临时可聚焦（Esc 要用），焦点在确认框本身（鼠标打开的，不在按钮上画焦点环）。
    await expect.poll(async () => (await petWindowInfo(launched)).focusable).toBe(true);
    await expect(confirm).toBeFocused();
    await pet.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect.poll(async () => (await petWindowInfo(launched)).focusable).toBe(false);

    await openConfirm();
    await pet.getByTestId("pet-rehatch-cancel").click();
    await expect(confirm).toHaveCount(0);
    expect((await readPet(userData)).seed).toBe(seed);

    await openConfirm();
    await pet.getByTestId("pet-rehatch-confirm-button").click();
    await expect(confirm).toHaveCount(0);
    await expect.poll(async () => (await readPet(userData)).seed).not.toBe(seed);
    // 新的一只由假 omp 起名 Pixel。
    await expect.poll(async () => (await readPet(userData)).soul?.name).toBe("Pixel");
  } finally {
    await launched.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
