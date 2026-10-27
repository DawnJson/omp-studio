import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { collectTreePids, parsePsTable } from "../src/main/platform/posix/process-tree.ts";
import { watchdogCommand } from "../src/main/platform/posix/watchdog.ts";

describe("parsePsTable", () => {
  it("解析 ps 输出：多个空格、前导空格、空行和 CRLF 都不影响", () => {
    const output = "    1     0     1\n  100     1   100\r\n\n 2001   100   100  \n";
    expect(parsePsTable(output)).toEqual([
      { pid: 1, ppid: 0, pgid: 1 },
      { pid: 100, ppid: 1, pgid: 100 },
      { pid: 2001, ppid: 100, pgid: 100 },
    ]);
  });

  it("对不上格式的行（表头、报错）跳过，不抛错", () => {
    expect(parsePsTable("  PID  PPID  PGID\nps: something odd\n  7  1  7\n")).toEqual([{ pid: 7, ppid: 1, pgid: 7 }]);
    expect(parsePsTable("")).toEqual([]);
  });
});

describe("collectTreePids", () => {
  const SELF = 9000;

  it("多层后代都在，兄弟分支和无关进程不在", () => {
    const rows = parsePsTable(`
      1     0     1
    100     1   100
    101   100   100
    102   101   102
    103   102   102
    200     1   200
    201   200   200
  `);
    expect(collectTreePids(rows, 101, SELF).sort((a, b) => a - b)).toEqual([101, 102, 103]);
  });

  it("根是组长：父进程先死后被 launchd 收养、但留在组里的孙进程也要杀", () => {
    const rows = parsePsTable(`
    100     1   100
    105     1   100
    106   105   106
    300     1   300
  `);
    expect(collectTreePids(rows, 100, SELF).sort((a, b) => a - b)).toEqual([100, 105, 106]);
  });

  it("根不是组长：不动它所在的组（那可能是 Electron 自己的组）", () => {
    const rows = parsePsTable(`
    500     1   500
    501   500   500
    502   500   500
    503   502   500
  `);
    expect(collectTreePids(rows, 502, SELF)).toEqual([502, 503]);
  });

  it("根已经不在表里：只要组里还有成员，照样找出来；一个都没有就只剩根自己", () => {
    const rows = parsePsTable(`
    105     1   100
    300     1   300
  `);
    expect(collectTreePids(rows, 100, SELF).sort((a, b) => a - b)).toEqual([100, 105]);
    expect(collectTreePids(rows, 777, SELF)).toEqual([777]);
  });

  it("结果里永远没有主进程自己、pid 0 和 1", () => {
    const rows = parsePsTable(`
      1     0     1
    100     1   100
   9000   100   100
   9001  9000   100
  `);
    expect(collectTreePids(rows, 100, SELF)).toEqual([100, 9001]);
    expect(collectTreePids(rows, SELF, SELF)).toEqual([]);
    expect(collectTreePids(rows, 1, SELF)).toEqual([]);
  });

  it("ppid 成环的脏数据不会死循环", () => {
    const rows = [
      { pid: 10, ppid: 11, pgid: 10 },
      { pid: 11, ppid: 10, pgid: 10 },
    ];
    expect(collectTreePids(rows, 10, SELF).sort((a, b) => a - b)).toEqual([10, 11]);
  });
});

describe("watchdogCommand", () => {
  it("参数是数组里的整数，不拼进脚本", () => {
    const { file, args } = watchdogCommand(4242, 5151);
    expect(file).toBe("/bin/sh");
    expect(args.slice(0, 2)).toEqual(["-c", expect.any(String)]);
    expect(args[1]).not.toContain("4242");
    expect(args.slice(-2)).toEqual(["4242", "5151"]);
  });

  it("pid 不是正整数、或是 0/1 时拒绝（kill -KILL -1 会杀掉用户的所有进程）", () => {
    expect(() => watchdogCommand(4242, 1)).toThrow();
    expect(() => watchdogCommand(4242, 0)).toThrow();
    expect(() => watchdogCommand(4242, Number.NaN)).toThrow();
    expect(() => watchdogCommand(1, 5151)).toThrow();
  });
});

/** 等子进程结束，返回结束它的信号（正常退出时是 null）。 */
function exitSignal(child: ChildProcess): Promise<NodeJS.Signals | null> {
  return new Promise((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
}

/**
 * 看门狗至少跑完了一轮检查：它的 `sleep 1` 子进程起来了，说明前面的 `kill -s 0 -- -<组>` 已经执行过（组在就记下 seen）。
 * 脚本里有 sh 不认的命令时它在这之前就退出，这里永远等不到。
 */
function dogChecked(dog: ChildProcess): boolean {
  return execFileSync("ps", ["-A", "-o", "ppid=,comm="], { encoding: "utf8" })
    .split("\n")
    .some((line) => {
      const [ppid, command] = line.trim().split(/\s+/);
      return Number(ppid) === dog.pid && command !== undefined && command.endsWith("sleep");
    });
}

// 真的跑一遍看门狗脚本（Linux 上是 dash，mac 上是 bash）：脚本里一条命令不被这个 sh 接受，看门狗就会直接退出、兜底失效。
describe.skipIf(process.platform === "win32")("看门狗脚本", () => {
  it("主进程没了：杀掉整个进程组", async () => {
    const main = spawn("sleep", ["30"], { stdio: "ignore" });
    const group = spawn("sleep", ["30"], { stdio: "ignore", detached: true });
    const groupExit = exitSignal(group);
    const { file, args } = watchdogCommand(main.pid!, group.pid!);
    const dog = spawn(file, args, { stdio: "ignore", detached: true });
    try {
      // 先让它见到这个组（跑完一轮检查），再结束"主进程"。
      await expect.poll(() => dogChecked(dog), { timeout: 5000 }).toBe(true);
      main.kill("SIGKILL");
      expect(await groupExit).toBe("SIGKILL");
    } finally {
      for (const child of [main, group, dog]) child.kill("SIGKILL");
    }
  });

  it("主进程没了：组里进程的后代自己开了进程组（omp 的 bash 工具就这样起命令）也一起杀掉", async () => {
    const main = spawn("sleep", ["30"], { stdio: "ignore" });
    // 组长起一个 detached（自己的会话和进程组）的孙进程，把它的 pid 打出来。
    const group = spawn(
      process.execPath,
      [
        "-e",
        "const c = require('node:child_process').spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1e6);",
      ],
      { stdio: ["ignore", "pipe", "ignore"], detached: true },
    );
    const grandchild = await new Promise<number>((resolve) =>
      group.stdout!.once("data", (data) => resolve(Number(String(data).trim()))),
    );
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const { file, args } = watchdogCommand(main.pid!, group.pid!);
    const dog = spawn(file, args, { stdio: "ignore", detached: true });
    try {
      await expect.poll(() => dogChecked(dog), { timeout: 5000 }).toBe(true);
      main.kill("SIGKILL");
      await expect.poll(() => alive(grandchild), { timeout: 5000 }).toBe(false);
    } finally {
      for (const child of [main, group, dog]) child.kill("SIGKILL");
      if (alive(grandchild)) process.kill(grandchild, "SIGKILL");
    }
  });

  it("进程组自己结束了：看门狗也退出，不碰主进程", async () => {
    const main = spawn("sleep", ["30"], { stdio: "ignore" });
    const group = spawn("sleep", ["1"], { stdio: "ignore", detached: true });
    const { file, args } = watchdogCommand(main.pid!, group.pid!);
    const dog = spawn(file, args, { stdio: "ignore", detached: true });
    const dogExit = new Promise<number | null>((resolve) => dog.once("exit", (code) => resolve(code)));
    try {
      expect(await dogExit).toBe(0);
      expect(main.exitCode).toBeNull();
      expect(main.signalCode).toBeNull();
    } finally {
      for (const child of [main, group, dog]) child.kill("SIGKILL");
    }
  });
});
