// 侧栏文件区和右侧预览面板的端到端（spec §4.5「文件区」、§4.27）：文件区默认展开、跟着当前任务换项目，标题行 / Ctrl Shift E 收起展开，
// 分隔线拖动后存进外壳状态；文件树懒加载、展开、键盘操作、文件行的 @；点文件在右侧预览面板开标签（最多 5 个，挤掉最久没看的）；
// 一层 1500 项只画眼前的行，越界的 listDirectory 被拒绝；工作区目录（/add-dir）：额外根的添加、浏览、预览、移除、越界拒绝。
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { TaskId } from "../../src/shared/ipc.ts";
import {
  expandSidebarFolders,
  launchApp,
  lockClipboard,
  openTaskRow,
  setLocale,
  testOmp,
  type LaunchedApp,
} from "./launch.ts";
import { installFileMenuProbe } from "./file-menu-probe.ts";

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
  const extraFile = path.join(extra, "额外 笔记.md");
  await writeFile(extraFile, "# 额外目录里的笔记\n");
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
          ...(first
            ? [
                [
                  "add",
                  "extra-link",
                  "main",
                  null,
                  {
                    id: "extra-link",
                    k: "text",
                    p: { spans: [{ t: "打开额外目录文档", href: pathToFileURL(extraFile).href }] },
                  },
                ],
              ]
            : []),
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
  await setLocale(page, "zh-CN");
  await page.evaluate(async () => {
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

test("侧栏文件树右键可复制完整路径和定位文件或目录，不触发预览或展开", async () => {
  const { launched, taskId, cleanup } = await start();
  try {
    const { page } = launched;
    const probe = await installFileMenuProbe(launched.app);
    const cwd = await page.evaluate(
      async (id) => (await globalThis.studio.listTasks()).find((task) => task.id === id)!.cwd,
      taskId,
    );
    await expect(row(page, "notes.md")).toBeVisible();
    const unlock = await lockClipboard();
    const previous = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
    try {
      await launched.app.evaluate(({ clipboard }) => clipboard.writeText("file-menu-probe"));
      for (const file of ["notes.md", "src"]) {
        await row(page, file).click({ button: "right" });
        await expect
          .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe(path.join(cwd, file));
      }
    } finally {
      await launched.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previous);
      await unlock();
    }
    expect((await probe.labels())[0]).toEqual(["复制路径", "在文件管理器中打开"]);
    await expect(page.getByTestId("file-preview")).toHaveCount(0);
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "false");
    await probe.nextAction("reveal");
    await row(page, "notes.md").click({ button: "right" });
    await row(page, "src").click({ button: "right" });
    await expect.poll(probe.revealed).toEqual([path.join(cwd, "notes.md"), path.join(cwd, "src")]);
    await setLocale(page, "en");
    await row(page, "notes.md").click({ button: "right" });
    await expect.poll(async () => (await probe.labels()).at(-1)).toEqual(["Copy path", "Show in file manager"]);
  } finally {
    await cleanup();
  }
});

test("侧栏文件区：默认展开当前任务项目的文件，目录在前、不列 .git；点文件在右侧预览、焦点留在树里；收起展开记住状态", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const pane = page.getByTestId("file-preview");
    const files = page.getByTestId("sidebar-files");
    await expect(page.getByTestId("topbar-files")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-files-toggle")).toContainText("项目 目录");

    // 根目录：目录（big docs src）在前、文件（notes.md Zeta.txt）在后，按名排序；.git 不出现。
    const paths = files.locator("[data-testid=file-tree-row]");
    await expect(paths.first()).toBeVisible();
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
    // 图标按类型：src 是专属文件夹图（展开换 -open），.ts / .md 各有自己的图，而且真的加载出来了（CSP、打包路径都对）。
    const icon = (rel: string) => row(page, rel).locator(".file-type-icon");
    await expect(icon("src")).toHaveAttribute("data-icon", "folder-src-open");
    await expect(icon("docs")).toHaveAttribute("data-icon", "folder-docs");
    await expect(icon("big")).toHaveAttribute("data-icon", "folder");
    await expect(icon("src/alpha.ts")).toHaveAttribute("data-icon", "typescript");
    await expect(icon("notes.md")).toHaveAttribute("data-icon", "markdown");
    await expect
      .poll(() => icon("src/alpha.ts").evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth))
      .toBeGreaterThan(0);

    // 点文件：右侧打开预览，渲染 Markdown；焦点留在树里，行高亮。
    await row(page, "notes.md").click();
    await expect(pane).toBeVisible();
    await expect(page.getByTestId("file-preview-name")).toHaveText("notes.md");
    await expect(page.getByTestId("file-preview-md")).toContainText("第一项");
    await expect(page.getByTestId("file-tree")).toBeFocused();
    await expect(row(page, "notes.md")).toHaveAttribute("aria-selected", "true");

    // Ctrl Shift E 收起文件区（预览不受影响），再按展开：展开状态还在，焦点进树。
    await page.keyboard.press("Control+Shift+E");
    await expect(page.getByTestId("file-tree")).toHaveCount(0);
    await expect(files).toBeVisible();
    await expect(pane).toBeVisible();
    await page.keyboard.press("Control+Shift+E");
    await expect(row(page, "src/alpha.ts")).toBeVisible();
    await expect(page.getByTestId("file-tree")).toBeFocused();
    // 标题行同样能收起。
    await page.getByTestId("sidebar-files-toggle").click();
    await expect(page.getByTestId("file-tree")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-files-toggle")).toHaveAttribute("aria-expanded", "false");
  } finally {
    await cleanup();
  }
});

test("键盘：Ctrl Shift E 收起 / 展开文件区（展开时焦点进树），↑↓ 移动，→ 展开 / 进入子项，← 收起 / 回父目录，Enter 打开文件，Esc 关预览", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const pane = page.getByTestId("file-preview");
    const tree = page.getByTestId("file-tree");
    // 默认展开：第一次收起，第二次展开并把焦点放进树。
    await page.keyboard.press("Control+Shift+E");
    await expect(tree).toHaveCount(0);
    await page.keyboard.press("Control+Shift+E");
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
    // Enter 在文件上：右侧打开预览，焦点留在树里。
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(pane).toBeVisible();
    await expect(page.getByTestId("file-preview-name")).toHaveText("Zeta.txt");
    await expect(page.getByTestId("file-preview-body")).toContainText("zeta");
    await expect(tree).toBeFocused();

    // 树里 Esc 关上预览。
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await expect(tree).toBeFocused();
  } finally {
    await cleanup();
  }
});

test("文件行的 @ 把 `@路径` 插到输入框光标处：悬停按钮、树里按 @ 键；目录没有；额外目录里的用带引号的绝对路径", async () => {
  const { launched, extra, cleanup } = await start({ dirs: true });
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await input.fill("看看");
    await row(page, "src").click();

    // 悬停文件行出现 @，提示是按钮自己的（不是外层行的路径）；点了插到光标处（前面补空格），焦点回到输入框，不打开预览。
    const tip = page.getByTestId("tooltip");
    await row(page, "src/alpha.ts").hover();
    await expect(tip).toContainText("src/alpha.ts");
    await row(page, "src/alpha.ts").getByTestId("file-tree-mention").hover();
    await expect(tip).toContainText("插入到输入框");
    await row(page, "src/alpha.ts").locator(".file-tree-name").hover();
    await expect(tip).toContainText("src/alpha.ts");
    await row(page, "src/alpha.ts").getByTestId("file-tree-mention").click();
    await expect(input).toHaveValue("看看 @src/alpha.ts ");
    await expect(input).toBeFocused();
    await expect(page.getByTestId("file-preview")).toHaveCount(0);
    await expect(row(page, "src").getByTestId("file-tree-mention")).toHaveCount(0);

    // 键盘：树里光标停在文件上按 @。
    await page.getByTestId("file-tree").focus();
    await page.keyboard.press("End");
    await expect(row(page, "Zeta.txt")).toHaveAttribute("data-cursor", "true");
    await page.keyboard.press("@");
    await expect(input).toHaveValue("看看 @src/alpha.ts @Zeta.txt ");

    // 额外工作区目录：不在 omp 的 cwd 里，用绝对路径；带空格加引号。
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, extra);
    await page.getByTestId("workspace-add-dir").click();
    await expect(row(page, "额外 笔记.md")).toBeVisible();
    await row(page, "额外 笔记.md").hover();
    await row(page, "额外 笔记.md").getByTestId("file-tree-mention").click();
    await expect(input).toHaveValue(`看看 @src/alpha.ts @Zeta.txt @"${extra.replaceAll("\\", "/")}/额外 笔记.md" `);
    // 是输入框自己的编辑：Ctrl Z 撤回这一次插入。
    await page.keyboard.press("Control+z");
    await expect(input).toHaveValue("看看 @src/alpha.ts @Zeta.txt ");
  } finally {
    await cleanup();
  }
});

test("一层上千项：只渲染眼前的行，滚到底能看到最后一项；越界的 listDirectory 被拒绝", async () => {
  const { launched, taskId, cleanup } = await start();
  try {
    const { page } = launched;
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

test("默认文件夹里的新任务草稿也有文件区：目录还没建时为空，建好后刷新能看到文件，`@` 补全在那里也能用", async () => {
  const launched = await launchApp();
  try {
    const { page, userDataDir } = launched;
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    const chats = path.join(userDataDir, "chats");
    const files = page.getByTestId("sidebar-files");
    const pane = page.getByTestId("file-preview");
    await expect(page.getByTestId("file-tree")).toBeVisible();
    await expect(page.locator("[data-testid=file-tree-row]")).toHaveCount(0);
    await expect(files.locator(".file-preview-note")).toBeVisible();
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
    const probe = await installFileMenuProbe(launched.app);
    await page.getByRole("link", { name: "打开额外目录文档" }).click();
    await expect(page.getByTestId("file-preview-md")).toContainText("额外目录里的笔记");
    await page.getByTestId("file-preview-open").click();
    await expect.poll(probe.opened).toEqual([path.join(extra, "额外 笔记.md")]);
    await page.getByTestId("file-preview-reveal").click();
    await expect.poll(probe.revealed).toEqual([path.join(extra, "额外 笔记.md")]);

    // 切回任务目录：原来的树。
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

test("文件区跟着当前任务换项目；分隔线拖动后存进外壳状态、双击回默认；侧栏收起或窄窗口时 Ctrl Shift E 先展开侧栏、焦点进树", async () => {
  const { launched, cleanup } = await start();
  const other = await mkdtemp(path.join(os.tmpdir(), "omp 另一个项目-"));
  try {
    const { page, app } = launched;
    await writeFile(path.join(other, "另一个.md"), "# 另一个\n");
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, other);
    await page.evaluate(async () => {
      const added = await globalThis.studio.addProject();
      if (!added) throw new Error("addProject 没有返回项目");
      await globalThis.studio.createTask({ projectId: added.id });
      await globalThis.studio.createTask({ projectId: added.id });
    });
    await expect(row(page, "notes.md")).toBeVisible();
    await expandSidebarFolders(page);
    await page
      .locator(".sb-folder", { hasText: "omp 另一个项目" })
      .getByTestId("task-row")
      .first()
      .locator(".sb-row-main")
      .click();
    await expect(row(page, "另一个.md")).toBeVisible();
    await expect(row(page, "notes.md")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-files-toggle")).toContainText("omp 另一个项目");

    // 同一个文件夹里换任务：树不重挂（同一个 DOM 节点、行一直在），不会先空一下再画出来。
    await page.getByTestId("file-tree").evaluate((el) => Reflect.set(el, "__mark", true));
    const before = await page.locator("[data-testid=task-tab][data-active]").getAttribute("data-task-id");
    await page
      .locator(".sb-folder", { hasText: "omp 另一个项目" })
      .getByTestId("task-row")
      .nth(1)
      .locator(".sb-row-main")
      .click();
    await expect(page.locator("[data-testid=task-tab][data-active]")).not.toHaveAttribute("data-task-id", before!);
    expect(await page.getByTestId("file-tree").evaluate((el) => Reflect.get(el, "__mark"))).toBe(true);
    await expect(row(page, "另一个.md")).toBeVisible();

    // 分隔线往上拖 = 文件区变高；松手时存一次。双击回默认（null）。
    const resizer = page.getByTestId("sidebar-files-resizer");
    const box = (await resizer.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await page.evaluate(() => globalThis.studio.getShellState())).sidebarFilesShare ?? 0)
      .toBeGreaterThan(55);
    await resizer.dblclick();
    await expect
      .poll(async () => (await page.evaluate(() => globalThis.studio.getShellState())).sidebarFilesShare)
      .toBeNull();

    // 侧栏收起：Ctrl Shift E 展开侧栏，焦点进树。
    const root = page.getByTestId("app-root");
    await page.keyboard.press("Control+b");
    await expect(root).toHaveAttribute("data-sidebar", "hidden");
    await page.keyboard.press("Control+Shift+E");
    await expect(root).toHaveAttribute("data-sidebar", "shown");
    await expect(page.getByTestId("file-tree")).toBeFocused();

    // 窄窗口：侧栏是抽屉，Ctrl Shift E 打开抽屉；在抽屉里点文件，抽屉收起、预览出现。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 700));
    await expect(root).toHaveAttribute("data-drawer", "true");
    await expect(root).toHaveAttribute("data-sidebar", "hidden");
    await page.keyboard.press("Control+Shift+E");
    await expect(root).toHaveAttribute("data-sidebar", "shown");
    await expect(page.getByTestId("file-tree")).toBeFocused();
    await row(page, "另一个.md").click();
    await expect(root).toHaveAttribute("data-sidebar", "hidden");
    await expect(page.getByTestId("file-preview-md")).toContainText("另一个");
  } finally {
    await cleanup();
    await rm(other, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test("预览标签：开过的文件各占一个标签，再点同一个切过去；× 关当前换到右边那个；最多 5 个，挤掉最久没看的；关上面板标签还在", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const tabs = page.getByTestId("preview-tab");
    const names = () =>
      tabs.evaluateAll((els) => els.map((el) => (el as unknown as { textContent: string }).textContent));
    const active = page.locator('[data-testid=preview-tab] [role=tab][aria-selected="true"]');
    await row(page, "notes.md").click();
    await row(page, "Zeta.txt").click();
    await row(page, "docs").click();
    await row(page, "docs/guide.md").click();
    await expect(tabs).toHaveCount(3);
    expect(await names()).toEqual(["notes.md", "Zeta.txt", "guide.md"]);
    await expect(active).toHaveText("guide.md");
    await expect(page.getByTestId("file-preview-md")).toContainText("指南");

    // 再点树里开过的文件：不新开，切过去。点标签同样切换。
    await row(page, "notes.md").click();
    await expect(tabs).toHaveCount(3);
    await expect(active).toHaveText("notes.md");
    await tabs.filter({ hasText: "Zeta.txt" }).getByRole("tab").click();
    await expect(page.getByTestId("file-preview-body")).toContainText("zeta");

    // × 关掉当前（Zeta.txt，在中间）：换到右边的 guide.md。
    await tabs.filter({ hasText: "Zeta.txt" }).getByTestId("preview-tab-close").click();
    expect(await names()).toEqual(["notes.md", "guide.md"]);
    await expect(active).toHaveText("guide.md");

    // 看过的顺序：guide.md（刚切到）> notes.md。再开 4 个：第 6 个挤掉最久没看的 notes.md。
    await row(page, "big").click();
    for (const n of [0, 1, 2, 3]) await row(page, `big/file-${n}.txt`).click();
    await expect(tabs).toHaveCount(5);
    expect(await names()).toEqual(["guide.md", "file-0.txt", "file-1.txt", "file-2.txt", "file-3.txt"]);
    // 面板缩到最窄：标签收窄后仍放不下，滚轮（竖着滚）把标签条横向滚到最后一个。
    await page.locator(".file-preview-resizer").focus();
    for (let i = 0; i < 40; i += 1) await page.keyboard.press("ArrowRight");
    const strip = page.getByTestId("preview-tabs");
    const scrollLeft = () => strip.evaluate((el) => (el as unknown as { scrollLeft: number }).scrollLeft);
    await tabs.first().getByRole("tab").click();
    await expect.poll(scrollLeft).toBe(0);
    const box = (await strip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // 触控板 / 高精度滚轮竖着滑时 deltaX 也带一点：照样横向滚。
    await page.mouse.wheel(2, 400);
    await expect.poll(scrollLeft).toBeGreaterThan(50);
    await expect(tabs.last()).toBeInViewport({ ratio: 1 });

    // 关上面板再打开一个文件：原来的标签都在。
    await page.getByTestId("file-preview-close").click();
    await expect(page.getByTestId("file-preview")).toHaveCount(0);
    await row(page, "big/file-0.txt").click();
    await expect(tabs).toHaveCount(5);
    await expect(active).toHaveText("file-0.txt");

    // 键盘：标签上 ← → 换，Delete 关。
    await active.focus();
    await page.keyboard.press("ArrowRight");
    await expect(active).toHaveText("file-1.txt");
    await expect(active).toBeFocused();
    await page.keyboard.press("Delete");
    await expect(tabs).toHaveCount(4);
    await expect(active).toHaveText("file-2.txt");
  } finally {
    await cleanup();
  }
});

interface SlideFrame {
  /** 输入框左边和宽度（居中在主区里，主区逐帧变宽变窄时跟着走）。 */
  left: number;
  width: number;
  /** 主区宽度。 */
  main: number;
  /** 右栏宽度；右栏不在时 null。 */
  pane: number | null;
  /** 页面横向滚动。 */
  scrolled: number;
  /** 主区右边缘到右栏左边缘的缝；右栏不在时 null。 */
  seam: number | null;
}

// 一帧帧记 800ms（右栏动画 500ms）。
async function slideFrames(page: Page): Promise<SlideFrame[]> {
  return page.evaluate(`new Promise((resolve) => {
    const frames = [];
    const t0 = performance.now();
    const tick = () => {
      const main = document.querySelector('[data-testid="main-panel"]').getBoundingClientRect();
      const pane = document.querySelector('[data-testid="file-preview"]')?.getBoundingClientRect();
      const composer = document.querySelector(".composer-stack").getBoundingClientRect();
      frames.push({
        left: composer.left,
        width: composer.width,
        main: main.width,
        pane: pane ? pane.width : null,
        scrolled: document.scrollingElement.scrollLeft + document.body.scrollLeft,
        seam: pane ? pane.left - main.right : null,
      });
      if (performance.now() - t0 < 800) requestAnimationFrame(tick);
      else resolve(frames);
    };
    requestAnimationFrame(tick);
  })`);
}

test("右栏开关像并排的两页：主区逐帧跟着变窄变宽，右栏滑进来时和主区之间的缝合上、停靠后贴成一张（主区右边两角变直），右栏自己不变宽；页面不被横向滚走", async () => {
  // dirs 的回放录制会把收到的事件记进 inputLog（数 resize 用）
  const { launched, inputLog, cleanup } = await start({ dirs: true });
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 1400, height: 800 });
    const composer = page.locator(".composer-stack");
    const mainPanel = page.getByTestId("main-panel");
    await expect.poll(async () => (await composer.boundingBox())?.x).toBeGreaterThan(0);
    const wideBox = (await composer.boundingBox())!;
    const wideMain = (await mainPanel.boundingBox())!.width;
    const mid = (frame: { left: number; width: number }) => frame.left + frame.width / 2;
    const wideMid = wideBox.x + wideBox.width / 2;
    const seams = (frames: SlideFrame[]) => frames.flatMap((frame) => (frame.seam === null ? [] : [frame.seam]));
    // 开合期间主区逐帧变宽变窄，但只在放完后给 omp 发一次 resize（逐帧发 omp 会每帧整篇重排、换掉节点）。
    // 记帧的 800ms 已盖过 500ms 的动画：逐帧发的话这时日志里早有十几条。
    const resizes = async () =>
      (await readFile(inputLog, "utf8")).split("\n").filter((line) => line.includes('"ev":"resize"')).length;
    const before = await resizes();
    // 开：主区一帧帧变窄（有介于两头之间的帧，不是一下跳过去），输入框的中心跟着往左走，整页从不横向滚动。
    await row(page, "notes.md").click();
    const opening = await slideFrames(page);
    const narrowMain = opening.at(-1)!.main;
    const narrowMid = mid(opening.at(-1)!);
    expect(narrowMain).toBeLessThan(wideMain - 100);
    expect(narrowMid).toBeLessThan(wideMid - 50);
    expect(opening.every((frame) => frame.scrolled === 0)).toBe(true);
    expect(
      opening.filter((frame) => frame.main > narrowMain + 20 && frame.main < wideMain - 20).length,
    ).toBeGreaterThan(2);
    expect(opening.every((frame) => mid(frame) >= narrowMid - 1 && mid(frame) <= wideMid + 1)).toBe(true);
    const opened = await resizes();
    expect(opened - before).toBeLessThanOrEqual(1);
    // 滑进来的过程中主区和右栏之间的缝逐帧合上（不会变宽），停靠后右栏压住主区右边线 1px，两张纸贴成一张（所有者定，2026-11-26）；
    // 右栏宽度从头到尾不变（滑进来的是整块，里面不重排）。
    const openSeams = seams(opening);
    expect(openSeams.at(-1)!).toBeCloseTo(-1, 0);
    for (let i = 1; i < openSeams.length; i += 1) expect(openSeams[i]!).toBeLessThanOrEqual(openSeams[i - 1]! + 0.5);
    const radius = (testId: string, corner: "top-right" | "top-left") =>
      page.getByTestId(testId).evaluate((el, c) => getComputedStyle(el).getPropertyValue(`border-${c}-radius`), corner);
    await expect.poll(() => radius("main-panel", "top-right")).toBe("0px");
    expect(await radius("file-preview", "top-left")).toBe("0px");
    const paneWidth = opening.at(-1)!.pane!;
    for (const frame of opening) if (frame.pane !== null) expect(frame.pane).toBeCloseTo(paneWidth, 0);
    // 关：同样逐帧变宽，缝逐帧张开（原路退回），主区右边两角变回圆的，最后回到原来的宽度和位置。
    await page.getByTestId("file-preview-close").click();
    const closing = await slideFrames(page);
    const closeSeams = seams(closing);
    expect(closeSeams.length).toBeGreaterThan(3);
    for (let i = 1; i < closeSeams.length; i += 1)
      expect(closeSeams[i]!).toBeGreaterThanOrEqual(closeSeams[i - 1]! - 0.5);
    await expect.poll(() => radius("main-panel", "top-right")).not.toBe("0px");
    expect(
      closing.filter((frame) => frame.main > narrowMain + 20 && frame.main < wideMain - 20).length,
    ).toBeGreaterThan(2);
    expect(closing.every((frame) => mid(frame) >= narrowMid - 1 && mid(frame) <= wideMid + 1)).toBe(true);
    expect(closing.at(-1)!.main).toBeCloseTo(wideMain, 0);
    expect(mid(closing.at(-1)!)).toBeCloseTo(wideMid, 0);
    expect((await resizes()) - opened).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("file-preview")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
