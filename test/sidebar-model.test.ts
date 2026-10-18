// 防的失败：侧栏里任务跑到错的项目下、重名项目分不清、等你确认的任务跳转错乱、状态点形状不对，
// 以及命令面板搜不到中文任务或把斜杠命令当成搜索。
import { describe, expect, it } from "vitest";
import type { Project, ProjectId, SessionSummary, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { fuzzyMatch } from "../src/shared/ui/fuzzy.ts";
import { buildSections, type CommandEntry } from "../src/shared/ui/palette-model.ts";
import { dotKind, groupTasks, nextWaitingTask, projectLabels, waitingTasks } from "../src/shared/ui/sidebar-model.ts";

const project = (id: string, path: string, name: string): Project => ({ id: id as ProjectId, path, name });
const task = (id: string, projectId: string, patch: Partial<TaskState> = {}): TaskState =>
  ({
    id: id as TaskId,
    projectId: projectId as ProjectId,
    title: id,
    status: "idle",
    unread: false,
    lastTurn: null,
    createdAt: 1,
    updatedAt: 1,
    runningSubagents: 0,
    ...patch,
  }) as TaskState;

describe("projectLabels", () => {
  it("重名项目带上级目录，不重名的保持原名；路径可含空格、中文和两种斜杠", () => {
    const labels = projectLabels([
      project("a", "E:\\工作 区\\app", "app"),
      project("b", "E:/个人/app", "app"),
      project("c", "E:\\other", "other"),
    ]);
    expect([labels.get("a" as ProjectId), labels.get("b" as ProjectId), labels.get("c" as ProjectId)]).toEqual([
      "工作 区/app",
      "个人/app",
      "other",
    ]);
  });
});

describe("groupTasks", () => {
  const projects = [project("p1", "C:\\a", "a"), project("p2", "C:\\b", "b")];

  it("任务归到自己的项目，按最近操作排序，归档中的任务不出现，空项目保留", () => {
    const groups = groupTasks(
      projects,
      [
        task("old", "p1", { updatedAt: 1 }),
        task("new", "p1", { updatedAt: 9 }),
        task("gone", "p1", { updatedAt: 99 }),
        task("other", "p2"),
      ],
      new Set(["gone" as TaskId]),
    );
    expect(groups.map((g) => g.tasks.map((x) => x.id))).toEqual([["new", "old"], ["other"]]);
    expect(groupTasks(projects, [], new Set()).map((g) => g.tasks.length)).toEqual([0, 0]);
  });

  it("指向未知项目的任务不显示（等项目列表刷新）", () => {
    expect(groupTasks(projects, [task("x", "unknown")], new Set()).flatMap((g) => g.tasks)).toEqual([]);
  });
});

describe("等你确认", () => {
  const tasks = [
    task("a", "p", { status: "needs_you", updatedAt: 5 }),
    task("b", "p", { status: "needs_you", updatedAt: 2 }),
    task("c", "p", { status: "running" }),
  ];

  it("等得最久的在前；依次跳转并循环；当前不在等待列表时跳到最早的", () => {
    const waiting = waitingTasks(tasks, new Set());
    expect(waiting.map((x) => x.id)).toEqual(["b", "a"]);
    expect(nextWaitingTask(waiting, null)?.id).toBe("b");
    expect(nextWaitingTask(waiting, "b" as TaskId)?.id).toBe("a");
    expect(nextWaitingTask(waiting, "a" as TaskId)?.id).toBe("b");
    expect(nextWaitingTask(waiting, "c" as TaskId)?.id).toBe("b");
    expect(nextWaitingTask([], null)).toBeNull();
  });
});

describe("dotKind", () => {
  it("等你 > 出错 > 进行中 > 未读完成；已读完成和空闲不画", () => {
    expect(dotKind(task("t", "p", { status: "needs_you", unread: true }))).toBe("waiting");
    expect(dotKind(task("t", "p", { status: "error" }))).toBe("error");
    expect(dotKind(task("t", "p", { lastTurn: { status: "error", endedAt: 1 } }))).toBe("error");
    expect(dotKind(task("t", "p", { status: "running" }))).toBe("running");
    expect(dotKind(task("t", "p", { unread: true }))).toBe("done");
    expect(dotKind(task("t", "p"))).toBe("none");
    expect(dotKind(task("t", "p", { status: "stopped" }))).toBe("none");
  });
});

describe("fuzzyMatch", () => {
  it("中文子串和英文大小写都能匹配，并给出高亮下标；多个词都要命中", () => {
    expect(fuzzyMatch("修复", "登录 修复 bug")?.indices).toEqual([3, 4]);
    expect(fuzzyMatch("LOGIN", "fix login bug")?.indices).toEqual([4, 5, 6, 7, 8]);
    expect(fuzzyMatch("fix bug", "fix login bug")).not.toBeNull();
    expect(fuzzyMatch("fix deploy", "fix login bug")).toBeNull();
  });

  it("连续命中比零散命中得分高；空查询匹配一切", () => {
    expect((fuzzyMatch("abc", "xx abc")?.score ?? 0) > (fuzzyMatch("abc", "a-b-c")?.score ?? 0)).toBe(true);
    expect(fuzzyMatch("  ", "anything")).toEqual({ score: 0, indices: [] });
  });
});

describe("buildSections", () => {
  const command = (id: string, label: string): CommandEntry => ({ id, label, run: () => {} });
  const session: SessionSummary = {
    id: "s1",
    title: "整理 日志",
    firstPrompt: null,
    cwd: "E:\\未加入 项目",
    projectId: null,
    modifiedAt: 1,
    taskId: null,
  };
  const tasks = Array.from({ length: 7 }, (_, i) => task(`t${i}`, "p1", { title: `任务 ${i}`, updatedAt: i }));
  const base = {
    tasks,
    sessions: [session],
    commands: [command("settings", "设置"), command("archive", "归档当前任务")],
    projectLabel: () => "项目甲",
    taskTitle: (x: TaskState) => x.title,
    sessionTitle: (x: SessionSummary) => x.title ?? "",
    hasCurrentTask: true,
    slashCommands: [] as AvailableSlashCommand[],
  };

  it("空查询：最近 5 个任务（最近的在前）+ 全部命令", () => {
    const sections = buildSections({ ...base, query: "" });
    expect(sections.map((s) => s.id)).toEqual(["recent", "commands"]);
    expect(sections[0]?.rows.map((r) => r.title)).toEqual(["任务 6", "任务 5", "任务 4", "任务 3", "任务 2"]);
  });

  it("有查询：任务、历史会话（标终端来源）、命令各自分组，没有命中的分组不出现", () => {
    expect(buildSections({ ...base, query: "日志" }).map((s) => s.id)).toEqual(["sessions"]);
    expect(buildSections({ ...base, query: "任务" }).map((s) => s.id)).toEqual(["tasks", "commands"]);
    expect(buildSections({ ...base, query: "项目甲" })[0]?.rows).toHaveLength(7);
  });

  it("斜杠开头只给 omp 的斜杠命令：需要参数的先放进输入框，无参数或已写参数的直接发送；列表里没有时原样发送", () => {
    const slashCommands = [
      { name: "compact", source: "builtin" as const, description: "压缩上下文" },
      { name: "model", source: "builtin" as const, input: { hint: "<模型>" } },
    ];
    const rows = (query: string, extra = {}) => buildSections({ ...base, slashCommands, query, ...extra })[0]?.rows;
    expect(rows("/comp")).toEqual([
      expect.objectContaining({ kind: "slash", text: "/compact", send: true, subtitle: "压缩上下文" }),
    ]);
    expect(rows("/model")).toEqual([expect.objectContaining({ text: "/model", send: false })]);
    expect(rows("/model gpt-5")).toEqual([expect.objectContaining({ text: "/model gpt-5", send: true })]);
    expect(rows("/zzz")).toEqual([expect.objectContaining({ text: "/zzz", send: true })]);
    expect(rows("/", {})?.length).toBe(2);
    expect(buildSections({ ...base, slashCommands, query: "/compact", hasCurrentTask: false })).toEqual([]);
    expect(buildSections({ ...base, query: "zzzz" })).toEqual([]);
  });
});
