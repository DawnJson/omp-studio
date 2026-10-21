// 会话开关的 omp 状态文字解析（omp 18.12.5 实录，native-ui-plan §2.1/§2.2；fixtures/tsp/status-toggles.jsonl 是切换段的回放）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { statusToastTexts } from "../src/shared/tsp/composer-state.ts";
import { parseTaskCommand, taskCommandText } from "../src/shared/omp-output/index.ts";
import {
  applyToggleObservation,
  emptySessionToggles,
  freshToasts,
  listModelPresets,
  parseToggleToast,
  presetNameUsable,
  presetRefUsable,
  toggleDefaults,
  toggleView,
} from "../src/shared/omp-output/toggles.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

describe("parseToggleToast（omp 18.12.5 实录原文）", () => {
  const recorded: [string, unknown][] = [
    ["Skill listing disabled for this session.", { name: "skillful", on: false }],
    ["Skill listing: on.", { name: "skillful", on: true }],
    ["Skill listing: on (session override; default from the skillful setting).", { name: "skillful", on: true }],
    ["Extended context enabled.", { name: "extendedContext", on: true }],
    ["Extended context is off.", { name: "extendedContext", on: false }],
    [
      "Computer use enabled for this session. Computer use: enabled · prelude: active · configured: display=active, maxWidth=3840, maxHeight=2400, backgroundFallback=takeover",
      { name: "computer", on: true },
    ],
    [
      "Computer use: disabled · prelude: inactive · configured: display=active, maxWidth=3840, maxHeight=2400, backgroundFallback=takeover",
      { name: "computer", on: false },
    ],
    ["Advisor enabled.", { name: "advisor", on: true }],
    ["Advisor is disabled.", { name: "advisor", on: false }],
    ["Browser mode: visible", { name: "browser", mode: "visible" }],
    ["Browser mode: headless", { name: "browser", mode: "headless" }],
    [
      "prewalk: Prewalk: target deepseek/deepseek-v4-flash already matches the active model and thinking level; nothing to switch.",
      {
        name: "prewalk",
        message:
          "Prewalk: target deepseek/deepseek-v4-flash already matches the active model and thinking level; nothing to switch.",
      },
    ],
    ["Fast mode is off.", { name: "fast", on: false }],
    ["Fast mode enabled.", { name: "fast", on: true }],
    ["Fast mode disabled.", { name: "fast", on: false }],
    ["Slow mode is off.", { name: "slow", on: false }],
    ["Slow mode on: flex tier.", { name: "slow", on: true }],
  ];
  it.each(recorded)("%s", (text, expected) => {
    expect(parseToggleToast(text)).toEqual(expected);
  });

  it.each([
    "Usage: /browser [headless|visible]",
    "Usage: /prewalk [restart|off]",
    "priority: The current model has no service-tier control for /fast to toggle.",
    "The current model has no slow mode: /slow uses the flex tier on OpenAI/Google models and low priority on Anthropic subscriptions.",
    "No model presets saved. Use /modelpreset save <name> to create one.",
    "Plugins reloaded.",
    "Security is disabled. Enable security.enabled before using /security.",
    "",
  ])("不是开关状态的原文返回 null：%s", (text) => {
    expect(parseToggleToast(text)).toBeNull();
  });
});

describe("applyToggleObservation / toggleView", () => {
  it("值没变时返回同一个对象；fast / slow 不进开关状态", () => {
    const start = emptySessionToggles();
    const on = applyToggleObservation(start, { name: "skillful", on: true });
    expect(on).toEqual({ ...start, skillful: true });
    expect(applyToggleObservation(on, { name: "skillful", on: true })).toBe(on);
    expect(applyToggleObservation(on, { name: "fast", on: true })).toBe(on);
    expect(applyToggleObservation(on, { name: "browser", mode: "headless" }).browser).toBe("headless");
  });

  it("本会话值优先；和配置默认值不同才有小圆点；没动过就是默认值", () => {
    expect(toggleView<boolean>(null, true)).toEqual({ value: true, session: false, differs: false });
    expect(toggleView(false, true)).toEqual({ value: false, session: true, differs: true });
    expect(toggleView(true, true)).toEqual({ value: true, session: true, differs: false });
    expect(toggleView(true, null)).toEqual({ value: true, session: true, differs: false });
  });

  it("配置默认值：browser.headless 换算成 visible / headless，读不到为 null", () => {
    const config: Record<string, unknown> = {
      skillful: true,
      extendedContext: false,
      "computer.enabled": false,
      "advisor.enabled": false,
      "browser.headless": true,
      "prewalk.enabled": false,
    };
    expect(toggleDefaults((key) => config[key])).toEqual({
      skillful: true,
      extendedContext: false,
      computer: false,
      advisor: false,
      browser: "headless",
      prewalk: false,
    });
    expect(toggleDefaults(() => undefined).browser).toBeNull();
  });
});

describe("freshToasts", () => {
  it("新增的尾部和同一位置文字变了的（节点复用）", () => {
    expect(freshToasts([], ["a"])).toEqual(["a"]);
    expect(freshToasts(["a"], ["a"])).toEqual([]);
    expect(freshToasts(["a"], ["b"])).toEqual(["b"]);
    expect(freshToasts(["a", "b"], ["a", "b", "c"])).toEqual(["c"]);
  });
});

describe("回放 fixtures/tsp/status-toggles.jsonl（切换段）", () => {
  it("逐帧读 toast：开关状态依次变成 omp 报告的值", () => {
    const doc = createDocument();
    let state = emptySessionToggles();
    let seen: string[] = [];
    const history: string[] = [];
    for (const { message } of tspDocMessages(loadTspFixture("status-toggles"))) {
      applyMessage(doc, message);
      const texts = statusToastTexts(doc);
      for (const text of freshToasts(seen, texts)) {
        const observation = parseToggleToast(text);
        if (observation !== null) {
          state = applyToggleObservation(state, observation);
          history.push(observation.name);
        }
      }
      seen = texts;
    }
    expect(history).toEqual(["skillful", "extendedContext", "computer", "advisor", "browser", "prewalk"]);
    expect(state).toMatchObject({
      skillful: false,
      extendedContext: true,
      computer: true,
      advisor: true,
      browser: "headless",
    });
    expect(state.prewalk).toMatch(/^Prewalk: target /);
  });

  it("菜单发的命令文本和录制里终端发给 omp 的 send 一致", () => {
    const sent = loadTspFixture("status-toggles")
      .filter((line) => line.dir === "in")
      .map((line) => line.body as { ev: string; text?: string })
      .filter((body) => body.ev === "send")
      .map((body) => body.text);
    const commands = [
      { kind: "toggle", name: "skillful", on: false },
      { kind: "toggle", name: "extendedContext", on: true },
      { kind: "toggle", name: "computer", on: true },
      { kind: "toggle", name: "advisor", on: true },
      { kind: "browserMode", mode: "headless" },
      { kind: "prewalk", op: "arm" },
    ];
    expect(commands.map((command) => taskCommandText(parseTaskCommand(command)))).toEqual(sent);
  });
});

describe("模型预设（配置项 modelPresets）", () => {
  it("列出名字、默认模型和思考强度；形状不对的项跳过", () => {
    const value = {
      deep: { modelRoles: { default: "anthropic/claude-opus:high", smol: "x/y" }, defaultThinkingLevel: "high" },
      cheap: { modelRoles: { default: "deepseek/deepseek-v4-flash" } },
      broken: 3,
      noRoles: {},
    };
    expect(listModelPresets(value)).toEqual([
      { name: "cheap", model: "deepseek/deepseek-v4-flash", thinkingLevel: null },
      { name: "deep", model: "anthropic/claude-opus:high", thinkingLevel: "high" },
      { name: "noRoles", model: null, thinkingLevel: null },
    ]);
    expect(listModelPresets(undefined)).toEqual([]);
    expect(listModelPresets([])).toEqual([]);
  });

  it("新预设名按 omp 的规则：字母开头，之后字母数字 _ -；已有预设的引用名允许单个空格", () => {
    expect(presetNameUsable("deep-1")).toBe(true);
    expect(presetNameUsable("my preset")).toBe(false);
    expect(presetNameUsable("")).toBe(false);
    expect(presetNameUsable("1fast")).toBe(false);
    expect(presetNameUsable("v1.2")).toBe(false);
    // omp 18.12.5 实测：switch / delete 的参数按空白切开再用单个空格拼回，单个空格的名字能用，连续空格 / 首尾空白不能。
    expect(presetRefUsable("my preset")).toBe(true);
    expect(presetRefUsable("a  b")).toBe(false);
    expect(presetRefUsable(" a")).toBe(false);
    expect(presetRefUsable("a\tb")).toBe(false);
  });
});
