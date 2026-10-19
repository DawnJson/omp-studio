// 导出 HTML 的落盘记录：目标必须是 .html；omp 回传的路径和主进程给它的 target 不一致时不记录；任务移除时清掉。
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskId } from "../src/shared/ipc.ts";
import { exportedFile, exportTarget, forgetExport, recordExport } from "../src/main/tasks/export-record.ts";

const task = "task-export" as TaskId;

describe("exportTarget", () => {
  it("只认 .html：.htm 和没有扩展名的都补 .html，大小写不论", () => {
    expect(exportTarget("C:\\out\\a.html")).toBe("C:\\out\\a.html");
    expect(exportTarget("C:\\out\\a.HTML")).toBe("C:\\out\\a.HTML");
    expect(exportTarget("C:\\out\\a.htm")).toBe("C:\\out\\a.htm.html");
    expect(exportTarget("C:\\out\\a")).toBe("C:\\out\\a.html");
  });
});

describe("recordExport", () => {
  const target = path.resolve("exports", "chat.html");

  it("omp 返回的路径不是主进程给的 target：不记录", () => {
    expect(recordExport(task, target, path.resolve("elsewhere", "chat.html"))).toBe(false);
    expect(exportedFile(task)).toBeUndefined();
  });

  it("返回的路径解析后等于 target：记录的是 target", () => {
    expect(recordExport(task, target, path.join(path.dirname(target), ".", "chat.html"))).toBe(true);
    expect(exportedFile(task)).toBe(target);
  });

  it("任务移除后记录被清掉", () => {
    recordExport(task, target, target);
    forgetExport(task);
    expect(exportedFile(task)).toBeUndefined();
  });
});
