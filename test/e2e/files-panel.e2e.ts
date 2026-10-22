// 右侧文件面板的端到端（spec §4.27）：顶栏按钮 / Ctrl Shift E 打开，文件树懒加载、展开、键盘操作，点文件在同一面板的预览页里看，
// 一层 1500 项只画眼前的行，展开状态按任务记住，越界的 listDirectory 被拒绝；工作区目录（/add-dir）：额外根的添加、浏览、预览、移除、越界拒绝。中英 × 深浅各截图到 screenshots/（files-*）。
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { TaskId } from "../../src/shared/ipc.ts";
import { launchApp, openTaskRow, screenshotsDir, setLocaleTheme, testOmp, type LaunchedApp } from "./launch.ts";

const bigCount = 1500;

/** 页面里的元素：node 工程没有 DOM 类型，回调里只用到这几个成员。 */
interface DomNode {
  getAttribute(name: string): string | null;
  firstElementChild: { offsetHeight: number } | null;
  scrollTop: number;
  scrollHeight: number;
}

interface Started {
  launched: LaunchedApp;
  taskId: TaskId;
  /** `/add-dir` 要加的额外目录（空格和中文）。 */
  extra: string;
  /** 假 omp 记下的、主进程写给它的 TSP 事件和按键（--log）。 */
  inputLog: string;
  cleanup(): Promise<void>;
}

async function start(options: { dirs?: boolean } = {}): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 文件树 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(path.join(project, "src", "nested"), { recursive: true });
  await mkdir(path.join(project, "docs"));
  await mkdir(path.join(project, "big"));
  await mkdir(path.join(project, ".git"));
  await writeFile(path.join(project, "src", "alpha.ts"), "export const alpha = 1;\n");
  await writeFile(path.join(project, "src", "nested", "deep.md"), "# 深层标题\n\n正文\n");
  await writeFile(path.join(project, "docs", "guide.md"), "# 指南\n");
  await writeFile(path.join(project, "notes.md"), "# 笔记\n\n- 第一项\n");
  await writeFile(path.join(project, "Zeta.txt"), "zeta\n");
  await Promise.all(
    Array.from({ length: bigCount }, (_, i) => writeFile(path.join(project, "big", `file-${i}.txt`), `${i}\n`)),
  );
  // `/add-dir` 的额外目录（带空格和中文）和对应的回放录制：slash-status 录制的握手部分 + 两条命令的 toast（Added / Removed，omp 18.12.5 实测原文）。
  const extra = path.join(work, "额外 目录");
  await mkdir(path.join(extra, "sub"), { recursive: true });
  await writeFile(path.join(extra, "额外 笔记.md"), "# 额外目录里的笔记\n");
  const inputLog = path.join(work, "omp-input.jsonl");
  const listing = (...dirs: string[]) =>
    ["Workspace directories:", `  ${project} (working directory)`, ...dirs.map((dir) => `  ${dir}`)].join("\n");
  // omp 用同一个 toast 节点（id "u"）显示状态：第一条命令 add 它，第二条换文字；每条命令等收到和录制一样的 send 才回放。
  const toast = (text: string) => ({ k: "toast", p: { text, ttl: 2400, role: "omp.toast.status" } });
  const command = (t: number, seq: number, text: string, reply: string, first: boolean) => [
    { t, dir: "in", verb: "e", body: { ev: "send", sf: "s:1", id: "j.line/input", text } },
    {
      t: t + 5,
      dir: "out",
      verb: "f",
      body: {
        sf: "s:1",
        s: seq,
        ops: [
          first ? ["add", "u", "main", null, { id: "u", ...toast(reply) }] : ["set", "u", toast(reply).p],
          ["settle", "u"],
        ],
      },
    },
  ];
  const handshake = (
    await readFile(path.join(import.meta.dirname, "..", "..", "fixtures", "tsp", "slash-status.jsonl"), "utf8")
  )
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { dir: string; t: number; body: { ev?: string } });
  const firstSend = handshake.findIndex((entry) => entry.dir === "in" && entry.body.ev === "send");
  const kept = handshake.slice(0, firstSend);
  const last = kept.at(-1)?.t ?? 0;
  const dirsFixture = path.join(work, "dirs.jsonl");
  await writeFile(
    dirsFixture,
    [
      ...kept,
      ...command(last + 10, 4, `/add-dir ${extra}`, `Added ${extra}.\n${listing(extra)}`, true),
      ...command(last + 30, 5, `/remove-dir ${extra}`, `Removed ${extra}.\n${listing()}`, false),
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  const launched = await launchApp({
    STUDIO_TEST_OMP: options.dirs ? testOmp(dirsFixture, { log: inputLog }) : testOmp("slash-status"),
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  const { page } = launched;
  await page.evaluate(async () => {
    await globalThis.studio.setLocale("zh-CN");
    const added = await globalThis.studio.addProject();
    if (!added) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: added.id });
  });
  await openTaskRow(page);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  const taskId = await page.evaluate(async () => (await globalThis.studio.listTasks())[0]?.id);
  if (taskId === undefined) throw new Error("没有任务");
  return {
    launched,
    taskId,
    extra,
    inputLog,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    },
  };
}

const row = (page: Page, rel: string) => page.locator(`[data-testid=file-tree-row][data-path="${rel}"]`);

async function shoot(page: Page, state: string): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["zh-CN", "dark"],
    ["en", "light"],
    ["en", "dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await setLocaleTheme(page, locale, scheme);
    await page.screenshot({ path: path.join(screenshotsDir, `files-${state}-${locale}-${scheme}.png`) });
  }
  await page.evaluate(async () => {
    await globalThis.studio.setLocale("zh-CN");
  });
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", "zh-CN");
}

test("顶栏按钮打开文件面板：目录在前文件在后、不列 .git，展开、点文件在同一面板预览，展开状态按任务记住", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const pane = page.getByTestId("file-preview");
    const toggle = page.getByTestId("topbar-files");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(pane).toBeVisible();
    await expect(pane).toHaveAttribute("data-page", "files");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // 没打开过文件：预览页签不可点。
    await expect(page.getByTestId("file-preview-page-preview")).toBeDisabled();

    // 根目录：目录（big docs src）在前、文件（notes.md Zeta.txt）在后，按名排序；.git 不出现。
    const paths = page.locator("[data-testid=file-tree-row]");
    await expect(paths.first()).toBeVisible();
    await expect(page.getByTestId("file-tree")).toBeFocused();
    expect(
      await paths.evaluateAll((els) => els.map((el) => (el as unknown as DomNode).getAttribute("data-path"))),
    ).toEqual(["big", "docs", "src", "notes.md", "Zeta.txt"]);

    // 点目录展开（懒加载一层），再点收起。
    await row(page, "src").click();
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "src/nested")).toBeVisible();
    await expect(row(page, "src/alpha.ts")).toBeVisible();
    await expect(row(page, "src/nested/deep.md")).toHaveCount(0);
    await row(page, "src").click();
    await expect(row(page, "src/alpha.ts")).toHaveCount(0);
    await row(page, "src").click();
    await expect(row(page, "src/alpha.ts")).toBeVisible();

    // 点文件：切到预览页，渲染 Markdown。
    await row(page, "notes.md").click();
    await expect(pane).toHaveAttribute("data-page", "preview");
    await expect(page.getByTestId("file-preview-name")).toHaveText("notes.md");
    await expect(page.getByTestId("file-preview-md")).toContainText("第一项");
    await shoot(page, "preview");

    // 回文件页：树还在，src 仍展开。
    await page.getByTestId("file-preview-page-files").click();
    await expect(pane).toHaveAttribute("data-page", "files");
    await expect(row(page, "src/alpha.ts")).toBeVisible();
    await expect(row(page, "notes.md")).toHaveAttribute("aria-selected", "true");

    // 关闭再打开：展开状态按任务记住。
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await toggle.click();
    await expect(row(page, "src/alpha.ts")).toBeVisible();
    await shoot(page, "tree");
    await toggle.click();
    await expect(pane).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("键盘：Ctrl Shift E 开关，↑↓ 移动，→ 展开 / 进入子项，← 收起 / 回父目录，Enter 打开文件，Esc 关闭", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const pane = page.getByTestId("file-preview");
    const tree = page.getByTestId("file-tree");
    await page.keyboard.press("Control+Shift+E");
    await expect(pane).toBeVisible();
    await expect(tree).toBeFocused();
    const cursor = page.locator("[data-testid=file-tree-row][data-cursor]");
    await expect(cursor).toHaveCount(0);
    await expect(row(page, "big")).toBeVisible();

    // 第一次 ↓ 落在第一行 big；再 ↓ docs、↓ src。
    await page.keyboard.press("ArrowDown");
    await expect(cursor).toHaveAttribute("data-path", "big");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(cursor).toHaveAttribute("data-path", "src");
    // → 展开；再 → 进入第一个子项（目录 nested）；→ 展开它；→ 进入 deep.md；→ 文件上无动作。
    await page.keyboard.press("ArrowRight");
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "src/nested")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toHaveAttribute("data-path", "src/nested");
    await page.keyboard.press("ArrowRight");
    await expect(row(page, "src/nested/deep.md")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toHaveAttribute("data-path", "src/nested/deep.md");
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toHaveAttribute("data-path", "src/nested/deep.md");
    // ← 在文件上回到父目录；← 收起它；← 再回上一层父目录。
    await page.keyboard.press("ArrowLeft");
    await expect(cursor).toHaveAttribute("data-path", "src/nested");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "src/nested")).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "src/nested/deep.md")).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    await expect(cursor).toHaveAttribute("data-path", "src");
    // Enter 在目录上是展开 / 收起。
    await page.keyboard.press("Enter");
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
    // End / Home。
    await page.keyboard.press("End");
    await expect(cursor).toHaveAttribute("data-path", "Zeta.txt");
    await page.keyboard.press("Home");
    await expect(cursor).toHaveAttribute("data-path", "big");
    // Enter 在文件上：同一面板切到预览页。
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(pane).toHaveAttribute("data-page", "preview");
    await expect(page.getByTestId("file-preview-name")).toHaveText("Zeta.txt");
    await expect(page.getByTestId("file-preview-body")).toContainText("zeta");

    // Esc 关闭面板；Ctrl Shift E 再开，回到文件页。
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await page.keyboard.press("Control+Shift+E");
    await expect(pane).toHaveAttribute("data-page", "files");
    await page.keyboard.press("Control+Shift+E");
    await expect(pane).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("一层上千项：只渲染眼前的行，滚到底能看到最后一项；越界的 listDirectory 被拒绝", async () => {
  const { launched, taskId, cleanup } = await start();
  try {
    const { page } = launched;
    await page.getByTestId("topbar-files").click();
    await row(page, "big").click();
    await expect(row(page, "big/file-0.txt")).toBeVisible();
    const rendered = await page.locator("[data-testid=file-tree-row]").count();
    expect(rendered).toBeLessThan(100);
    const tree = page.getByTestId("file-tree");
    const canvas = await tree.evaluate((el) => (el as unknown as DomNode).firstElementChild!.offsetHeight);
    expect(canvas).toBeGreaterThan(bigCount * 20);
    // file-1499.txt 按数字排序在 big 里最后一个（同层的 notes.md 等文件在 big 之后）。
    await tree.evaluate((el) => {
      const node = el as unknown as DomNode;
      node.scrollTop = node.scrollHeight;
    });
    await expect(row(page, "Zeta.txt")).toBeVisible();
    await expect(row(page, `big/file-${bigCount - 1}.txt`)).toBeVisible();
    await expect(row(page, "big/file-0.txt")).toHaveCount(0);

    const list = (dir: string) =>
      page.evaluate(
        ([id, d]) => globalThis.studio.listDirectory({ kind: "task", taskId: id as TaskId }, d!),
        [taskId, dir],
      );
    expect((await list("big")).entries).toHaveLength(bigCount);
    await expect(list("..")).rejects.toThrow();
    await expect(list(path.join("src", "..", ".."))).rejects.toThrow();
    await expect(list(os.tmpdir())).rejects.toThrow();
  } finally {
    await cleanup();
  }
});

test("默认文件夹里的新任务草稿也有文件面板：目录还没建时为空，建好后刷新能看到文件，`@` 补全在那里也能用", async () => {
  const launched = await launchApp();
  try {
    const { page, userDataDir } = launched;
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    const chats = path.join(userDataDir, "chats");
    const toggle = page.getByTestId("topbar-files");
    await expect(toggle).toBeVisible();
    await toggle.click();
    const pane = page.getByTestId("file-preview");
    await expect(pane).toBeVisible();
    await expect(page.getByTestId("file-tree")).toBeFocused();
    await expect(page.locator("[data-testid=file-tree-row]")).toHaveCount(0);
    await expect(pane.locator(".file-preview-note")).toBeVisible();
    // 只读浏览不建目录。
    expect(
      await stat(chats).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    // 越界仍被拒绝。
    await expect(
      page.evaluate(() => globalThis.studio.listDirectory({ kind: "defaultFolder" }, "..")),
    ).rejects.toThrow();

    await mkdir(chats, { recursive: true });
    await writeFile(path.join(chats, "笔记 文件.md"), "# 草稿笔记\n");
    // `@` 补全不收名字里有空白的文件，另放一个没有空白的。
    await writeFile(path.join(chats, "笔记二.md"), "# 另一篇\n");
    await page.getByTestId("file-tree-refresh").click();
    await expect(row(page, "笔记 文件.md")).toBeVisible();
    await row(page, "笔记 文件.md").click();
    await expect(page.getByTestId("file-preview-md")).toContainText("草稿笔记");

    // `@` 补全。
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    const input = page.locator("[data-composer-input]");
    await input.focus();
    await input.pressSequentially("看看 @笔记");
    await expect(page.getByTestId("file-menu")).toContainText("笔记二.md");
  } finally {
    await launched.close();
  }
});

test("工作区目录：添加文件夹（空格和中文）→ 额外根出现并可浏览、预览；越界和过期下标被拒绝；移除后回到任务目录", async () => {
  const { launched, taskId, extra, inputLog, cleanup } = await start({ dirs: true });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, extra);
    await page.getByTestId("topbar-files").click();
    await expect(page.getByTestId("file-preview")).toBeVisible();
    // 还没有额外目录：只有"添加文件夹…"，没有根切换。
    await expect(page.getByTestId("workspace-add-dir")).toBeVisible();
    await expect(page.getByTestId("workspace-root-0")).toHaveCount(0);

    await page.getByTestId("workspace-add-dir").click();
    await expect(page.getByTestId("workspace-root-1")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("workspace-root-1")).toContainText("额外 目录");
    // 树换成额外目录：sub 和笔记，不是任务目录的 big/docs/src。
    await expect(row(page, "sub")).toBeVisible();
    await expect(row(page, "额外 笔记.md")).toBeVisible();
    await expect(row(page, "big")).toHaveCount(0);
    await row(page, "额外 笔记.md").click();
    await expect(page.getByTestId("file-preview-md")).toContainText("额外目录里的笔记");
    await shoot(page, "dirs");

    // 切回任务目录：原来的树。
    await page.getByTestId("file-preview-page-files").click();
    await page.getByTestId("workspace-root-0").click();
    await expect(row(page, "big")).toBeVisible();
    await expect(row(page, "sub")).toHaveCount(0);

    // 主进程只认下标：越界、过期、绝对路径当根、`..` 越界都被拒绝。
    const outcomes = await page.evaluate(async (id) => {
      const attempt = async (run: () => Promise<unknown>) =>
        run().then(
          () => "ok",
          () => "rejected",
        );
      return {
        okRoot: await attempt(() => globalThis.studio.listDirectory({ kind: "task", taskId: id, root: 1 }, "")),
        staleRoot: await attempt(() => globalThis.studio.listDirectory({ kind: "task", taskId: id, root: 2 }, "")),
        absoluteRoot: await attempt(() =>
          globalThis.studio.listDirectory({ kind: "task", taskId: id, root: "C:\\" } as never, ""),
        ),
        dotdot: await attempt(() => globalThis.studio.listDirectory({ kind: "task", taskId: id, root: 1 }, "..")),
        preview: await attempt(() =>
          globalThis.studio.readPreviewFile({ kind: "task", taskId: id, root: 1 }, "..\\项目 目录\\notes.md"),
        ),
        open: await attempt(() => globalThis.studio.openTaskFile(id, "额外 笔记.md", 2)),
      };
    }, taskId);
    expect(outcomes).toEqual({
      okRoot: "ok",
      staleRoot: "rejected",
      absoluteRoot: "rejected",
      dotdot: "rejected",
      preview: "rejected",
      open: "rejected",
    });

    // 移除：根消失，树回任务目录。
    await page.getByTestId("workspace-root-remove-1").click();
    await expect(page.getByTestId("workspace-root-1")).toHaveCount(0);
    await expect(row(page, "big")).toBeVisible();
    await expect(page.getByTestId("workspace-root-0")).toHaveCount(0);

    // omp 收到的是整行路径、没有引号（实测引号会被当成路径的一部分）。
    const sent = (await readFile(inputLog, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { kind?: string; body?: { ev?: string; text?: string } })
      .filter((record) => record.kind === "tsp" && record.body?.ev === "send")
      .map((record) => record.body?.text);
    expect(sent).toEqual([`/add-dir ${extra}`, `/remove-dir ${extra}`]);
  } finally {
    await cleanup();
  }
});
