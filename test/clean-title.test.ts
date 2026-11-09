import { describe, expect, it } from "vitest";
import { looksLikeConsoleTitle } from "../src/shared/ui/clean-title.ts";

describe("looksLikeConsoleTitle（issue #9：误存成任务标题的 Windows 控制台标题）", () => {
  it.each([
    "C:\\WINDOWS\\system32\\cmd.exe",
    "Administrator: C:\\Windows\\system32\\cmd.exe",
    "管理员: C:\\WINDOWS\\system32\\cmd.exe",
    "C:\\Windows\\system32\\cmd.exe - npm  run build",
    "C:\\Program Files\\nodejs\\node.exe",
    "D:\\tools\\build.bat",
    "Windows PowerShell",
    "管理员: Windows PowerShell",
    "Administrator: C:\\Windows\\system32\\cmd.exe (fork)",
    "管理员: C:\\WINDOWS\\system32\\cmd.exe（分叉）（分叉）",
  ])("认作控制台标题：%s", (title) => {
    expect(looksLikeConsoleTitle(title)).toBe(true);
  });

  it.each([
    "",
    "Chat with Coding Agent",
    "我的任务",
    "修复 C: 盘空间不足的问题",
    "把 C:\\Users\\me\\notes.txt 整理一下",
    "Run C:\\Windows\\system32\\cmd.exe and check",
    "cmd.exe",
    "PowerShell 脚本改造",
    "GIT: Rebase custom-trim-v2",
  ])("不是控制台标题：%s", (title) => {
    expect(looksLikeConsoleTitle(title)).toBe(false);
  });
});
