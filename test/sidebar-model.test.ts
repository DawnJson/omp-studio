// 防的失败：侧栏里任务跑到错的项目下、重名项目分不清、等你确认的任务跳转错乱、状态点形状不对，
// 以及命令面板搜不到中文任务或把斜杠命令当成搜索。
import { describe, expect, it } from "vitest";
import type { Project, ProjectId, SessionSummary, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { fuzzyMatch } from "../src/shared/ui/fuzzy.ts";
import { buildSections, type CommandEntry } from "../src/shared/ui/palette-model.ts";
import {
  adoptNewFolders,
  buildArchived,
  buildFolders,
  buildTimeline,
  dotKind,
  foldForks,
  moveFolder,
  nextWaitingTask,
  projectLabels,
  sessionDotKind,
  sessionTitle,
  taskTitle,
  waitingTasks,
  visibleItems,
  type SidebarInput,
  type SidebarItem,
} from "../src/shared/ui/sidebar-model.ts";

const project = (id: string, path: string, name: string, hidden = false): Project => ({
  id: id as ProjectId,
  path,
  name,
  hidden,
});
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
    const waiting = waitingTasks(tasks, [{ id: "p" as ProjectId, hidden: false }], new Set());
    expect(waiting.map((x) => x.id)).toEqual(["b", "a"]);
    expect(nextWaitingTask(waiting, null)?.id).toBe("b");
    expect(nextWaitingTask(waiting, "b" as TaskId)?.id).toBe("a");
    expect(nextWaitingTask(waiting, "a" as TaskId)?.id).toBe("b");
    expect(nextWaitingTask(waiting, "c" as TaskId)?.id).toBe("b");
    expect(nextWaitingTask([], null)).toBeNull();
  });

  it("移出列表的文件夹里的任务不算在等你", () => {
    const others = [...tasks, task("d", "q", { status: "needs_you", updatedAt: 1 })];
    const projects = [
      { id: "p" as ProjectId, hidden: false },
      { id: "q" as ProjectId, hidden: true },
    ];
    expect(waitingTasks(others, projects, new Set()).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("dotKind", () => {
  it("等你 > 出错 > 进行中；正常结束、被停止和从没跑过的不画", () => {
    expect(dotKind(task("t", "p", { status: "needs_you", unread: true }))).toBe("waiting");
    expect(dotKind(task("t", "p", { status: "error" }))).toBe("error");
    expect(dotKind(task("t", "p", { lastTurn: { status: "error", endedAt: 1 } }))).toBe("error");
    expect(dotKind(task("t", "p", { status: "running" }))).toBe("running");
    expect(dotKind(task("t", "p", { unread: true, lastTurn: { status: "completed", endedAt: 1 } }))).toBe("none");
    expect(dotKind(task("t", "p", { lastTurn: { status: "aborted", endedAt: 1 } }))).toBe("none");
    expect(dotKind(task("t", "p"))).toBe("none");
    expect(dotKind(task("t", "p", { status: "stopped" }))).toBe("none");
  });
});

describe("sessionDotKind（历史会话行）", () => {
  it("失败 / 中断各一个形状；正常答完、被用户停止、最后是用户消息、认不出的不画", () => {
    expect(sessionDotKind({ lastTurn: "completed" })).toBe("none");
    expect(sessionDotKind({ lastTurn: "error" })).toBe("error");
    expect(sessionDotKind({ lastTurn: "interrupted" })).toBe("interrupted");
    expect(sessionDotKind({ lastTurn: "aborted" })).toBe("none");
    expect(sessionDotKind({ lastTurn: "pending" })).toBe("none");
    expect(sessionDotKind({ lastTurn: null })).toBe("none");
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
    archived: false,
    parentId: null,
    pinned: false,
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
    archived: false,
    parentId: null,
    pinned: false,
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

  it("omp 置顶的历史会话排在文件夹和时间线的最前；文件夹本身不因为有置顶行而往前排", () => {
    const sessions = [past("old-pinned", "C:\\work\\app", 5, { pinned: true }), past("new", "C:\\work\\app", 60)];
    const tasks = [task("t", "p1", { updatedAt: 50 })];
    expect(ids(buildTimeline(input({ tasks, sessions })))).toEqual(["session:old-pinned", "session:new", "task:t"]);
    const chats = project("pc", "C:\\Users\\me\\omp-studio\\chats", "chats");
    const folders = buildFolders(
      input({
        projects: [...projects, chats],
        tasks: [...tasks, task("c", "pc", { updatedAt: 1 })],
        sessions: [...sessions, past("other", "E:/other/lib", 95)],
        defaultCwd: "C:/Users/me/omp-studio/chats",
      }),
    );
    expect(folders.map((folder) => folder.label)).toEqual(["chats", "lib", "app", "empty"]);
    expect(ids(folders[2]!.items)).toEqual(["session:old-pinned", "session:new", "task:t"]);
  });

  it("文件夹按存下的顺序排，最近活动不挪它们；没记下的新文件夹排在默认文件夹后面", () => {
    const chats = project("pc", "C:\\Users\\me\\omp-studio\\chats", "chats");
    const base = input({
      projects: [...projects, chats],
      tasks: [task("t", "p1", { updatedAt: 99 }), task("c", "pc", { updatedAt: 1 })],
      sessions: [past("lib", "E:/other/lib", 90), past("new", "D:/fresh", 10)],
      defaultCwd: "C:/Users/me/omp-studio/chats",
    });
    const folderOrder = ["c:/work/empty", "e:/other/lib", "c:/work/app"];
    expect(buildFolders({ ...base, folderOrder }).map((f) => f.label)).toEqual([
      "chats",
      "fresh",
      "empty",
      "lib",
      "app",
    ]);
    // app 刚跑完一轮（最新）也不往前挪。
    const busier = { ...base, folderOrder, tasks: [task("t", "p1", { updatedAt: 500 }), task("c", "pc")] };
    expect(buildFolders(busier).map((f) => f.label)).toEqual(["chats", "fresh", "empty", "lib", "app"]);
  });

  it("新文件夹记进顺序的最前面（默认文件夹不记）；拖动只重排显示着的，藏着的保持原位接在后面", () => {
    const chats = project("pc", "C:\\Users\\me\\omp-studio\\chats", "chats");
    const defaultCwd = "C:/Users/me/omp-studio/chats";
    const shown = buildFolders(
      input({
        projects: [...projects, chats],
        sessions: [past("lib", "E:/other/lib", 90), past("new", "D:/fresh", 10)],
        folderOrder: ["e:/other/lib", "c:/gone", "c:/work/app", "c:/work/empty"],
        defaultCwd,
      }),
    );
    expect(shown.map((f) => f.key)).toEqual([
      "c:/users/me/omp-studio/chats",
      "d:/fresh",
      "e:/other/lib",
      "c:/work/app",
      "c:/work/empty",
    ]);
    const stored = ["e:/other/lib", "c:/gone", "c:/work/app", "c:/work/empty"];
    const adopted = adoptNewFolders(stored, shown, defaultCwd);
    expect(adopted).toEqual(["d:/fresh", ...stored]);
    expect(adoptNewFolders(adopted!, shown, defaultCwd)).toBeNull();
    // 把 empty 拖到最前（默认文件夹之后）；c:/gone 没显示，接在后面。
    expect(moveFolder(adopted!, shown, "c:/work/empty", 0, defaultCwd)).toEqual([
      "c:/work/empty",
      "d:/fresh",
      "e:/other/lib",
      "c:/work/app",
      "c:/gone",
    ]);
    // 默认文件夹拖不动。
    expect(moveFolder(adopted!, shown, "c:/users/me/omp-studio/chats", 3, defaultCwd)).toEqual(adopted);
  });

  it("任务按挂在它上面的会话置顶：排在更新的未置顶任务前面", () => {
    const tasks = [task("old", "p1", { updatedAt: 5 }), task("new", "p1", { updatedAt: 80 })];
    const sessions = [past("s-old", "C:\\work\\app", 5, { taskId: "old" as TaskId, pinned: true })];
    const timeline = buildTimeline(input({ tasks, sessions: [...sessions, past("lib", "E:/other/lib", 90)] }));
    expect(ids(timeline)).toEqual(["task:old", "session:lib", "task:new"]);
    expect(timeline[0]!.pinned).toBe(true);
    const folders = buildFolders(input({ tasks, sessions: [...sessions, past("lib", "E:/other/lib", 90)] }));
    expect(folders.map((folder) => [folder.label, ids(folder.items)])).toEqual([
      ["lib", ["session:lib"]],
      ["app", ["task:old", "task:new"]],
      ["empty", []],
    ]);
  });

  it("默认文件夹永远排第一，不管多久没动；没记下顺序的文件夹按最近活动；搜索时没有匹配行就不显示", () => {
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

  it("移出列表的项目：它的任务和同一目录（路径写法不同也算）的历史会话都不列，文件夹也不出现；别的文件夹不受影响", () => {
    const base = input({
      projects: [project("p1", "C:\\work\\app", "app", true), project("p2", "C:\\work\\lib", "lib")],
      tasks: [task("running", "p1", { status: "running", updatedAt: 9 }), task("t2", "p2", { updatedAt: 3 })],
      sessions: [past("s-app", "c:/work/APP/", 8), past("s-lib", "C:\\work\\lib", 7)],
    });
    expect(buildFolders(base).map((f) => [f.label, ids(f.items)])).toEqual([["lib", ["session:s-lib", "task:t2"]]]);
    expect(ids(buildTimeline(base))).toEqual(["session:s-lib", "task:t2"]);
  });

  it('归档的会话不在文件夹和时间线里，只在"已归档"里（按最近活动，可搜索）', () => {
    const sessions = [
      past("live", "E:/x", 5),
      past("arch-old", "E:/x", 1, { archived: true, title: "旧的 数据" }),
      past("arch-new", "E:/y", 9, { archived: true, title: "新的" }),
    ];
    expect(ids(buildTimeline(input({ sessions })))).toEqual(["session:live"]);
    expect(buildFolders(input({ sessions })).flatMap((f) => ids(f.items))).toEqual(["session:live"]);
    expect(ids(buildArchived({ sessions, query: "" }))).toEqual(["session:arch-new", "session:arch-old"]);
    expect(ids(buildArchived({ sessions, query: "数据" }))).toEqual(["session:arch-old"]);
  });

  it("分叉缩进在原会话后面（原会话是任务行或历史行都行），一组按组里最新的一行排位、兄弟也按各自一组最新的；原会话不在列表里就照常顶层", () => {
    const tasks = [task("root", "p1", { updatedAt: 10 }), task("fork-task", "p1", { updatedAt: 80 })];
    const sessions = [
      // 挂在任务上的会话不单列，只提供任务行的会话 id 和父会话。
      past("s-root", "C:\\work\\app", 10, { taskId: "root" as TaskId }),
      past("s-fork-task", "C:\\work\\app", 80, { taskId: "fork-task" as TaskId, parentId: "s-root" }),
      past("fork-a", "C:\\work\\app", 50, { parentId: "s-root" }),
      past("grand", "C:\\work\\app", 90, { parentId: "fork-a" }),
      past("orphan", "C:\\work\\app", 40, { parentId: "missing" }),
    ];
    const depths = (items: readonly SidebarItem[]) => items.map((item) => [item.key, item.depth]);
    // root 自己最旧（10），但它下面的 grand（90）最新：整组排在 orphan（40）前面；fork-a 一组（90）排在 fork-task（80）前面。
    const expected = [
      ["task:root", 0],
      ["session:fork-a", 1],
      ["session:grand", 2],
      ["task:fork-task", 1],
      ["session:orphan", 0],
    ];
    expect(depths(buildTimeline(input({ tasks, sessions })))).toEqual(expected);
    expect(depths(buildFolders(input({ tasks, sessions }))[0]!.items)).toEqual(expected);
    // 原会话被搜索过滤掉：分叉回到顶层。
    expect(depths(buildTimeline(input({ tasks, sessions, query: "fork-a" })))).toEqual([["session:fork-a", 0]]);
  });

  it("父子成环（会话文件被手改过）时每行仍只出现一次，不死循环", () => {
    const sessions = [past("a", "E:/x", 2, { parentId: "b" }), past("b", "E:/x", 1, { parentId: "a" })];
    expect(ids(buildTimeline(input({ sessions }))).sort()).toEqual(["session:a", "session:b"]);
  });

  it("一直在用的分叉不被旧的原会话拖到后面：整组排在中间那些会话前面", () => {
    const sessions = [
      past("old", "E:/x", 1),
      ...Array.from({ length: 5 }, (_, i) => past(`mid${i}`, "E:/x", 2 + i)),
      past("fork", "E:/x", 100, { parentId: "old" }),
    ];
    expect(ids(buildTimeline(input({ sessions }))).slice(0, 3)).toEqual([
      "session:old",
      "session:fork",
      "session:mid4",
    ]);
  });

  it("里面只剩归档会话的项目（归档一条历史会话时目录被加成项目）不列空文件夹；新打开的空项目、默认文件夹照常列", () => {
    const notes = project("pn", "E:\\notes", "notes");
    const sessions = [past("gone", "e:/notes/", 3, { archived: true })];
    expect(buildFolders(input({ projects: [notes, ...projects], sessions })).map((f) => f.label)).toEqual([
      "app",
      "empty",
    ]);
    expect(buildFolders(input({ projects: [notes], sessions, defaultCwd: "E:/notes" })).map((f) => f.label)).toEqual([
      "notes",
    ]);
  });

  describe("收起分叉（foldForks）", () => {
    // root（任务）← fork-a（会话）← grand（会话）；root ← fork-task（任务）；orphan 顶层。
    const tasks = [task("root", "p1", { updatedAt: 10 }), task("fork-task", "p1", { updatedAt: 80 })];
    const sessions = [
      past("s-root", "C:\\work\\app", 10, { taskId: "root" as TaskId }),
      past("s-fork-task", "C:\\work\\app", 80, { taskId: "fork-task" as TaskId, parentId: "s-root" }),
      past("fork-a", "C:\\work\\app", 50, { parentId: "s-root" }),
      past("grand", "C:\\work\\app", 90, { parentId: "fork-a" }),
      past("orphan", "C:\\work\\app", 40),
    ];
    const items = buildTimeline(input({ tasks, sessions }));

    it("每行记着缩进在哪一行下面；默认全部展开，有分叉的行给出全部后代行数", () => {
      expect(items.map((item) => [item.key, item.parent])).toEqual([
        ["task:root", null],
        ["session:fork-a", "task:root"],
        ["session:grand", "session:fork-a"],
        ["task:fork-task", "task:root"],
        ["session:orphan", null],
      ]);
      const folded = foldForks(items, new Set(), null);
      expect(folded.items).toBe(items);
      expect([...folded.forks]).toEqual([
        ["task:root", { total: 3, hidden: 0 }],
        ["session:fork-a", { total: 1, hidden: 0 }],
      ]);
    });

    it("收起一行藏起它下面整棵分叉，并记下藏了几行；收起里层只藏里层", () => {
      const outer = foldForks(items, new Set(["task:root"]), null);
      expect(ids(outer.items)).toEqual(["task:root", "session:orphan"]);
      expect(outer.forks.get("task:root")).toEqual({ total: 3, hidden: 3 });
      const inner = foldForks(items, new Set(["session:fork-a"]), null);
      expect(ids(inner.items)).toEqual(["task:root", "session:fork-a", "task:fork-task", "session:orphan"]);
      expect(inner.forks.get("session:fork-a")).toEqual({ total: 1, hidden: 1 });
      expect(inner.forks.get("task:root")).toEqual({ total: 3, hidden: 0 });
    });

    it("选中 / 在跑 / 等你确认的分叉和通往它的上级照常显示，同一收起行下面别的分叉照样藏着", () => {
      const deep = buildTimeline(
        input({
          tasks: [
            task("top", "p1", { updatedAt: 1 }),
            task("mid", "p1", { updatedAt: 2 }),
            task("leaf", "p1", { updatedAt: 3, status: "running" }),
          ],
          sessions: [
            past("s-top", "E:/x", 1, { taskId: "top" as TaskId }),
            past("s-mid", "E:/x", 2, { taskId: "mid" as TaskId, parentId: "s-top" }),
            past("s-leaf", "E:/x", 3, { taskId: "leaf" as TaskId, parentId: "s-mid" }),
            past("other", "E:/x", 1, { parentId: "s-top" }),
          ],
        }),
      );
      const running = foldForks(deep, new Set(["task:top", "task:mid"]), null);
      expect(ids(running.items)).toEqual(["task:top", "task:mid", "task:leaf"]);
      expect(running.forks.get("task:top")).toEqual({ total: 3, hidden: 1 });
      expect(running.forks.get("task:mid")).toEqual({ total: 1, hidden: 0 });
      // 选中的任务同理（这里 fork-task 是选中的那一个）。
      const selected = foldForks(items, new Set(["task:root"]), "fork-task" as TaskId);
      expect(ids(selected.items)).toEqual(["task:root", "task:fork-task", "session:orphan"]);
    });

    it('"显示更多"只数收起后还看得见的行', () => {
      const shown = visibleItems(items, 1, null, new Set(["task:root"]));
      expect(ids(shown.shown)).toEqual(["task:root"]);
      expect(shown.remaining).toBe(1);
      expect(visibleItems(items, 1, null, new Set()).remaining).toBe(4);
    });
  });
});
