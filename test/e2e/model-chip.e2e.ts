// 草稿输入框的模型胶囊在项目之间切换：逐帧记录胶囊文本和宽度，不许闪变、空白、宽度跳动；配了档位的模型要在档位刻度上显示这一档。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR：一个 auth: none 的本地 provider 提供三个支持思考的模型，
// 三个项目分别用 .omp/config.yml 指定不同的 modelRoles.default / defaultThinkingLevel，第三个什么都不配（用全局的）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { readRecording, startRecording, type Frame } from "./chip-frames.ts";
import { launchApp, setLocale, setLocaleTheme } from "./launch.ts";

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
  "        name: Chip A",
  "        reasoning: true",
  "      - id: chip-b",
  "        name: Chip Beta Longer Name",
  "        reasoning: true",
  "",
].join("\n");

const modelLoadingText = "模型…";

/** 模型名 + 档位，和 chip-frames.ts 记录的写法一样（"Chip A·high"）。 */
const chipText = async (page: Page) => {
  const name = await page.getByTestId("model-chip").innerText();
  const effort = page.getByTestId("chip-thinking");
  const level = (await effort.count()) > 0 ? await effort.getAttribute("data-level") : null;
  return level === null ? name : `${name}·${level}`;
};

/** 模型胶囊的排版量（像素）：基线、大写字母中心、刻度中心和底边、两端内边距、审批胶囊的内边距、名字按钮里文字右边的多余空白。 */
const measureChipLayout = (page: Page) =>
  page.evaluate(() => {
    interface Box {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
    }
    interface El {
      style: { cssText: string };
      lastElementChild: El | null;
      append(child: El): void;
      remove(): void;
      querySelector(selector: string): El | null;
      getBoundingClientRect(): Box;
    }
    interface Canvas {
      getContext(kind: "2d"): { font: string; measureText(s: string): { actualBoundingBoxAscent: number } };
    }
    const dom = globalThis as unknown as {
      document: {
        querySelector(selector: string): El | null;
        createElement(tag: "span"): El;
        createElement(tag: "canvas"): Canvas;
        createRange(): { selectNodeContents(node: El): void; getBoundingClientRect(): Box };
      };
      getComputedStyle(el: El): { fontWeight: string; fontSize: string; fontFamily: string };
    };
    const need = (el: El | null): El => {
      if (!el) throw new Error("缺少元素");
      return el;
    };
    const text = need(dom.document.querySelector("[data-testid='model-chip-group'] .chip-text"));
    const name = need(dom.document.querySelector("[data-testid='model-chip']"));
    const effort = need(dom.document.querySelector("[data-testid='chip-thinking']"));
    const bars = need(effort.querySelector(".effort-bars"));
    const approval = need(dom.document.querySelector("[data-testid='approval-chip']"));
    // 基线：文字里放一个 0×0 的 inline-block，它的底边就在基线上。
    const probe = dom.document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0";
    text.append(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    const style = dom.getComputedStyle(text);
    const ctx = dom.document.createElement("canvas").getContext("2d");
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const capHeight = ctx.measureText("H").actualBoundingBoxAscent;
    const range = dom.document.createRange();
    range.selectNodeContents(text);
    const textRect = range.getBoundingClientRect();
    const approvalIcon = need(approval.querySelector("svg")).getBoundingClientRect();
    const approvalLast = need(approval.lastElementChild).getBoundingClientRect();
    const barsRect = bars.getBoundingClientRect();
    const nameRect = name.getBoundingClientRect();
    const approvalRect = approval.getBoundingClientRect();
    return {
      baseline,
      capCenter: baseline - capHeight / 2,
      barsCenter: (barsRect.top + barsRect.bottom) / 2,
      barsBottom: barsRect.bottom,
      padLeft: textRect.left - nameRect.left,
      padRight: effort.getBoundingClientRect().right - barsRect.right,
      approvalPadLeft: approvalIcon.left - approvalRect.left,
      approvalPadRight: approvalRect.right - approvalLast.right,
      nameSlack: nameRect.width - (textRect.left - nameRect.left) - textRect.width - 4,
    };
  });

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
    { dir: path.join(work, "项目 甲"), model: "Chip A", level: "high" },
    { dir: path.join(work, "项目 乙"), model: "Chip Beta Longer Name", level: "low" },
    { dir: path.join(work, "项目 丙"), model: "Chip Global", level: "medium" },
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
    await setLocale(page, "zh-CN");
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
    // 默认模型读到后，草稿的上下文圆环是可点的 0%（窗口取默认模型的），不再是占位。
    await expect(page.getByTestId("draft-composer").getByTestId("context-meter")).toHaveAttribute("aria-label", /0%/);
    // 第二阶段：每个项目都读过了，来回切换。第一帧就是这个项目的最终值，不许有占位，也不许出现别的项目的值。
    const first = await readRecording(page);
    await startRecording(page);
    const order = [1, 2, 0, 1, 2, 0, 2, 1, 0];
    const litBars: number[] = [];
    const finals = projects.map((project) => `${project.model}·${project.level}`);
    for (const index of order) {
      await pick(index);
      // 相邻两次选的项目不同，胶囊文字一定要变：等到这个项目的最终值。
      await expect.poll(() => chipText(page), `项目 ${index}`).toBe(finals[index]);
      litBars[index] = await page.getByTestId("chip-thinking").locator(".effort-bar[data-lit]").count();
    }
    const revisits = await readRecording(page);
    // 档位刻度亮的格数随档位升：low < medium < high。
    expect(litBars[1]).toBeGreaterThan(0);
    expect(litBars[2]).toBeGreaterThan(litBars[1]!);
    expect(litBars[0]).toBeGreaterThan(litBars[2]!);

    // 第一阶段（添加三个项目，每个都是第一次读）：只许出现占位和最终值，不许出现"全局的模型配这个项目的强度"这类混合。
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

    // 胶囊内部排版（中英文 × 深浅主题）。选第一个项目：模型名 "Chip A" 比名字最小宽（9ch）还短。
    await pick(0);
    await expect(page.getByTestId("chip-thinking")).toBeVisible();
    await expect.poll(() => chipText(page)).toBe("Chip A·high");
    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await setLocaleTheme(page, locale, theme);
        const m = await measureChipLayout(page);
        const label = `${locale}/${theme} ${JSON.stringify(m)}`;
        // 刻度和模型名对齐：刻度中心 = 名字大写字母的垂直中心（±1px），刻度底边 = 名字的基线（±1px）。
        expect(Math.abs(m.barsCenter - m.capCenter), `刻度和文字垂直中心 ${label}`).toBeLessThanOrEqual(1);
        expect(Math.abs(m.barsBottom - m.baseline), `刻度底边和文字基线 ${label}`).toBeLessThanOrEqual(1);
        // 胶囊左右内边距相等，且和审批胶囊一致。
        expect(Math.abs(m.padLeft - m.padRight), `胶囊左右内边距 ${label}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(m.padLeft - m.approvalPadLeft), `和审批胶囊左内边距 ${label}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(m.padRight - m.approvalPadRight), `和审批胶囊右内边距 ${label}`).toBeLessThanOrEqual(0.5);
        // 短名字不被撑宽：名字按钮 = 文字 + 左内边距 + 和刻度之间的 4px。
        expect(m.nameSlack, `短名字右边的多余空白 ${label}`).toBeLessThanOrEqual(1);
      }
    }
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
