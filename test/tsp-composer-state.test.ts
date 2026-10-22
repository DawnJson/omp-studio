import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import {
  deriveComposerInfo,
  findComposerTargets,
  findPicker,
  parseContextMeter,
  parseCost,
  parseTokenCount,
  statusToastTexts,
} from "../src/shared/tsp/composer-state.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function replay(name: string) {
  const doc = createDocument();
  return tspDocMessages(loadTspFixture(name)).map(({ message }) => {
    applyMessage(doc, message);
    return {
      info: deriveComposerInfo(doc),
      targets: findComposerTargets(doc),
      picker: findPicker(doc),
      toasts: statusToastTexts(doc),
    };
  });
}

describe("composer 状态：omp 18.12.3 的录制逐帧", () => {
  it("task：composer 出现后一直有模型名、思考强度、上下文和费用；上下文随回合增长", () => {
    const steps = replay("task");
    expect(steps[0]?.info).toBeNull();
    const shown = steps.filter((step) => step.info !== null);
    expect(shown.length).toBeGreaterThan(100);
    for (const { info } of shown) {
      expect(info?.modelName).toBe("DeepSeek V4 Flash");
      expect(info?.effort).toBe("high");
      expect(info?.cost).toBe(0);
      expect(info?.context?.contextWindow).toBe(1_000_000);
    }
    const first = shown[0]?.info?.context;
    expect(first).toMatchObject({ tokens: 8_000, contextWindow: 1_000_000 });
    expect(first?.percent).toBeCloseTo(0.797, 6);
    const last = shown.at(-1)?.info?.context;
    expect(last?.tokens).toBeGreaterThan(8_000);
  });

  it("composer 的 action 目标：模型胶囊和思考强度节点在同一个 surface", () => {
    const targets = replay("task").find((step) => step.targets)?.targets;
    expect(targets?.sf).toBeTruthy();
    expect(targets?.model).toMatch(/model$/);
    expect(targets?.effort).toMatch(/model\/effort$/);
  });

  it("ask：提问替换 composer 的那几帧读不到（调用方保留上一次的值），回答后又出现", () => {
    const steps = replay("ask");
    const gone = steps.findIndex((step, index) => index > 10 && step.info === null);
    expect(gone).toBeGreaterThan(0);
    expect(steps.slice(gone).some((step) => step.info !== null)).toBe(true);
  });

  it("picker：layer 里的选择器带全部模型 id 和当前模型", () => {
    const picker = replay("picker").find((step) => step.picker)?.picker;
    expect(picker?.items.length).toBe(218);
    expect(picker?.items).toContain("deepseek/deepseek-v4-flash");
    expect(picker?.current).toEqual(["deepseek/deepseek-v4-flash"]);
  });

  it("状态 toast 的文字能读出来", () => {
    const toasts = replay("task").flatMap((step) => step.toasts);
    expect(toasts.some((text) => text.startsWith("xdev:"))).toBe(true);
  });
});

describe("解析函数", () => {
  it("parseTokenCount：K/M/B 后缀、千分位、无后缀；其他为 null", () => {
    expect(parseTokenCount("8.7K")).toBe(8_700);
    expect(parseTokenCount("1M")).toBe(1_000_000);
    expect(parseTokenCount("200k")).toBe(200_000);
    expect(parseTokenCount("1,234")).toBe(1_234);
    expect(parseTokenCount("lots")).toBeNull();
  });

  it("parseContextMeter：标题优先，窗口回退到 total，value 不是数为 null", () => {
    expect(
      parseContextMeter({
        value: 0.5,
        total: "200K",
        title: "Context 50% used\n100K of 200K tokens\nAuto-compact at 90%",
      }),
    ).toEqual({ percent: 50, tokens: 100_000, contextWindow: 200_000 });
    expect(parseContextMeter({ value: 0.1, total: "1M", title: "Context 10% used" })).toEqual({
      percent: 10,
      tokens: null,
      contextWindow: 1_000_000,
    });
    expect(parseContextMeter({ title: "x" })).toBeNull();
  });

  it("parseCost：取本会话花费，括号里的子代理增量不计；订阅登录时没有 $ 也能读", () => {
    expect(parseCost("$0.00 (+0.02) ↓")).toBe(0);
    expect(parseCost("Session cost $1,234.50 (+0.02) ↓")).toBe(1234.5);
    expect(parseCost("S0.44 (+0.10)")).toBe(0.44);
    expect(parseCost("\uf0e7 0.44 ★ 3")).toBe(0.44);
    expect(parseCost("(sub) (+0.12)")).toBe(0);
    expect(parseCost("(sub)")).toBe(0);
    expect(parseCost("no cost")).toBeNull();
  });
});

describe("快速模式图标", () => {
  it("模型名后面的闪电图标 span 不进模型名，只表示 /fast 开着", () => {
    const doc = createDocument();
    for (const { message } of tspDocMessages(loadTspFixture("task"))) {
      applyMessage(doc, message);
      if (deriveComposerInfo(doc)) break;
    }
    const targets = findComposerTargets(doc)!;
    const nameId = `${targets.model}/name`;
    expect(deriveComposerInfo(doc)?.fast).toBe(false);
    const spans = [
      { t: "Sonnet 5.5", s: "statusLineModel" },
      { t: "\uF0E7", s: "statusLineModel icon" },
    ];
    applyMessage(doc, { verb: "f", body: { sf: targets.sf, s: 9999, ops: [["set", nameId, { spans }]] } });
    expect(deriveComposerInfo(doc)).toMatchObject({ modelName: "Sonnet 5.5", fast: true });
  });
});
