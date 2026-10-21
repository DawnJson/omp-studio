// TSP 任务的会话树：读 omp 会话文件（fixtures/omp-session，omp 18.12.5 真实产出，cwd 已脱敏）建树；
// omp `/tree` 选择器、回溯后的输入框、用户消息卡片的位置，按 omp 自己录的 TSP 流（fixtures/tsp/session-tree.jsonl）逐帧验证。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTreeFromSessionText,
  findUserEntry,
  fileLeafId,
  parseSessionEntries,
} from "../src/main/tsp/session-tree-file.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import {
  SUMMARY_NO,
  findSummaryPicker,
  findComposerEditor,
  findTreePicker,
  hasNavigatedToast,
  userCardFromEnd,
} from "../src/shared/tsp/session-tree.ts";
import { focusIndexFromEnd } from "../src/renderer/src/features/conversation/tree-focus.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

const sessionDir = path.resolve(import.meta.dirname, "..", "fixtures", "omp-session");
const linear = readFileSync(path.join(sessionDir, "linear.jsonl"), "utf8");
const branched = readFileSync(path.join(sessionDir, "branched.jsonl"), "utf8");

// linear：两轮对话 ALPHA / BETA（omp 18.12.5 `omp -p` + `--continue -p`）。
const ALPHA = "beac8e08";
const BETA = "b772c2f5";
// branched：同一份会话里在 `/tree` 回到 BETA 之前，再发一句 GAMMA（同一个文件里长出第二条分支）。
const GAMMA = "47b8e31d";

describe("parseSessionEntries", () => {
  it("跳过文件头（title、session），按文件顺序给出带 id 和 parentId 的条目", () => {
    const entries = parseSessionEntries(linear);
    expect(entries.map((entry) => entry.id)).toEqual([
      "c98d384e",
      "7013a55d",
      ALPHA,
      "0ac1f5b8",
      "42095935",
      "a6b4e493",
      BETA,
      "b05cb500",
      "d28e91a6",
    ]);
    expect(entries[0]?.parentId).toBeNull();
    expect(entries[2]?.parentId).toBe("7013a55d");
  });

  it("写到一半的最后一行跳过；中间的坏行说明文件坏了，抛错", () => {
    const lines = linear.trimEnd().split("\n");
    expect(parseSessionEntries(`${lines.join("\n")}\n{"type":"message","id":"zz`)).toHaveLength(9);
    const broken = [...lines.slice(0, 4), "{not json", ...lines.slice(4)].join("\n");
    expect(() => parseSessionEntries(broken)).toThrow(/line 5 is not valid JSON/);
  });
});

describe("buildTreeFromSessionText", () => {
  it("一条直线的会话：两条用户消息都在第 0 级、都在当前分支，最后一条是当前", () => {
    expect(buildTreeFromSessionText(linear)).toEqual([
      {
        entryId: ALPHA,
        text: "Reply with exactly: ALPHA. No tools.",
        indent: 0,
        onCurrentBranch: true,
        current: false,
      },
      { entryId: BETA, text: "Reply with exactly: BETA. No tools.", indent: 0, onCurrentBranch: true, current: true },
    ]);
  });

  it("文件里的真分叉（/tree 回到 BETA 之前再发 GAMMA）：两条分支缩进一级，叶子所在的 GAMMA 是当前", () => {
    expect(buildTreeFromSessionText(branched)).toEqual([
      {
        entryId: ALPHA,
        text: "Reply with exactly: ALPHA. No tools.",
        indent: 0,
        onCurrentBranch: true,
        current: false,
      },
      { entryId: BETA, text: "Reply with exactly: BETA. No tools.", indent: 1, onCurrentBranch: false, current: false },
      { entryId: GAMMA, text: "Reply with exactly: GAMMA. No tools.", indent: 1, onCurrentBranch: true, current: true },
    ]);
  });

  it("叶子是文件最后一个条目（和 omp /tree 里的 current 一致）", () => {
    expect(fileLeafId(parseSessionEntries(linear))).toBe("d28e91a6");
    expect(fileLeafId(parseSessionEntries(branched))).toBe("a395f03a");
    expect(fileLeafId([])).toBeNull();
  });

  it("回溯空档：文件还没往下长时叶子按 override（回到 BETA 之前 = a6b4e493），文件长了就不再生效", () => {
    const override = { afterEntryId: "d28e91a6", leafId: "a6b4e493" };
    expect(
      buildTreeFromSessionText(linear, override).map((node) => [node.entryId, node.onCurrentBranch, node.current]),
    ).toEqual([
      [ALPHA, true, true],
      [BETA, false, false],
    ]);
    // 文件最后一个条目不是 override 记的那个了（发了新消息）：按文件。
    expect(buildTreeFromSessionText(branched, override).find((node) => node.current)?.entryId).toBe(GAMMA);
  });

  it("omp 自己注入的用户消息（attribution=agent）不进树", () => {
    const injected = `${linear.trimEnd()}\n${JSON.stringify({
      type: "message",
      id: "ff000001",
      parentId: "d28e91a6",
      message: { role: "user", content: [{ type: "text", text: "injected" }], attribution: "agent" },
    })}\n`;
    expect(buildTreeFromSessionText(injected).map((node) => node.entryId)).toEqual([ALPHA, BETA]);
  });
});

describe("findUserEntry", () => {
  it("用户消息给出父条目和完整文字；助手消息、标记条目、不存在的 id 都是 null", () => {
    const entries = parseSessionEntries(linear);
    expect(findUserEntry(entries, BETA)).toEqual({
      parentId: "a6b4e493",
      text: "Reply with exactly: BETA. No tools.",
      lastEntryId: "d28e91a6",
    });
    expect(findUserEntry(entries, "b05cb500")).toBeNull();
    expect(findUserEntry(entries, "a6b4e493")).toBeNull();
    expect(findUserEntry(entries, "nope")).toBeNull();
  });

  it("多个文本块用换行连起来，不截断长文字", () => {
    const long = "x".repeat(500);
    const text = JSON.stringify({
      type: "message",
      id: "aa",
      parentId: null,
      message: {
        role: "user",
        content: [{ type: "text", text: long }, { type: "image" }, { type: "text", text: "tail" }],
      },
    });
    expect(findUserEntry(parseSessionEntries(text), "aa")?.text).toBe(`${long}\ntail`);
  });
});

describe("omp 18.12.5 的 /tree 录制（fixtures/tsp/session-tree.jsonl）", () => {
  const fixture = loadTspFixture("session-tree");
  const messages = tspDocMessages(fixture);

  it("录制里的用户操作：send /tree、activate 一条用户消息、edit 清空预填的输入框", () => {
    const events = fixture.filter((line) => line.dir === "in").map((line) => line.body as { ev: string });
    expect(events.filter((event) => event.ev !== "ack")).toEqual([
      { ev: "send", sf: "s:1", id: "j.line/input", text: "/tree" },
      { ev: "activate", sf: "s:1", id: "s.^picker", item: BETA },
      { ev: "edit", sf: "s:1", id: "j.line/input", from: 0, to: 35, text: "", cursor: 0, len: 35 },
    ]);
  });

  it("选择器：layout=tree 的 picker，items 是条目 id，current 是叶子；选完关闭、输入框被预填、出现 Navigated toast，清空后为空", () => {
    const doc = createDocument();
    let pickerSeen = false;
    let navigated = false;
    let prefilled = false;
    let cleared = false;
    for (const { message } of messages) {
      applyMessage(doc, message);
      const picker = findTreePicker(doc);
      if (picker !== null && !pickerSeen) {
        pickerSeen = true;
        expect(picker.items).toEqual([
          "c98d384e",
          "7013a55d",
          ALPHA,
          "0ac1f5b8",
          "42095935",
          "a6b4e493",
          BETA,
          "b05cb500",
          "d28e91a6",
        ]);
        expect(picker.current).toEqual(["d28e91a6"]);
        expect(picker.id).toBe("s.^picker");
      }
      if (pickerSeen && picker === null && hasNavigatedToast(doc)) navigated = true;
      const editor = findComposerEditor(doc);
      if (pickerSeen && picker === null && editor?.text === "Reply with exactly: BETA. No tools.") {
        prefilled = true;
        expect(editor).toMatchObject({ sf: "s:1", id: "j.line/input" });
      }
      if (prefilled && editor?.text === "") cleared = true;
    }
    expect({ pickerSeen, navigated, prefilled, cleared }).toEqual({
      pickerSeen: true,
      navigated: true,
      prefilled: true,
      cleared: true,
    });
  });

  it("模型选择器不是 tree 布局，不会被当成会话树", () => {
    const doc = createDocument();
    for (const { message } of tspDocMessages(loadTspFixture("picker"))) {
      applyMessage(doc, message);
      expect(findTreePicker(doc)).toBeNull();
    }
  });

  it("用户消息卡片：从末尾数第几张（回退图标点的是哪一条）；回溯后 omp 只重画到新叶子，剩下的卡片重新数", () => {
    const doc = createDocument();
    let checkedBefore = false;
    for (const { message } of messages) {
      applyMessage(doc, message);
      if (findTreePicker(doc) !== null && !checkedBefore) {
        checkedBefore = true;
        // 选择器刚打开：ALPHA、BETA 两张卡片。
        expect(userCardFromEnd(doc, "s:1", "q.tools/rewind")).toBe(0);
        expect(userCardFromEnd(doc, "s:1", "o.tools/rewind")).toBe(1);
        expect(userCardFromEnd(doc, "s:1", "o")).toBe(1);
        expect(userCardFromEnd(doc, "s:1", "j.line/input")).toBeNull();
        expect(userCardFromEnd(doc, "s:9", "o")).toBeNull();
      }
    }
    expect(checkedBefore).toBe(true);
    // 回溯到 BETA 之前之后只剩 ALPHA 一张。
    expect(userCardFromEnd(doc, "s:1", "o.tools/rewind")).toBe(0);
    expect(userCardFromEnd(doc, "s:1", "q.tools/rewind")).toBeNull();
  });
});

describe("focusIndexFromEnd", () => {
  it("当前分支上倒数第 N 条用户消息在节点列表里的下标（不在分支上的分叉不数）", () => {
    const nodes = buildTreeFromSessionText(branched);
    // 节点顺序 ALPHA、BETA（另一条分支）、GAMMA；当前分支 = ALPHA、GAMMA。
    expect(focusIndexFromEnd(nodes, 0)).toBe(2);
    expect(focusIndexFromEnd(nodes, 1)).toBe(0);
    expect(focusIndexFromEnd(nodes, 2)).toBeNull();
  });
});

describe("branch_summary 条目和压缩条目", () => {
  const read = (name: string) => readFileSync(path.join(sessionDir, `${name}.jsonl`), "utf8");

  it("回溯时摘要（omp 18.12.5 实测）在文件末尾追加 branch_summary，挂在新叶子下：用户节点不变，叶子在 BETA 的父条目", () => {
    expect(
      buildTreeFromSessionText(read("summarized")).map((node) => [node.entryId, node.onCurrentBranch, node.current]),
    ).toEqual([
      ["5bc4a7a2", true, true],
      ["6f8bf37c", false, false],
    ]);
    expect(fileLeafId(parseSessionEntries(read("summarized")))).toBe("a3351bfc");
  });

  it("压缩过的会话：compaction 条目挂在叶子下，压缩点之前的用户消息仍在树里", () => {
    expect(buildTreeFromSessionText(read("compacted")).map((node) => [node.entryId, node.current])).toEqual([
      ["5bc4a7a2", false],
      ["6f8bf37c", true],
    ]);
  });

  it("摘要提示录制：Summarize branch? 的 picker 在选了用户消息之后出现，答 0（No summary）后消失；树选择器带 summarize 动作", () => {
    const doc = createDocument();
    let treeActions: string[] = [];
    let prompt: { sf: string; id: string } | null = null;
    let promptGone = false;
    for (const { message } of tspDocMessages(loadTspFixture("session-tree-prompt"))) {
      applyMessage(doc, message);
      const tree = findTreePicker(doc);
      if (tree !== null) treeActions = tree.actions;
      const found = findSummaryPicker(doc);
      if (found !== null) prompt = found;
      else if (prompt !== null) promptGone = true;
    }
    expect(treeActions).toEqual(["switch", "summarize", "label", "filter", "close"]);
    expect(prompt).toEqual({ sf: "s:1", id: "t.^picker" });
    expect(SUMMARY_NO).toBe("0");
    expect(promptGone).toBe(true);
  });

  it("摘要选择器认 title + items 0,1,2，会话树和模型选择器都不是它", () => {
    const doc = createDocument();
    for (const { message } of tspDocMessages(loadTspFixture("session-tree"))) {
      applyMessage(doc, message);
      expect(findSummaryPicker(doc)).toBeNull();
    }
  });
});
