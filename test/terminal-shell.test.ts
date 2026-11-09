import { describe, expect, it } from "vitest";
import { parseTerminalInput, parseTerminalSize } from "../src/main/terminal/input.ts";
import {
  buildTerminalEnv,
  detectShells,
  resolveShell,
  shellArgs,
  ShellMissingError,
} from "../src/main/terminal/shell.ts";

const none = () => false;

describe("resolveShell", () => {
  it("Windows：PATH 上有 pwsh 就用它", () => {
    const shell = resolveShell(
      {
        platform: "win32",
        env: {},
        which: (name) => (name === "pwsh.exe" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : null),
        exists: none,
      },
      null,
    );
    expect(shell).toEqual({ file: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", args: ["-NoLogo"], name: "pwsh.exe" });
  });

  it("Windows：没有 pwsh 用 PATH 上的 powershell.exe", () => {
    const shell = resolveShell(
      {
        platform: "win32",
        env: {},
        which: (name) => (name === "powershell.exe" ? "C:\\x\\powershell.exe" : null),
        exists: none,
      },
      null,
    );
    expect(shell.file).toBe("C:\\x\\powershell.exe");
    expect(shell.name).toBe("powershell.exe");
  });

  it("Windows：PATH 上两个都没有，退到 SystemRoot 下的 Windows PowerShell", () => {
    const shell = resolveShell(
      { platform: "win32", env: { SystemRoot: "D:\\Win" }, which: () => null, exists: none },
      null,
    );
    expect(shell.file).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it("其他平台：$SHELL 带 -l 作登录 shell，没有就 /bin/bash", () => {
    const probe = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => ({
      platform,
      env,
      which: () => null,
      exists: none,
    });
    expect(resolveShell(probe({ SHELL: "/usr/bin/zsh" }, "linux"), null)).toEqual({
      file: "/usr/bin/zsh",
      args: ["-l"],
      name: "zsh",
    });
    expect(resolveShell(probe({ SHELL: "/bin/zsh" }, "darwin"), null)).toEqual({
      file: "/bin/zsh",
      args: ["-l"],
      name: "zsh",
    });
    expect(resolveShell(probe({}, "darwin"), null).file).toBe("/bin/bash");
  });

  it("设置里选了 shell：用它，参数按文件名", () => {
    const probe = { platform: "win32" as const, env: {}, which: () => "C:\\pwsh.exe", exists: () => true };
    expect(resolveShell(probe, "C:\\Windows\\System32\\cmd.exe")).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: [],
      name: "cmd.exe",
    });
    expect(resolveShell(probe, "C:\\Program Files\\Git\\bin\\bash.exe").args).toEqual(["--login", "-i"]);
  });

  it("设置里选的 shell 不在了：报错，不悄悄换回默认", () => {
    const probe = { platform: "win32" as const, env: {}, which: () => "C:\\pwsh.exe", exists: none };
    expect(() => resolveShell(probe, "D:\\gone\\bash.exe")).toThrow(ShellMissingError);
  });
});

describe("shellArgs", () => {
  it("按文件名定参数，大小写和 .exe 不影响", () => {
    expect(shellArgs("win32", "C:\\x\\PWSH.EXE")).toEqual(["-NoLogo"]);
    expect(shellArgs("win32", "C:\\x\\powershell.exe")).toEqual(["-NoLogo"]);
    expect(shellArgs("win32", "C:\\x\\wsl.exe")).toEqual([]);
    expect(shellArgs("linux", "/usr/bin/fish")).toEqual(["-l"]);
    expect(shellArgs("darwin", "/bin/bash")).toEqual(["-l"]);
    expect(shellArgs("linux", "/usr/bin/nu")).toEqual([]);
  });
});

describe("detectShells", () => {
  it("Windows：只列存在的，按顺序，同一路径只列一次；Git Bash 从 git.exe 往上找", () => {
    const present = new Set(
      [
        "C:\\PS7\\pwsh.exe",
        "C:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "C:\\Win\\System32\\cmd.exe",
        "C:\\Git\\bin\\bash.exe",
      ].map((file) => file.toLowerCase()),
    );
    const options = detectShells({
      platform: "win32",
      env: { SystemRoot: "C:\\Win", ComSpec: "C:\\WIN\\System32\\cmd.exe" },
      which: (name) => ({ "pwsh.exe": "C:\\PS7\\pwsh.exe", "git.exe": "C:\\Git\\cmd\\git.exe" })[name] ?? null,
      exists: (file) => present.has(file.toLowerCase()),
      etcShells: () => "",
    });
    expect(options.map((option) => option.name)).toEqual([
      "PowerShell",
      "Windows PowerShell",
      "Command Prompt",
      "Git Bash",
    ]);
    expect(options[3]?.path.toLowerCase()).toBe("c:\\git\\bin\\bash.exe");
  });

  it("其他平台：/etc/shells 里列着且存在的", () => {
    const options = detectShells({
      platform: "linux",
      env: {},
      which: () => null,
      exists: (file) => file !== "/bin/missing",
      etcShells: () => "# comment\n/bin/bash\n/bin/missing\n\n/usr/bin/zsh\n/bin/bash\n",
    });
    expect(options).toEqual([
      { name: "bash", path: "/bin/bash" },
      { name: "zsh", path: "/usr/bin/zsh" },
    ]);
  });
});

describe("buildTerminalEnv", () => {
  it("去掉 undefined、设 TERM，自管 omp 的 bin 放在 PATH 最前", () => {
    // Windows 的环境变量名是 Path(大小写不敏感),POSIX 只认 PATH。
    const [key, sep] = process.platform === "win32" ? ["Path", ";"] : ["PATH", ":"];
    const env = buildTerminalEnv({ [key]: `a${sep}b`, KEEP: "1", GONE: undefined }, "managed-bin");
    expect(env[key]).toBe(`managed-bin${sep}a${sep}b`);
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
