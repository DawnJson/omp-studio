import { describe, expect, it } from "vitest";
import { parseTerminalInput, parseTerminalSize } from "../src/main/terminal/input.ts";
import { buildTerminalEnv, resolveShell } from "../src/main/terminal/shell.ts";

describe("resolveShell", () => {
  it("Windows：PATH 上有 pwsh 就用它", () => {
    const shell = resolveShell({
      platform: "win32",
      env: {},
      which: (name) => (name === "pwsh.exe" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : null),
    });
    expect(shell).toEqual({ file: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", args: ["-NoLogo"], name: "pwsh.exe" });
  });

  it("Windows：没有 pwsh 用 PATH 上的 powershell.exe", () => {
    const shell = resolveShell({
      platform: "win32",
      env: {},
      which: (name) => (name === "powershell.exe" ? "C:\\x\\powershell.exe" : null),
    });
    expect(shell.file).toBe("C:\\x\\powershell.exe");
    expect(shell.name).toBe("powershell.exe");
  });

  it("Windows：PATH 上两个都没有，退到 SystemRoot 下的 Windows PowerShell", () => {
    const shell = resolveShell({ platform: "win32", env: { SystemRoot: "D:\\Win" }, which: () => null });
    expect(shell.file).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it("其他平台：$SHELL 带 -l 作登录 shell，没有就 /bin/bash", () => {
    expect(resolveShell({ platform: "linux", env: { SHELL: "/usr/bin/zsh" }, which: () => null })).toEqual({
      file: "/usr/bin/zsh",
      args: ["-l"],
      name: "zsh",
    });
    expect(resolveShell({ platform: "darwin", env: { SHELL: "/bin/zsh" }, which: () => null })).toEqual({
      file: "/bin/zsh",
      args: ["-l"],
      name: "zsh",
    });
    expect(resolveShell({ platform: "darwin", env: {}, which: () => null }).file).toBe("/bin/bash");
  });
});

describe("buildTerminalEnv", () => {
  it("去掉 undefined、设 TERM，自管 omp 的 bin 放在 PATH 最前", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const env = buildTerminalEnv({ Path: `a${sep}b`, KEEP: "1", GONE: undefined }, "managed-bin");
    expect(env["Path"]).toBe(`managed-bin${sep}a${sep}b`);
    expect(env["KEEP"]).toBe("1");
    expect("GONE" in env).toBe(false);
    expect(env["TERM"]).toBe("xterm-256color");
  });

  it("没有自管 omp 时 PATH 不变", () => {
    expect(buildTerminalEnv({ PATH: "a" }, null)["PATH"]).toBe("a");
  });
});

describe("终端输入校验", () => {
  it("尺寸必须是 2–1000 的整数", () => {
    expect(parseTerminalSize(80, 24)).toEqual({ cols: 80, rows: 24 });
    expect(parseTerminalSize(2, 1000)).toEqual({ cols: 2, rows: 1000 });
    for (const bad of [1, 1001, 80.5, "80", null, Number.NaN]) {
      expect(() => parseTerminalSize(bad, 24)).toThrow();
      expect(() => parseTerminalSize(80, bad)).toThrow();
    }
  });

  it("输入必须是非空字符串且不超过上限，控制字符照放行", () => {
    expect(parseTerminalInput("\u0003")).toBe("\u0003");
    expect(parseTerminalInput("ls\r")).toBe("ls\r");
    expect(() => parseTerminalInput("")).toThrow();
    expect(() => parseTerminalInput(1)).toThrow();
    expect(() => parseTerminalInput("x".repeat(65_537))).toThrow();
    expect(parseTerminalInput("x".repeat(65_536))).toHaveLength(65_536);
  });
});
