// TaskCommand / BuiltinCommand → 命令文本：格式是 omp 18.12.5 实测的（native-ui-plan §2.1/§2.2）；渲染进程传来的值要被拒绝得干净。
import { describe, expect, it } from "vitest";
import {
  builtinCommandText,
  commandName,
  parseBuiltinCommand,
  parseTaskCommand,
  taskCommandText,
  type TaskCommand,
} from "../src/shared/omp-output/index.ts";

describe("taskCommandText", () => {
  const cases: [TaskCommand, string][] = [
    [{ kind: "toggle", name: "skillful", on: true }, "/skillful on"],
    [{ kind: "toggle", name: "extendedContext", on: false }, "/extended-context off"],
    [{ kind: "toggle", name: "computer", on: true }, "/computer on"],
    [{ kind: "toggle", name: "advisor", on: false }, "/advisor off"],
    [{ kind: "toggle", name: "fast", on: true }, "/fast on"],
    [{ kind: "pin" }, "/pin"],
    [{ kind: "retry" }, "/retry"],
    [{ kind: "compact" }, "/compact"],
    [{ kind: "jobsKill", id: "bg_1" }, "/jobs kill bg_1"],
    [{ kind: "jobsKill", id: "all" }, "/jobs kill all"],
    [{ kind: "reloadPlugins" }, "/reload-plugins"],
    [{ kind: "dirs" }, "/dirs"],
    [{ kind: "addDir", path: "C:\\work\\my dir" }, "/add-dir C:\\work\\my dir"],
    [{ kind: "removeDir", path: "/tmp/x" }, "/remove-dir /tmp/x"],
    [{ kind: "modelPreset", op: "list" }, "/modelpreset list"],
    [{ kind: "modelPreset", op: "save", name: "fast-1" }, "/modelpreset save fast-1"],
    [{ kind: "modelPreset", op: "switch", name: "my preset" }, "/modelpreset switch my preset"],
    [{ kind: "browserMode", mode: "headless" }, "/browser headless"],
    [{ kind: "prewalk", op: "arm" }, "/prewalk"],
    [{ kind: "prewalk", op: "restart" }, "/prewalk restart"],
  ];
  it.each(cases)("%j → %s（解析后不变）", (cmd, text) => {
    expect(taskCommandText(cmd)).toBe(text);
    expect(parseTaskCommand(JSON.parse(JSON.stringify(cmd)))).toEqual(cmd);
  });

  it("拒绝未知 kind、坏字段、带换行的路径", () => {
    expect(() => parseTaskCommand({ kind: "exec", cmd: "rm -rf" })).toThrow(/unknown task command/);
    expect(() => parseTaskCommand({ kind: "toggle", name: "nope", on: true })).toThrow();
    expect(() => parseTaskCommand({ kind: "toggle", name: "skillful", on: "yes" })).toThrow();
    expect(() => parseTaskCommand({ kind: "jobsKill", id: "bg_1 /pin" })).toThrow();
    expect(() => parseTaskCommand({ kind: "addDir", path: "/a\n/compact" })).toThrow();
    expect(() => parseTaskCommand({ kind: "modelPreset", op: "save", name: "a b" })).toThrow();
    expect(() => parseTaskCommand({ kind: "modelPreset", op: "switch", name: "a  b" })).toThrow();
    expect(() => parseTaskCommand({ kind: "modelPreset", op: "delete", name: " a" })).toThrow();
    expect(() => parseTaskCommand(null)).toThrow();
    expect(() => taskCommandText({ kind: "addDir", path: "/a\r/b" })).toThrow();
  });
});

describe("builtinCommandText", () => {
  it("tools / session / changelog / memory / mcp list", () => {
    expect(builtinCommandText({ kind: "tools" })).toBe("/tools");
    expect(builtinCommandText({ kind: "session" })).toBe("/session");
    expect(builtinCommandText({ kind: "changelog" })).toBe("/changelog");
    expect(builtinCommandText({ kind: "memory", op: "stats" })).toBe("/memory stats");
    expect(builtinCommandText({ kind: "mcp", op: "list" })).toBe("/mcp list");
    expect(builtinCommandText({ kind: "mcp", op: "remove", name: "demo", scope: "user" })).toBe(
      "/mcp remove demo --scope user",
    );
  });

  it("拒绝未知 kind 和坏参数", () => {
    expect(() => parseBuiltinCommand({ kind: "unpin" })).toThrow(/unknown builtin command/);
    expect(() => parseBuiltinCommand({ kind: "memory", op: "enqueue" })).toThrow();
    expect(() => parseBuiltinCommand({ kind: "mcp", op: "remove", name: "a b", scope: "user" })).toThrow();
    expect(parseBuiltinCommand({ kind: "memory", op: "view" })).toEqual({ kind: "memory", op: "view" });
  });
});

describe("commandName", () => {
  it("取斜杠后的第一个词", () => {
    expect(commandName("/mcp list")).toBe("mcp");
    expect(commandName("/tools")).toBe("tools");
    expect(() => commandName("tools")).toThrow();
  });
});
