// 草稿输入框的模型胶囊在项目之间切换：逐帧记录胶囊文本和宽度，不许闪变、空白、宽度跳动；配了档位的模型要显示"· 高"之类的强度。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR：一个 auth: none 的本地 provider 提供三个支持思考的模型，
// 三个项目分别用 .omp/config.yml 指定不同的 modelRoles.default / defaultThinkingLevel，第三个什么都不配（用全局的）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { readRecording, startRecording, type Frame } from "./chip-frames.ts";
import { launchApp } from "./launch.ts";

const modelsYml = [
  "providers:",
  "  chip-local:",
  "    baseUrl: http://127.0.0.1:9/v1",
  "    auth: none",
  "    api: openai-completions",
  "    models:",
  "      - id: chip-global",
  "        name: Chip Global",
  "        reasoning: true",
  "      - id: chip-a",
  "        name: Chip Alpha",
  "        reasoning: true",
  "      - id: chip-b",
  "        name: Chip Beta Longer Name",
  "        reasoning: true",
  "",
].join("\n");

const modelLoadingText = "模型…";

const chipText = (page: Page) => page.getByTestId("model-chip").innerText();

test("切换项目：模型胶囊逐帧无闪变、无空白，档位随项目显示", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp-studio-chip-"));
  const agentDir = path.join(work, "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "models.yml"), modelsYml, "utf8");
  await writeFile(
    path.join(agentDir, "config.yml"),
    "modelRoles:\n  default: chip-local/chip-global\ndefaultThinkingLevel: medium\n",
    "utf8",
  );
  const projects: { dir: string; model: string; level: string }[] = [
    { dir: path.join(work, "项目 甲"), model: "Chip Alpha", level: "高" },
    { dir: path.join(work, "项目 乙"), model: "Chip Beta Longer Name", level: "低" },
    { dir: path.join(work, "项目 丙"), model: "Chip Global", level: "中" },
  ];
  const configs = [
    "modelRoles:\n  default: chip-local/chip-a\ndefaultThinkingLevel: high\n",
    "modelRoles:\n  default: chip-local/chip-b\ndefaultThinkingLevel: low\n",
    null,
  ];
  for (const [index, project] of projects.entries()) {
    await mkdir(path.join(project.dir, ".omp"), { recursive: true });
    const config = configs[index];
    if (config) await writeFile(path.join(project.dir, ".omp", "config.yml"), config, "utf8");
  }
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await page.evaluate(() => globalThis.studio.setLocale("zh-CN"));
    await page.setViewportSize({ width: 1200, height: 900 });
    await startRecording(page);
    for (const project of projects) {
      await launched.app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      }, project.dir);
      await page.getByTestId("sidebar-open-folder").click();
      await expect(page.getByTestId("sidebar-project-new")).toHaveCount(projects.indexOf(project) + 1);
    }
    // 侧栏的文件夹按添加顺序或最近使用排序：按文件夹标题找 ＋。
    const pick = async (index: number) => {
      const folder = page.getByTestId("sidebar-folder").filter({ hasText: path.basename(projects[index]!.dir) });
      await folder.hover();
      await folder.getByTestId("sidebar-project-new").click();
    };

    await expect.poll(() => chipText(page), { timeout: 30_000 }).toContain(projects[2]!.model);
    // 第二阶段：每个项目都读过了，来回切换。第一帧就是这个项目的最终值，不许有占位，也不许出现别的项目的值。
    const first = await readRecording(page);
    await startRecording(page);
    const order = [1, 2, 0, 1, 2, 0, 2, 1, 0];
    for (const index of order) {
      await pick(index);
      await page.waitForTimeout(1200);
      const text = await chipText(page);
      expect(text, `项目 ${index}`).toContain(projects[index]!.model);
      expect(text, `项目 ${index} 的思考强度`).toContain(projects[index]!.level);
    }
    const revisits = await readRecording(page);

    // 第一阶段（添加三个项目，每个都是第一次读）：只许出现占位和最终值，不许出现"全局的模型配这个项目的强度"这类混合。
    const finals = projects.map((project) => `${project.model}${project.level}`);
    const dedupe = (frames: Frame[]) =>
      frames.map((frame) => frame.text).filter((text, i, all) => i === 0 || text !== all[i - 1]);
    const seen = dedupe(first.frames);
    console.log(`第一阶段：${seen.join(" → ")}`);
    for (const text of seen) expect([modelLoadingText, ...finals], `第一阶段的帧：${text}`).toContain(text);
    expect(first.frames.every((frame) => frame.text !== "")).toBe(true);
    // 占位出现过之后不会再回到占位，也不会先显示别的项目的最终值再换：每个项目最多"占位 → 最终值"两帧。
    expect(seen.filter((text) => text === modelLoadingText).length).toBeLessThanOrEqual(projects.length);

    // 第二阶段：每次切换恰好一帧变化（宽度随模型名变），没有占位、没有空白、没有中间态。
    // 切到另一个项目但文本没变的帧（项目标签变了）不算。
    const texts = dedupe(revisits.frames);
    console.log(`第二阶段：${texts.join(" → ")}`);
    for (const text of texts) expect(finals, `第二阶段的帧：${text}`).toContain(text);
    const expected = order.map((index) => finals[index]!);
    const transitions = expected.filter((text, i) => text !== (i === 0 ? finals[2] : expected[i - 1]));
    expect(texts.slice(1)).toEqual(transitions);
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
