// 防的失败：侧栏里任务跑到错的项目下、重名项目分不清、等你确认的任务跳转错乱、状态点形状不对，
// 以及命令面板搜不到中文任务或把斜杠命令当成搜索。
import { describe, expect, it } from "vitest";
import type { Project, ProjectId, SessionSummary, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { fuzzyMatch } from "../src/shared/ui/fuzzy.ts";
import { buildSections, type CommandEntry } from "../src/shared/ui/palette-model.ts";
import {
  buildFolders,
  buildTimeline,
  dotKind,
  nextWaitingTask,
  projectLabels,
  sessionTitle,
  taskTitle,
  waitingTasks,
  type SidebarInput,
  type SidebarItem,
} from "../src/shared/ui/sidebar-model.ts";

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
  it("等你 > 出错 > 进行中 > 完成；完成不看是否已读，被停止和从没跑过的不画", () => {
    expect(dotKind(task("t", "p", { status: "needs_you", unread: true }))).toBe("waiting");
    expect(dotKind(task("t", "p", { status: "error" }))).toBe("error");
    expect(dotKind(task("t", "p", { lastTurn: { status: "error", endedAt: 1 } }))).toBe("error");
    expect(dotKind(task("t", "p", { status: "running" }))).toBe("running");
    expect(dotKind(task("t", "p", { unread: true, lastTurn: { status: "completed", endedAt: 1 } }))).toBe("done");
    expect(dotKind(task("t", "p", { unread: false, lastTurn: { status: "completed", endedAt: 1 } }))).toBe("done");
    expect(dotKind(task("t", "p", { lastTurn: { status: "aborted", endedAt: 1 } }))).toBe("none");
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
    lastTurn: null,
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

describe("buildFolders / buildTimeline", () => {
  const past = (id: string, cwd: string, modifiedAt: number, patch: Partial<SessionSummary> = {}): SessionSummary => ({
    id,
    title: id,
    firstPrompt: null,
    lastTurn: null,
    cwd,
    projectId: null,
    modifiedAt,
    taskId: null,
    ...patch,
  });
  const projects = [project("p1", "C:\\work\\app", "app"), project("p2", "C:\\work\\empty", "empty")];
  const input = (patch: Partial<SidebarInput> = {}): SidebarInput => ({
    projects,
    tasks: [],
    sessions: [],
    hidden: new Set(),
    query: "",
    ...patch,
  });
  const ids = (items: readonly SidebarItem[]) => items.map((item) => item.key);

  it("同一文件夹的任务和会话合进一个文件夹（路径写法不同也归一），按最近活动混排", () => {
    const folders = buildFolders(
      input({
        tasks: [task("t-old", "p1", { updatedAt: 10 }), task("t-new", "p1", { updatedAt: 50 })],
        sessions: [past("s-mid", "c:/work/app/", 30), past("s-new", "C:\\work\\APP", 70)],
      }),
    );
    expect(folders.map((folder) => [folder.label, folder.project?.id ?? null, ids(folder.items)])).toEqual([
      ["app", "p1", ["session:s-new", "task:t-new", "session:s-mid", "task:t-old"]],
      ["empty", "p2", []],
    ]);
  });

  it("只在历史里出现的 cwd 单独成文件夹（project 为 null）；文件夹按最新的一行排序，没有行的项目排最后", () => {
    const folders = buildFolders(
      input({
        tasks: [task("t", "p1", { updatedAt: 40 })],
        sessions: [past("a", "E:/other/lib", 90), past("b", "E:/other/lib", 20)],
      }),
    );
    expect(folders.map((folder) => [folder.label, folder.project === null, ids(folder.items)])).toEqual([
      ["lib", true, ["session:a", "session:b"]],
      ["app", false, ["task:t"]],
      ["empty", false, []],
    ]);
    expect(folders[0]?.cwd).toBe("E:/other/lib");
  });

  it("默认文件夹永远排第一，不管多久没动；其余文件夹仍按最近活动；搜索时没有匹配行就不显示", () => {
    const chats = project("pc", "C:\\Users\\me\\omp-studio\\chats", "chats");
    const base = input({
      projects: [project("p1", "C:\\work\\app", "app"), chats],
      tasks: [task("t", "p1", { updatedAt: 40 })],
      sessions: [past("a", "E:/other/lib", 90), past("old", "c:/users/me/omp-studio/chats/", 5, { title: "旧会话" })],
    });
    const withDefault = { ...base, defaultCwd: "C:/Users/me/omp-studio/chats" };
    expect(buildFolders(withDefault).map((f) => f.label)).toEqual(["chats", "lib", "app"]);
    expect(buildFolders(base).map((f) => f.label)).toEqual(["lib", "app", "chats"]);
    expect(buildFolders({ ...withDefault, query: "旧" }).map((f) => f.label)).toEqual(["chats"]);
    expect(buildFolders({ ...withDefault, query: "a" }).map((f) => f.label)).toEqual(["lib"]);
    expect(buildFolders({ ...withDefault, projects: [chats], tasks: [], sessions: [] }).map((f) => f.label)).toEqual([
      "chats",
    ]);
  });

  it("文件夹重名时标签带上级目录；归档的任务、已挂任务的会话、指向未知项目的任务都不出现", () => {
    const folders = buildFolders(
      input({
        projects: [project("p1", "C:/one/src", "src")],
        tasks: [task("hid", "p1"), task("ghost", "nope")],
        sessions: [past("y", "C:/two/src", 1), past("attached", "C:/one/src", 9, { taskId: "t" as TaskId })],
        hidden: new Set(["hid" as TaskId]),
      }),
    );
    expect(folders.map((folder) => [folder.label, ids(folder.items)])).toEqual([
      ["two/src", ["session:y"]],
      ["one/src", []],
    ]);
  });

  it("时间排列：任务和会话平铺，按最近活动；一轮刚跑完的任务按结束时间算", () => {
    const items = buildTimeline(
      input({
        tasks: [task("touched", "p1", { updatedAt: 50 }), task("finished", "p1", { updatedAt: 90 })],
        sessions: [past("s", "E:/x", 60), past("old", "E:/y", 5)],
      }),
    );
    expect(ids(items)).toEqual(["task:finished", "session:s", "task:touched", "session:old"]);
  });

  it("搜索同时过滤任务和会话（标题里的图标字形不参与匹配），没有匹配行的文件夹（含空项目）不显示", () => {
    const query = "数据";
    const sessions = [past("s1", "E:/x", 5, { title: "\ue5fa 数据迁移" }), past("s2", "E:/x", 4, { title: "别的" })];
    const tasks = [task("t1", "p1", { title: "重构数据层" }), task("t2", "p1", { title: "文档" })];
    expect(buildFolders(input({ tasks, sessions, query })).map((f) => [f.label, ids(f.items)])).toEqual([
      ["x", ["session:s1"]],
      ["app", ["task:t1"]],
    ]);
    expect(ids(buildTimeline(input({ tasks, sessions, query })))).toEqual(["session:s1", "task:t1"]);
  });

  it("标题去掉私用区图标字形；去完为空时会话退回第一条消息", () => {
    expect(sessionTitle(past("a", "E:/x", 1, { title: "\ue5fa\u{f0001} 修复 bug" }))).toBe("修复 bug");
    expect(sessionTitle(past("b", "E:/x", 1, { title: "\ue5fa", firstPrompt: "你好" }))).toBe("你好");
    expect(sessionTitle(past("c", "E:/x", 1, { title: null, firstPrompt: null }))).toBeNull();
    expect(taskTitle({ title: " \ue000 任务 " })).toBe("任务");
  });
});
