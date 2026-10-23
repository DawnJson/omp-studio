// OSC 7501（omp 的程序状态）→ 任务状态、结局；OSC 7 → 工作目录；节点补判断（loader、模态弹窗）。
// 字节和状态序列来自真实 omp 18.12.6 的实测（docs/architecture/tsp-migration.md §7，2026-10-23）；节点用 fixtures/tsp 的录制逐帧验证。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { cwdFromFileUri } from "../src/shared/tsp/osc7.ts";
import {
  NO_RUN_SIGNAL,
  applyRunStatus,
  beginRun,
  blockedOpen,
  observeGate,
  parseRunStatus,
  turnResult,
  type RunSignal,
  type RunStatusMessage,
} from "../src/shared/tsp/run-status.ts";
import { deriveTaskStatus, resolveTaskStatus, type TspStatusInfo } from "../src/shared/tsp/task-status.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

const b64 = (text: string) => Buffer.from(text).toString("base64");

function fold(...bodies: string[]): RunSignal {
  return bodies.reduce((signal, body) => {
    const message = parseRunStatus(body) as RunStatusMessage;
    return applyRunStatus(signal, message);
  }, NO_RUN_SIGNAL);
}

const idleNodes: TspStatusInfo = { status: "idle", working: false, ask: null, loader: null, modal: null };

describe("parseRunStatus：真实 omp 的 wire", () => {
  it("working / idle / done 没有 kind 和 msg", () => {
    expect(parseRunStatus("state=working:app=omp")).toEqual({ state: "working", kind: null, msg: null });
    expect(parseRunStatus("state=idle:app=omp")).toEqual({ state: "idle", kind: null, msg: null });
    expect(parseRunStatus("state=done:app=omp")).toEqual({ state: "done", kind: null, msg: null });
  });

  it("blocked：kind 区分提问和审批，msg 是 base64 UTF-8（审批的 msg 末尾可能带 = 填充）", () => {
    expect(parseRunStatus(`state=blocked:kind=question:app=omp:msg=${b64("Pick a color 选一个")}`)).toEqual({
      state: "blocked",
      kind: "question",
      msg: "Pick a color 选一个",
    });
    // 实测：QWxsb3cgdG9vbDogYmFzaCBDb21tYW5kOiBlY2hvIGdhdGUtdGVzdA== = "Allow tool: bash Command: echo gate-test"
    expect(
      parseRunStatus(
        "state=blocked:kind=permission:app=omp:msg=QWxsb3cgdG9vbDogYmFzaCBDb21tYW5kOiBlY2hvIGdhdGUtdGVzdA==",
      ),
    ).toEqual({ state: "blocked", kind: "permission", msg: "Allow tool: bash Command: echo gate-test" });
  });

  it("error 带错误原文；clear 表示 omp 不再报告；认不出的状态为 null", () => {
    expect(parseRunStatus(`state=error:app=omp:msg=${b64("Couldn't connect to api.deepseek.com")}`)).toEqual({
      state: "error",
      kind: null,
      msg: "Couldn't connect to api.deepseek.com",
    });
    expect(parseRunStatus("state=clear")).toEqual({ state: "clear" });
    expect(parseRunStatus("state=attention")).toBeNull();
    expect(parseRunStatus("garbage")).toBeNull();
  });
});

describe("一轮的结局（turnResult）", () => {
  it("done → 完成；error → 出错并带 omp 的原文；idle（Esc）→ 被中断，不看用户有没有按停止", () => {
    expect(turnResult(fold("state=working", "state=done"), false)).toEqual({ status: "completed" });
    expect(turnResult(fold("state=working", "state=done"), true)).toEqual({ status: "completed" });
    expect(turnResult(fold("state=working", `state=error:msg=${b64("401 bad key")}`), false)).toEqual({
      status: "error",
      message: "401 bad key",
    });
    expect(turnResult(fold("state=working", "state=idle"), false)).toEqual({ status: "aborted" });
  });

  it("这一轮没收到过 7501 的结局（交接等只有 loader 的运行、没开 programStatus）：看用户有没有按停止", () => {
    expect(turnResult(NO_RUN_SIGNAL, false)).toEqual({ status: "completed" });
    expect(turnResult(NO_RUN_SIGNAL, true)).toEqual({ status: "aborted" });
  });

  it("上一轮的结局不能算到下一轮头上：working 和节点推导的开始（beginRun）都会清掉", () => {
    const aborted = fold("state=working", "state=idle");
    expect(turnResult(aborted, false)).toEqual({ status: "aborted" });
    expect(turnResult(beginRun(aborted), false)).toEqual({ status: "completed" });
    expect(turnResult(applyRunStatus(aborted, { state: "working", kind: null, msg: null }), false)).toEqual({
      status: "completed",
    });
  });

  it("blocked 不结束这一轮", () => {
    const signal = fold("state=working", `state=blocked:kind=question:msg=${b64("q")}`);
    expect(signal.ended).toBeNull();
  });
});

describe("resolveTaskStatus：7501 为主，节点补判断，没收到过 7501 就退回节点", () => {
  it("working 比 omp.working 那一帧早：节点还是空闲时 7501 已经让任务 running", () => {
    expect(resolveTaskStatus(idleNodes, fold("state=working"))).toMatchObject({ status: "running", working: true });
    expect(resolveTaskStatus(idleNodes, fold("state=working", "state=done"))).toMatchObject({
      status: "idle",
      working: false,
    });
  });

  it("没收到过 7501（terminal.programStatus 关了、或 clear 之后）：只看节点", () => {
    const running: TspStatusInfo = { ...idleNodes, status: "running", working: true };
    expect(resolveTaskStatus(running, NO_RUN_SIGNAL).status).toBe("running");
    expect(resolveTaskStatus(idleNodes, NO_RUN_SIGNAL).status).toBe("idle");
    expect(resolveTaskStatus(running, fold("state=working", "state=clear")).status).toBe("running");
  });

  it("blocked：kind=question → 提问，kind=permission → 审批，msg 第一行是标题；门节点晚几毫秒到也不抖", () => {
    const question = fold("state=working", `state=blocked:kind=question:msg=${b64("Pick a color\nmore")}`);
    expect(resolveTaskStatus(idleNodes, question)).toMatchObject({
      status: "needs_you",
      working: true,
      waiting: { kind: "question", title: "Pick a color" },
    });
    const permission = fold("state=blocked:kind=permission:msg=" + b64("Allow tool: bash Command: ls"));
    expect(resolveTaskStatus(idleNodes, permission).waiting).toEqual({
      kind: "approval",
      title: "Allow tool: bash Command: ls",
    });
    // 门节点到了：以节点的标题和类型为准。
    const gate: TspStatusInfo = {
      ...idleNodes,
      status: "needs_you",
      ask: { title: "Allow tool: bash", approval: true },
    };
    expect(resolveTaskStatus(gate, permission).waiting).toEqual({ kind: "approval", title: "Allow tool: bash" });
  });

  it("审批通过后 omp 的 7501 一直是 blocked 直到工具结束（实测批准后 14 秒）：门节点出现又消失 = 已答，回到 running", () => {
    const blocked = fold("state=working", `state=blocked:kind=permission:msg=${b64("Allow tool: bash")}`);
    const gate: TspStatusInfo = {
      ...idleNodes,
      status: "needs_you",
      ask: { title: "Allow tool: bash", approval: true },
    };
    const shown = observeGate(blocked, true);
    expect(blockedOpen(shown, true)).toBe(true);
    expect(blockedOpen(shown, false)).toBe(false);
    expect(resolveTaskStatus(gate, shown).status).toBe("needs_you");
    const answered = resolveTaskStatus(idleNodes, shown);
    expect(answered).toMatchObject({ status: "running", working: true, waiting: null });
    // 工具结束，7501 回到 working，之后 done。
    expect(resolveTaskStatus(idleNodes, applyRunStatus(shown, { state: "done", kind: null, msg: null })).status).toBe(
      "idle",
    );
  });

  it("loader（交接、建 worktree 等 7501 不报的忙）算 running；节点补的运行不被 7501 的 done 盖掉", () => {
    const loading: TspStatusInfo = { ...idleNodes, status: "running", working: true, loader: "Creating worktree…" };
    expect(resolveTaskStatus(loading, fold("state=working", "state=done")).status).toBe("running");
  });

  it("模态弹窗算 needs_you，没有 7501 也一样", () => {
    const modal: TspStatusInfo = { ...idleNodes, status: "needs_you", modal: { title: "Goal objective" } };
    expect(resolveTaskStatus(modal, NO_RUN_SIGNAL).waiting).toEqual({ kind: "modal", title: "Goal objective" });
    expect(resolveTaskStatus(modal, fold("state=idle")).status).toBe("needs_you");
  });
});

/** 录制逐帧重放，返回状态变化的步骤（用于核对补判断）。 */
function replayNodes(name: string) {
  const doc = createDocument();
  return tspDocMessages(loadTspFixture(name)).map(({ message }) => {
    applyMessage(doc, message);
    return deriveTaskStatus(doc);
  });
}

describe("节点补判断：真实录制", () => {
  it("session-tree-summarize：分支摘要期间 dock 里有 omp.loader（omp 18.12.5 录制第 7–8 帧），算 running，文字去掉图标字形", () => {
    const steps = replayNodes("session-tree-summarize");
    const loading = steps.filter((step) => step.loader !== null);
    expect(loading.length).toBeGreaterThan(0);
    for (const step of loading) {
      expect(step).toMatchObject({ status: "running", working: true });
      expect(step.loader).toMatch(/^Summarizing branch/);
      // 私用区的按键图标不进文字。
      expect(step.loader).not.toMatch(/[\uE000-\uF8FF]/u);
    }
    expect(steps.at(-1)).toMatchObject({ status: "idle", loader: null });
  });

  it("goal-budget / goal-drop：扩展的输入弹窗（omp.overlay.hook-editor）开着是 needs_you，带标题；关了回到原状态", () => {
    for (const name of ["goal-budget", "goal-drop"]) {
      const steps = replayNodes(name);
      const modal = steps.filter((step) => step.modal !== null);
      expect(modal.length).toBeGreaterThan(0);
      expect(modal.every((step) => step.status === "needs_you")).toBe(true);
      expect(modal.map((step) => step.modal?.title)).toContain(
        name === "goal-budget" ? "Goal budget (number, `off`, or empty to cancel)" : "Goal objective",
      );
      // 弹窗里不是门：输入框的提问判断（gate.ts）不受影响。
      expect(modal.every((step) => step.ask === null)).toBe(true);
    }
  });

  it("studio 自己驱动的弹窗（/jobs、context 报告、Agent Hub、旁路提问）不是 needs_you", () => {
    for (const name of [
      "jobs-chart",
      "jobs-kill",
      "context-report",
      "hub-steer",
      "hub-kill",
      "btw",
      "btw-error",
      "btw-stop",
    ])
      expect(replayNodes(name).some((step) => step.modal !== null || step.status === "needs_you")).toBe(false);
  });
});

describe("OSC 7 → 工作目录", () => {
  it("真实 omp 18.12.6 在 Windows 上的写法：主机名 + /盘符:/…，空格和中文是 UTF-8 百分号编码", () => {
    expect(
      cwdFromFileUri(
        "file://DESKTOP-AB12CD3/C:/Users/someone/AppData/Local/Temp/omp%20work%20a1%20UdOn6r/%E7%9B%AE%E5%BD%95%20two",
        "win32",
      ),
    ).toBe("C:\\Users\\someone\\AppData\\Local\\Temp\\omp work a1 UdOn6r\\目录 two");
    expect(cwdFromFileUri("file://H/E:/work/code/omp-studio", "win32")).toBe(
      "E:\\work\\code\\omp-studio",
    );
    expect(cwdFromFileUri("file://H/C:/", "win32")).toBe("C:\\");
  });

  it("没有盘符：本机（空主机或 localhost）是当前盘根下的路径，别的主机是 UNC", () => {
    expect(cwdFromFileUri("file:///work/a%20b", "win32")).toBe("\\work\\a b");
    expect(cwdFromFileUri("file://server/share/dir%20x", "win32")).toBe("\\\\server\\share\\dir x");
  });

  it("其他平台：路径原样解码", () => {
    expect(cwdFromFileUri("file://host/home/me/%E9%A1%B9%E7%9B%AE%20one", "linux")).toBe("/home/me/项目 one");
  });

  it("不是 file URI 或百分号编码损坏：null", () => {
    expect(cwdFromFileUri("http://x/y", "win32")).toBeNull();
    expect(cwdFromFileUri("file://h/C:/%E0%A4%A", "win32")).toBeNull();
  });
});
