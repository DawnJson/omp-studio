// 防的是：渲染进程（被注入时）借 openTaskFile / revealTaskFile 打开任务目录之外的文件，或直接执行 agent 写的脚本。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canOpenDirectly, resolveInside, resolveInsideReal } from "../src/main/ipc/task-file-path.ts";

let root = "";
let cwd = "";
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "任务 目录-"));
  cwd = path.join(root, "项目 a");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.ts"), "x");
  await writeFile(path.join(root, "secret.txt"), "s");
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("路径必须落在任务目录内", () => {
  it("相对路径（含空格和中文的 cwd）解析到 cwd 之内", () => {
    expect(resolveInside(cwd, "src/a.ts")).toBe(path.join(cwd, "src", "a.ts"));
    expect(resolveInside(cwd, "src\\a.ts")).toBe(path.join(cwd, "src", "a.ts"));
  });
  it("绝对路径、盘符、.. 越界、空串都被拒", () => {
    for (const bad of [
      "",
      "C:\\Windows\\win.ini",
      "/etc/passwd",
      "..\\secret.txt",
      "src/../../secret.txt",
      ".",
      "a\0b",
    ]) {
      expect(() => resolveInside(cwd, bad), bad).toThrow();
    }
  });
  it("符号链接指到目录外时被拒（需要创建链接的权限，没有则跳过）", async () => {
    const link = path.join(cwd, "link.txt");
    try {
      await symlink(path.join(root, "secret.txt"), link, "file");
    } catch {
      return;
    }
    await expect(resolveInsideReal(cwd, "link.txt")).rejects.toThrow();
    await expect(resolveInsideReal(cwd, "src/a.ts")).resolves.toContain("a.ts");
  });
});

describe("只有白名单扩展名才直接打开", () => {
  it("脚本、程序、快捷方式、冷门可执行类和无扩展名文件只能在文件夹中显示", () => {
    for (const name of [
      "x.exe",
      "a.BAT",
      "b.ps1",
      "c.js",
      "d.lnk",
      "e.py",
      "e.pyw",
      "f.pif",
      "g.scf",
      "h.msc",
      "i.chm",
      "j.settingcontent-ms",
      "k.sh",
      "l.html",
      "m.svg",
      "Makefile",
      ".env",
      "n.jar",
      "o.docm",
    ]) {
      expect(canOpenDirectly(name), name).toBe(false);
    }
  });
  it("文本、代码、图片、文档可以打开", () => {
    for (const name of ["a.ts", "b.MD", "c.png", "d.json", "e.pdf", "f.rs"])
      expect(canOpenDirectly(name), name).toBe(true);
  });
});
