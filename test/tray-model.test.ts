import { describe, expect, it } from "vitest";
import type { TaskId, TaskState } from "../src/shared/ipc.ts";
import {
  trayCounts,
  trayMenuTemplate,
  trayTaskLimit,
  trayTooltip,
  type TrayActions,
} from "../src/main/window/tray-model.ts";

const task = (id: string, status: TaskState["status"], title = id) => ({ id: id as TaskId, status, title });

function actions() {
  const calls: string[] = [];
  const handlers: TrayActions = {
    open: () => calls.push("open"),
    focusTask: (id) => calls.push(`focus:${id}`),
    quit: () => calls.push("quit"),
  };
  return { calls, handlers };
}

describe("托盘提示的任务计数", () => {
  it("starting 和 running 算在跑，needs_you 算等你确认，idle / error / stopped 都不算", () => {
    const counts = trayCounts([
      { status: "starting" },
      { status: "running" },
      { status: "running" },
      { status: "needs_you" },
      { status: "idle" },
      { status: "error" },
      { status: "stopped" },
    ]);
    expect(counts).toEqual({ running: 3, waiting: 1 });
  });

  it("没有任务在忙时提示只有应用名；否则带计数，中英各自的文案", () => {
    expect(trayTooltip("zh-CN", { running: 0, waiting: 0 })).toBe("omp-studio");
    expect(trayTooltip("zh-CN", { running: 2, waiting: 1 })).toBe("omp-studio · 2 个运行中，1 个等你确认");
    expect(trayTooltip("en", { running: 2, waiting: 1 })).toBe("omp-studio · 2 running, 1 waiting for you");
  });
});

describe("托盘右键菜单模板", () => {
  it("没有任务在忙：打开 / 摘要（灰）/ 退出；点击分别触发对应动作", () => {
    const { calls, handlers } = actions();
    const menu = trayMenuTemplate("zh-CN", [task("a", "idle")], handlers);
    expect(menu.map((item) => item.label ?? "-")).toEqual(["打开 omp-studio", "-", "没有任务在运行", "-", "退出"]);
    expect(menu[2]?.enabled).toBe(false);
    menu[0]?.click?.();
    menu[4]?.click?.();
    expect(calls).toEqual(["open", "quit"]);
  });

  it("在忙的任务逐条列出，点击定位到该任务；标题里的 & 转义，没有标题用占位", () => {
    const { calls, handlers } = actions();
    const menu = trayMenuTemplate(
      "en",
      [task("a", "running", "Fix & test"), task("b", "needs_you", ""), task("c", "idle")],
      handlers,
    );
    const labels = menu.map((item) => item.label ?? "-");
    expect(labels[2]).toBe("1 running, 1 waiting for you");
    expect(labels[3]).toBe("Running · Fix && test");
    expect(labels[4]).toMatch(/^Waiting for you · \S/);
    expect(labels).toHaveLength(7);
    menu[4]?.click?.();
    expect(calls).toEqual(["focus:b"]);
  });

  it("最多列出 trayTaskLimit 条，摘要里的计数仍是全部", () => {
    const { handlers } = actions();
    const many = Array.from({ length: trayTaskLimit + 3 }, (_, index) => task(`t${index}`, "running"));
    const menu = trayMenuTemplate("zh-CN", many, handlers);
    expect(menu).toHaveLength(5 + trayTaskLimit);
    expect(menu[2]?.label).toBe(`${trayTaskLimit + 3} 个运行中，0 个等你确认`);
  });
});
