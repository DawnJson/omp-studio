import { describe, expect, it, vi } from "vitest";
import type { TaskId } from "../src/shared/ipc.ts";
import {
  TerminalCwdMissingError,
  TerminalManager,
  type PtyLike,
  type TerminalDeps,
} from "../src/main/terminal/terminal-manager.ts";

const task = (id: string) => id as TaskId;

class FakePty implements PtyLike {
  killed = false;
  written: string[] = [];
  size = { cols: 0, rows: 0 };
  #data: ((data: string) => void)[] = [];
  #exit: ((event: { exitCode: number }) => void)[] = [];
  readonly pid: number;
  constructor(pid: number) {
    this.pid = pid;
  }
  onData(listener: (data: string) => void) {
    this.#data.push(listener);
    return { dispose: () => void (this.#data = this.#data.filter((l) => l !== listener)) };
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.#exit.push(listener);
    return { dispose: () => void (this.#exit = this.#exit.filter((l) => l !== listener)) };
  }
  write(data: string) {
    this.written.push(data);
  }
  resize(cols: number, rows: number) {
    this.size = { cols, rows };
  }
  kill() {
    this.killed = true;
  }
  emit(data: string) {
    for (const listener of this.#data) listener(data);
  }
  exit(exitCode: number) {
    for (const listener of this.#exit) listener({ exitCode });
  }
}

function setup(overrides: Partial<TerminalDeps> = {}) {
  const ptys: FakePty[] = [];
  const data: [string, string][] = [];
  const exits: [string, number][] = [];
  const jobs: number[] = [];
  const killed: number[] = [];
  const deps: TerminalDeps = {
    taskCwd: (id) => `/work/${id}`,
    directoryExists: async () => true,
    resolveShell: () => ({ file: "/bin/sh", args: [], name: "sh" }),
    buildEnv: () => ({ A: "1" }),
    killTree: async (pid) => void killed.push(pid),
    spawn: async (_shell, options) => {
      const pty = new FakePty(100 + ptys.length);
      pty.size = { cols: options.cols, rows: options.rows };
      ptys.push(pty);
      return pty;
    },
    assignJob: (pid) => void jobs.push(pid),
    emitData: (id, d) => void data.push([id, d]),
    emitExit: (id, code) => void exits.push([id, code]),
    onError: () => undefined,
    ...overrides,
  };
  return { manager: new TerminalManager(deps), ptys, data, exits, jobs, killed };
}

describe("TerminalManager", () => {
  it("在任务目录起 shell，按 cols/rows 创建，并放进 Job", async () => {
    const { manager, ptys, jobs } = setup();
    const result = await manager.open(task("t1"), 100, 30);
    expect(result).toEqual({ cwd: "/work/t1", shell: "sh", reopened: false, backlog: "" });
    expect(ptys[0]?.size).toEqual({ cols: 100, rows: 30 });
    expect(jobs).toEqual([100]);
  });

  it("目录不存在时拒绝，不起 shell", async () => {
    const { manager, ptys } = setup({ directoryExists: async () => false });
    await expect(manager.open(task("t1"), 80, 24)).rejects.toBeInstanceOf(TerminalCwdMissingError);
    expect(ptys).toHaveLength(0);
  });

  it("任务不存在（taskCwd 抛错）时拒绝", async () => {
    const { manager } = setup({
      taskCwd: () => {
        throw new Error("unknown task");
      },
    });
    await expect(manager.open(task("nope"), 80, 24)).rejects.toThrow("unknown task");
  });

  it("assignJob 失败只记日志，终端照常可用", async () => {
    const onError = vi.fn();
    const { manager } = setup({
      assignJob: () => {
        throw new Error("job");
      },
      onError,
    });
    await expect(manager.open(task("t1"), 80, 24)).resolves.toMatchObject({ reopened: false });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("输出按批发出，再次 open 复用同一个 pty，返回 backlog，未发出的批次不重复", async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, data } = setup();
      await manager.open(task("t1"), 80, 24);
      ptys[0]?.emit("a");
      ptys[0]?.emit("b");
      expect(data).toEqual([]);
      vi.advanceTimersByTime(20);
      expect(data).toEqual([["t1", "ab"]]);
      ptys[0]?.emit("c");
      const again = await manager.open(task("t1"), 120, 40);
      expect(again).toMatchObject({ reopened: true, backlog: "abc" });
      expect(ptys).toHaveLength(1);
      expect(ptys[0]?.size).toEqual({ cols: 120, rows: 40 });
      vi.advanceTimersByTime(50);
      expect(data).toEqual([["t1", "ab"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("并发 open 同一任务只起一个 shell", async () => {
    const { manager, ptys } = setup();
    const [a, b] = await Promise.all([manager.open(task("t1"), 80, 24), manager.open(task("t1"), 80, 24)]);
    expect(a).toBe(b);
    expect(ptys).toHaveLength(1);
  });

  it("不同任务各有一个 shell", async () => {
    const { manager, ptys } = setup();
    await manager.open(task("t1"), 80, 24);
    await manager.open(task("t2"), 80, 24);
    expect(ptys).toHaveLength(2);
  });

  it("write / resize 转给 pty；没有终端时静默忽略", async () => {
    const { manager, ptys } = setup();
    manager.write(task("none"), "x");
    manager.resize(task("none"), 10, 10);
    await manager.open(task("t1"), 80, 24);
    manager.write(task("t1"), "ls\r");
    manager.resize(task("t1"), 90, 33);
    expect(ptys[0]?.written).toEqual(["ls\r"]);
    expect(ptys[0]?.size).toEqual({ cols: 90, rows: 33 });
  });

  it("shell 自己退出：先发出剩余输出，再发 exit，之后 open 起新的", async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, data, exits } = setup();
      await manager.open(task("t1"), 80, 24);
      ptys[0]?.emit("bye");
      ptys[0]?.exit(3);
      expect(data).toEqual([["t1", "bye"]]);
      expect(exits).toEqual([["t1", 3]]);
      expect(manager.has(task("t1"))).toBe(false);
      const fresh = await manager.open(task("t1"), 80, 24);
      expect(fresh).toMatchObject({ reopened: false, backlog: "" });
      expect(ptys).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("主动 close 杀掉 pty，不发 exit 事件，也不再转发输出", async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, data, exits, killed } = setup();
      await manager.open(task("t1"), 80, 24);
      ptys[0]?.emit("pending");
      const closing = manager.close(task("t1"));
      // 状态同步摘掉：之后到的输出和退出都不再转发。
      expect(manager.has(task("t1"))).toBe(false);
      await closing;
      expect(killed).toEqual([100]);
      expect(ptys[0]?.killed).toBe(true);
      ptys[0]?.emit("late");
      ptys[0]?.exit(1);
      vi.advanceTimersByTime(50);
      expect(data).toEqual([]);
      expect(exits).toEqual([]);
      expect(manager.has(task("t1"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("正在起的时候 close：起好后立刻结束，不留孤儿", async () => {
    const release = Promise.withResolvers<void>();
    const { manager, ptys } = setup({
      spawn: async () => {
        await release.promise;
        const pty = new FakePty(7);
        ptys.push(pty);
        return pty;
      },
    });
    const opened = manager.open(task("t1"), 80, 24);
    const closing = manager.close(task("t1"));
    release.resolve();
    await opened;
    await closing;
    expect(ptys[0]?.killed).toBe(true);
    expect(manager.has(task("t1"))).toBe(false);
  });

  it("closeAll 结束全部", async () => {
    const { manager, ptys } = setup();
    await manager.open(task("t1"), 80, 24);
    await manager.open(task("t2"), 80, 24);
    await manager.closeAll();
    expect(ptys.every((pty) => pty.killed)).toBe(true);
  });
});
