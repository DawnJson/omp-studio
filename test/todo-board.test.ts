// 待办板的数据和命令（B1Board）：HUD 备注解析、`/todo` 命令文本、Markdown 导出、每项可做的操作。
// 真实录制 fixtures/tsp/todo-commands.jsonl（omp 18.12.6，2026-10-23：`/todo append|start|done|drop|rm|copy|…` 逐条发，路径已脱敏）。
import { describe, expect, it } from "vitest";
import { parseTaskCommand, taskCommandText, type TaskCommand } from "../src/shared/omp-output/index.ts";
import type { TodoPhase } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { statusToastTexts } from "../src/shared/tsp/composer-state.ts";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import { errorLines, newErrorLine } from "../src/shared/tsp/error-lines.ts";
import { deriveTodoPhases, phasesOfChecklist, todoItemOps, todoMarkdown } from "../src/shared/tsp/todos.ts";
import { loadTspFixture, tspDocMessages, type TspRecordLine } from "./tsp-fixtures.ts";

const lines = loadTspFixture("todo-commands");

/** 录制里终端发给 omp 的 `send` 事件的文字；别的行为 null。 */
function sentText(line: TspRecordLine): string | null {
  const body = line.body;
  if (line.dir !== "in" || typeof body !== "object" || body === null) return null;
  return "ev" in body && body.ev === "send" && "text" in body && typeof body.text === "string" ? body.text : null;
}

/** 第 `count` 次发出 `text` 这条命令在录制里的行号。 */
function sendIndex(text: string, count: number): number {
  let seen = 0;
  const at = lines.findIndex((line) => sentText(line) === text && (seen += 1) === count);
  expect(at).toBeGreaterThan(0);
  return at;
}

/** 回放到第 `count` 次发出 `text` 这条命令之前（不含它）。 */
function docBefore(text: string, count = 1): TspDocument {
  const doc = createDocument();
  for (const { message } of tspDocMessages(lines.slice(0, sendIndex(text, count)))) applyMessage(doc, message);
  return doc;
}

/** 这条命令发出后、下一条命令发出前的所有消息，逐条应用到 doc 上。 */
function applyReply(doc: TspDocument, text: string, count = 1): void {
  const start = sendIndex(text, count);
  const next = lines.findIndex((line, index) => index > start && sentText(line) !== null);
  for (const { message } of tspDocMessages(lines.slice(start, next < 0 ? undefined : next))) applyMessage(doc, message);
}

const content = (phases: readonly TodoPhase[]) =>
  phases.map((p) => [p.name, p.tasks.map((t) => [t.content, t.status])]);

describe("待办 HUD（omp 18.12.6 真实帧）", () => {
  it("`/todo append` 之后 HUD 里是阶段和条目；第二个阶段出现后标题带罗马数字，板上去掉", () => {
    const doc = docBefore("/todo start write");
    expect(content(deriveTodoPhases(doc))).toEqual([
      [
        "Alpha",
        [
          ["Write tests", "pending"],
          ["Fix bug", "pending"],
        ],
      ],
      ["Beta", [["Ship it", "pending"]]],
    ]);
  });

  it("没有备注的条目没有 notes 也没有 blocker", () => {
    const [first] = deriveTodoPhases(docBefore("/todo start write"));
    expect(first!.tasks[0]).toEqual({ content: "Write tests", status: "pending" });
  });

  it("全部做完时 omp 把阶段标成 collapsed、条目状态 done / dropped；studio 照常换算", () => {
    const doc = docBefore("/todo drop ship");
    expect(content(deriveTodoPhases(doc)).flatMap(([, tasks]) => (tasks as string[][]).map((t) => t[1]))).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
  });
});

describe("备注（HUD 条目的 note，omp 18.12.6 `interactive-mode.ts`：blocked 是阻塞原因，其他是备注里最后一条）", () => {
  // 帧形状取自上面的真实录制，note 字段按源码补上（18.12.6 的 todo 工具和 /todo 都不写 notes，录不到带备注的真实帧）。
  const base = [
    {
      id: "0",
      title: "I. Alpha",
      items: [
        { id: "0.0", text: "Write tests", status: "active", note: "waiting on fixtures" },
        { id: "0.1", text: "Fix bug", status: "blocked", note: "needs API key" },
        { id: "0.2", text: "Ship it", status: "pending" },
        { id: "0.3", text: "Tidy", status: "done", note: [{ t: "kept the old helper" }] },
      ],
    },
  ];

  it("非受阻条目的 note 进 notes；受阻的进 blocker；没有 note 的都没有", () => {
    const [phase] = phasesOfChecklist(base);
    expect(phase!.tasks).toEqual([
      { content: "Write tests", status: "in_progress", notes: ["waiting on fixtures"] },
      { content: "Fix bug", status: "blocked", blocker: "needs API key" },
      { content: "Ship it", status: "pending" },
      { content: "Tidy", status: "completed", notes: ["kept the old helper"] },
    ]);
  });
});

describe("todoMarkdown（和 omp `/todo` 弹出的 Markdown 逐字相同）", () => {
  it("回放到 `/todo` 之前，用 HUD 换算出的阶段拼的 Markdown = omp 那条 toast（末尾多一个换行）", () => {
    // `/todo` 第 1 次是空列表；第 2 次（三个 append 之后）、第 3 次（做完 / 放弃 / 删掉一项之后）有待办。
    for (const count of [2, 3]) {
      const doc = docBefore("/todo", count);
      const phases = deriveTodoPhases(doc);
      applyReply(doc, "/todo", count);
      const toast = statusToastTexts(doc).find((text) => text.startsWith("# "));
      expect(toast).toBeDefined();
      expect(todoMarkdown(phases)).toBe(`${toast}\n`);
    }
  });

  it("没有待办是 `# Todos`；受阻的项带 blocker 注释；五种状态的记号", () => {
    expect(todoMarkdown([])).toBe("# Todos\n");
    expect(
      todoMarkdown([
        {
          name: "One",
          tasks: [
            { content: "a", status: "pending" },
            { content: "b", status: "in_progress" },
            { content: "c", status: "completed" },
            { content: "d", status: "abandoned" },
            { content: "e", status: "blocked", blocker: "no key" },
            { content: "f", status: "blocked" },
          ],
        },
        { name: "Two", tasks: [{ content: "g", status: "pending" }] },
      ]),
    ).toBe("# One\n- [ ] a\n- [/] b\n- [x] c\n- [-] d\n- [!] e <!-- blocker: no key -->\n- [!] f\n\n# Two\n- [ ] g\n");
  });
});

describe("todoItemOps（⋯ 菜单）", () => {
  it("已经是目标状态的不列，删除总有", () => {
    expect(todoItemOps("pending")).toEqual(["start", "done", "drop", "rm"]);
    expect(todoItemOps("in_progress")).toEqual(["done", "drop", "rm"]);
    expect(todoItemOps("completed")).toEqual(["drop", "rm"]);
    expect(todoItemOps("abandoned")).toEqual(["start", "done", "rm"]);
    expect(todoItemOps("blocked")).toEqual(["start", "done", "drop", "rm"]);
  });
});

describe('/todo TaskCommand 拼文本（omp 18.12.6 `todo-command-controller` 的切词：只有 append 按 "…" 切词）', () => {
  const cases: [TaskCommand, string][] = [
    [{ kind: "todo", op: "start", target: "Write tests" }, "/todo start Write tests"],
    [{ kind: "todo", op: "done", target: "Fix bug" }, "/todo done Fix bug"],
    [{ kind: "todo", op: "done" }, "/todo done"],
    [{ kind: "todo", op: "drop", target: "Ship it" }, "/todo drop Ship it"],
    [{ kind: "todo", op: "rm", target: "Beta" }, "/todo rm Beta"],
    [{ kind: "todo", op: "rm" }, "/todo rm"],
    // 多词任务整个加引号，免得被当成"阶段 + 任务"
    [{ kind: "todo", op: "append", task: "write the docs" }, '/todo append "write the docs"'],
    [
      { kind: "todo", op: "append", task: "write the docs", phase: "New Phase" },
      '/todo append "New Phase" "write the docs"',
    ],
    [{ kind: "todo", op: "append", task: 'say "hi" \\ bye', phase: "A" }, '/todo append "A" "say \\"hi\\" \\\\ bye"'],
    [{ kind: "handoff" }, "/handoff"],
  ];
  it.each(cases)("%j → %s（解析后不变）", (cmd, text) => {
    expect(taskCommandText(cmd)).toBe(text);
    expect(parseTaskCommand(JSON.parse(JSON.stringify(cmd)))).toEqual(cmd);
  });

  it("拒绝缺参数、带换行 / 控制字符、未知动词", () => {
    expect(() => parseTaskCommand({ kind: "todo", op: "start" })).toThrow();
    expect(() => parseTaskCommand({ kind: "todo", op: "start", target: "  " })).toThrow();
    expect(() => parseTaskCommand({ kind: "todo", op: "done", target: "a\n/jobs kill all" })).toThrow();
    expect(() => parseTaskCommand({ kind: "todo", op: "append", task: "a\tb" })).toThrow();
    expect(() => parseTaskCommand({ kind: "todo", op: "append", task: "x", phase: "p\nq" })).toThrow();
    expect(() => parseTaskCommand({ kind: "todo", op: "edit" })).toThrow();
  });
});

describe("omp 的反馈：成功是 toast，失败是 `Error:` 行（真实录制）", () => {
  it("append / start / done / drop / rm 的 toast 原文", () => {
    const expected: [string, number, string][] = [
      ["/todo append Alpha write tests", 1, "Appended to Alpha: Write tests"],
      ["/todo start write", 1, "Started: Write tests"],
      ["/todo done", 1, "Marked all tasks completed."],
      ["/todo drop ship", 1, "Marked abandoned: Ship it"],
      ["/todo rm fix", 1, "Removed: Fix bug"],
      ["/todo rm Beta", 1, "Removed phase: Beta"],
      ["/todo rm", 1, "Cleared all todos."],
    ];
    for (const [text, count, toast] of expected) {
      const doc = docBefore(text, count);
      const before = statusToastTexts(doc);
      applyReply(doc, text, count);
      expect(statusToastTexts(doc).filter((candidate) => !before.includes(candidate))).toContain(toast);
      expect(newErrorLine(doc, errorLines(docBefore(text, count)))).toBeNull();
    }
  });

  it("没匹配到、缺参数、未知动词：不是 toast，是新增的 `Error: ` 行", () => {
    const expected: [string, string][] = [
      ["/todo start zzz", 'Error: No task matched "zzz". Use /todo to list current tasks.'],
      ["/todo start", "Error: Usage: /todo start <task>"],
      ["/todo append", "Error: Usage: /todo append [<phase>] <task...>"],
    ];
    for (const [text, error] of expected) {
      const doc = docBefore(text);
      const before = errorLines(doc);
      const toasts = statusToastTexts(doc);
      applyReply(doc, text);
      expect(newErrorLine(doc, before)).toBe(error);
      expect(statusToastTexts(doc)).toEqual(toasts);
    }
    const doc = docBefore("/todo bogus");
    const before = errorLines(doc);
    applyReply(doc, "/todo bogus");
    expect(newErrorLine(doc, before)).toMatch(/^Error: Unknown \/todo verb "bogus"\.\nUsage: \/todo <verb> \[args\]/);
  });

  it('`/todo append "New Phase" with quotes task`：引号里的阶段名是一个词，其余拼成任务', () => {
    const text = '/todo append "New Phase" with quotes task';
    const doc = docBefore(text);
    applyReply(doc, text);
    expect(content(deriveTodoPhases(doc)).at(-1)).toEqual(["New Phase", [["With quotes task", "pending"]]]);
  });
});
