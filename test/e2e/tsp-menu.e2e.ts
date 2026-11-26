// TSP `menu` / `buttons` 节点和节点 `actions.menu` 的对象项（omp 19 起）。录制 fixtures/tsp/menu-buttons.jsonl 是手搓的：
// 开头取自 plan-review-short.jsonl（omp 19.2.1 录制，发 `/plan-review`），之后一帧在对话区放上 omp 19.2.1 计划审阅底栏的同款节点
// （plan-review.tsx 的 split Approve ▾、执行模型下拉）、一个 toolbar 组和一个带便签同款 actions（btw-controller.ts 的 #noteMenu、
// btw-note.tsx 的 outside）的普通 text 节点（不带 omp.btw.note role：那种节点 studio 不画），
// 假 omp 收到对应的 action 才往下放。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loadTspFixture, recordedUserEvents } from "../tsp-fixtures.ts";
import { expectNoOverflow, launchApp, setLocale } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
const FIXTURE = "menu-buttons";

async function start() {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp menu e2e-"));
  const project = path.join(work, "项目");
  await mkdir(project);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeOmp, FIXTURE, "--speed=20", `--log=${log}`],
    }),
  });
  const cleanup = async () => {
    await launched.close();
    await rm(work, { recursive: true, force: true });
  };
  try {
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await launched.page.getByTestId("sidebar-open-folder").click();
    await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
  /** 假 omp 收到的 action / toggle 事件，按顺序。 */
  const received = async (): Promise<Record<string, unknown>[]> =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
      .filter((record) => record.kind === "tsp" && ["action", "toggle"].includes(String(record.body?.["ev"])))
      .map((record) => record.body!);
  return { launched, received, cleanup };
}

const node = (page: Page, id: string) => page.locator(`[data-testid="tsp-view"] [data-id="${id}"]`);
const status = (page: Page) => node(page, "mx.status");

test("menu / buttons 节点和右键菜单对象项：split 是一个控件，选行发 action，单选带 checked，omp 给 open 就打开并高亮 active；900 宽中英文不越界", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start();
  try {
    const { page } = launched;
    const prompt = recordedUserEvents(loadTspFixture(FIXTURE)).find((entry) => entry.event["ev"] === "send")!.event[
      "text"
    ] as string;
    await page.getByTestId("composer-input").fill(prompt);
    await page.keyboard.press("Enter");
    const split = node(page, "mx.row/approve");
    await expect(split).toBeVisible({ timeout: 30_000 });

    // split：两半是同一个控件（role=group，中间没有缝，内侧没有圆角）。
    await expect(split).toHaveAttribute("role", "group");
    await expect(split).toHaveAttribute("aria-label", "Approve");
    const main = node(page, "mx.row/approve/main");
    const more = node(page, "mx.row/approve/more");
    const a = (await main.boundingBox())!;
    const b = (await more.boundingBox())!;
    expect(Math.abs(a.x + a.width - b.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.height - b.height)).toBeLessThan(1);
    await expect(main).toHaveCSS("border-top-right-radius", "0px");
    await expect(more).toHaveCSS("border-top-left-radius", "0px");
    await expect(more).toHaveAttribute("aria-label", "Approve options");
    // toolbar 组的 size=sm 盖过子按钮（子节点没给 size，默认是 md）。
    await expect(node(page, "mx.row/tools")).toHaveAttribute("role", "toolbar");
    await expect(node(page, "mx.row/tools/a")).toHaveAttribute("data-size", "sm");

    // 打开 split 的菜单：行文字、第二行 detail、小节标题、快捷键、不可用的原因、危险项。
    await more.click();
    const menu = page.getByTestId("tsp-node-menu");
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const rows = menu.getByRole("menuitem");
    await expect(rows).toHaveText([
      "Approve and clear contextStart a fresh session with the plan",
      "Approve and keep contextCtrl+Enter",
      "Reject planPlan is still being written",
    ]);
    await expect(menu.locator(".ui-menu-label")).toHaveText("Keep");
    await expect(rows.nth(2)).toHaveAttribute("aria-disabled", "true");
    await expect(rows.nth(2)).toHaveAttribute("data-tone", "danger");
    // 不可用的行点了什么都不发。
    await rows.nth(2).click({ force: true });
    await expect(menu).toBeVisible();
    await rows.first().click();
    await expect(status(page)).toHaveText("Chosen: approve-clear");
    await expect(menu).toHaveCount(0);
    await expect(more).toHaveAttribute("aria-expanded", "false");

    // 执行模型下拉：单选行，当前项打 ✓；选另一项发 checked: true，omp 回来后触发器换文字。
    const model = node(page, "mx.row/model");
    await expect(model).toHaveText("deepseek-chat");
    await model.click();
    await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
    await expect(menu.getByRole("menuitemradio").first()).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio").nth(1).click();
    await expect(model).toHaveText("deepseek-reasoner");
    await expect(model).toHaveAttribute("aria-expanded", "false");

    // 便签的右键菜单：对象项的 label 和图标、小节标题、分隔线；没列 copy 时末尾接 Copy。
    await node(page, "mx.note").click({ button: "right" });
    const context = page.getByTestId("tsp-menu");
    await expect(context.getByRole("menuitem")).toHaveText([
      "Copy answer",
      "Open in BTW history",
      "Fold to one line",
      /^(Copy|复制)$/,
    ]);
    await expect(context.getByRole("menuitem").first().locator("svg")).toHaveCount(1);
    await expect(context.locator(".ui-menu-label")).toHaveText("Note");
    await expect(context.getByRole("separator")).toHaveCount(1);
    await context.getByRole("menuitem", { name: "Fold to one line" }).click();
    await expect(status(page)).toHaveText("Chosen: btw-fold");

    // omp 把下拉设成 open（键盘光标在 tier:0）：不用点就打开，那一行高亮。Esc 关上、发 toggle open:false。
    await expect(menu).toBeVisible();
    await expect(model).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitemradio").first()).toHaveAttribute("data-active", "");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // 便签带 `actions.outside`：在它外面按下（点两个触发器）各发一次 btw-blur；在它上面、菜单里按下不发。
    const events = await received();
    const blur = { ev: "action", sf: "s:1", id: "mx.note", act: "btw-blur" };
    expect(events.filter((event) => event["act"] === "btw-blur")).toEqual([blur, blur]);
    expect(events.filter((event) => event["act"] !== "btw-blur")).toEqual([
      { ev: "toggle", sf: "s:1", id: "mx.row/approve/more", open: true },
      { ev: "action", sf: "s:1", id: "mx.row/approve/more", act: "approve-clear" },
      { ev: "toggle", sf: "s:1", id: "mx.row/approve/more", open: false },
      { ev: "toggle", sf: "s:1", id: "mx.row/model", open: true },
      { ev: "action", sf: "s:1", id: "mx.row/model", act: "tier:1", checked: true },
      { ev: "toggle", sf: "s:1", id: "mx.row/model", open: false },
      { ev: "action", sf: "s:1", id: "mx.note", act: "btw-fold" },
      { ev: "toggle", sf: "s:1", id: "mx.row/model", open: false },
    ]);

    // 900 宽、中英文：底栏一行和打开的菜单都不越界。
    await page.setViewportSize({ width: 900, height: 700 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocale(page, locale);
      await expectNoOverflow(node(page, "mx"));
      await more.click();
      await expect(menu).toBeVisible();
      await expectNoOverflow(menu);
      const box = (await menu.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(900);
      await page.keyboard.press("Escape");
      await expect(more).toHaveAttribute("aria-expanded", "false");
    }
  } finally {
    await cleanup();
  }
});
