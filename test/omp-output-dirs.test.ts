// `/dirs` `/add-dir` `/remove-dir` 输出解析。样本是 omp 18.12.5 的实测原文：rpc-ui `command_output`（Windows，用户目录替换成 C:\Users\u）和
// TSP 状态 toast（tsp-slash-overlays-18.12.5.jsonl 的 /dirs、/add-dir、/remove-dir 三条）。
import { describe, expect, it } from "vitest";
import { parseDirsOutput } from "../src/shared/omp-output/dirs.ts";
import { parseTaskCommand, taskCommandText } from "../src/shared/omp-output/index.ts";

const T = "C:\\Users\\u\\AppData\\Local\\Temp\\s7probe";

describe("parseDirsOutput（omp 18.12.5）", () => {
  it("/dirs 只有工作目录", () => {
    expect(parseDirsOutput(`Workspace directories:\n  ${T}\\work (working directory)`)).toEqual({
      kind: "dirs",
      cwd: `${T}\\work`,
      dirs: [],
      notice: null,
    });
  });

  it("成功添加：带空格、中文、单引号的路径原样保留，顺序按 omp", () => {
    const out = parseDirsOutput(
      `Added ${T}\\it's a dir.\nWorkspace directories:\n  ${T}\\work (working directory)\n  ${T}\\my dir\n  ${T}\\中文 目录\n  ${T}\\it's a dir`,
    );
    expect(out).toEqual({
      kind: "dirs",
      cwd: `${T}\\work`,
      dirs: [`${T}\\my dir`, `${T}\\中文 目录`, `${T}\\it's a dir`],
      notice: { kind: "added", path: `${T}\\it's a dir` },
    });
  });

  it("成功移除", () => {
    const out = parseDirsOutput(`Removed ${T}\\中文 目录.\nWorkspace directories:\n  ${T}\\work (working directory)`);
    expect(out).toMatchObject({ kind: "dirs", dirs: [], notice: { kind: "removed", path: `${T}\\中文 目录` } });
  });

  it("TSP toast：/add-dir 不带参数 = 用法 + 列表；/remove-dir 不带参数只有用法", () => {
    expect(
      parseDirsOutput(`Usage: /add-dir <path>\nWorkspace directories:\n  ${T}\\proj (working directory)`),
    ).toMatchObject({ kind: "dirs", cwd: `${T}\\proj`, notice: { kind: "usage", text: "Usage: /add-dir <path>" } });
    expect(parseDirsOutput("Usage: /remove-dir <path>")).toMatchObject({ kind: "rejected", reason: "usage" });
  });

  it("拒绝：不存在 / 已存在 / 不是工作区目录（包括被引号包住时 omp 按相对路径解析的结果）", () => {
    expect(parseDirsOutput(`Directory does not exist: ${T}\\nope`)).toEqual({
      kind: "rejected",
      reason: "missing",
      path: `${T}\\nope`,
      message: `Directory does not exist: ${T}\\nope`,
    });
    expect(parseDirsOutput(`Already in the workspace: ${T}\\my dir`)).toMatchObject({ reason: "already" });
    expect(parseDirsOutput(`Not a workspace directory: ${T}\\work\\"${T}\\中文 目录"`)).toMatchObject({
      reason: "not-member",
    });
  });

  it("行尾换行和 CRLF 不影响", () => {
    expect(parseDirsOutput("Workspace directories:\r\n  /w (working directory)\r\n  /a b\r\n")).toMatchObject({
      cwd: "/w",
      dirs: ["/a b"],
    });
  });

  it("(working directory) 后缀只对第一行（cwd）去掉", () => {
    const out = parseDirsOutput("Workspace directories:\n  /w (working directory)\n  /x (working directory)");
    expect(out).toMatchObject({ kind: "dirs", cwd: "/w", dirs: ["/x (working directory)"] });
  });

  it("认不出的输出原样返回，不猜", () => {
    for (const text of [
      "",
      "Plugins reloaded.",
      "Workspace directories:",
      "Workspace directories:\n  /w",
      "Workspace directories:\nno indent (working directory)",
      "Surprise\nWorkspace directories:\n  /w (working directory)",
    ])
      expect(parseDirsOutput(text)).toEqual({ kind: "unparsed", text });
  });
});

describe("addDir / removeDir 命令文本（不能加引号：omp 会把引号当成路径的一部分）", () => {
  it("路径整行拼在命令名之后，空格和中文原样", () => {
    expect(taskCommandText({ kind: "addDir", path: "C:\\用户\\我的 项目" })).toBe("/add-dir C:\\用户\\我的 项目");
    expect(taskCommandText({ kind: "removeDir", path: "/home/a b/c" })).toBe("/remove-dir /home/a b/c");
  });

  it("换行和控制字符被拒绝（否则会变成第二条命令）", () => {
    for (const path of ["a\n/pin", "a\r/pin", "a\u0000b", "   ", ""]) {
      expect(() => parseTaskCommand({ kind: "addDir", path })).toThrow();
      expect(() => taskCommandText({ kind: "removeDir", path })).toThrow();
    }
  });
});
