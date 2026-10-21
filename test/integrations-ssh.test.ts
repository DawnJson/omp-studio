// SSH 主机的命令行参数和读写（src/main/integrations/ssh.ts）：参数用数组、值写成 `--flag=value`（omp 18.12.5 会把 `-` 开头的值当缺参）。
import { describe, expect, it } from "vitest";
import { listSshHosts, runSshWrite, sshAddArgs, sshRemoveArgs } from "../src/main/integrations/ssh.ts";
import type { RunOmp } from "../src/main/usage/usage-service.ts";

describe("sshAddArgs", () => {
  it("全部字段：值一律 --flag=value，带空格和引号的原样放进一个参数", () => {
    expect(
      sshAddArgs({
        name: "box",
        host: "127.0.0.1",
        username: "me",
        port: 2222,
        keyPath: "C:\\Users\\me\\.ssh\\id rsa",
        description: 'my box, with "quotes"',
        compat: true,
        scope: "user",
      }),
    ).toEqual([
      "ssh",
      "add",
      "box",
      "--host=127.0.0.1",
      "--user=me",
      "--port=2222",
      "--key=C:\\Users\\me\\.ssh\\id rsa",
      '--desc=my box, with "quotes"',
      "--compat",
      "--scope=user",
      "--json",
    ]);
  });

  it("只有必填项", () => {
    expect(sshAddArgs({ name: "pbox", host: "10.0.0.1", compat: false, scope: "project" })).toEqual([
      "ssh",
      "add",
      "pbox",
      "--host=10.0.0.1",
      "--scope=project",
      "--json",
    ]);
  });

  it("说明以 - 开头也行（=形式）", () => {
    expect(sshAddArgs({ name: "a", host: "h", description: "- dash start", compat: false, scope: "user" })).toContain(
      "--desc=- dash start",
    );
  });

  it("拒绝：名字不合法、地址或用户名以 - 开头或含空白、端口越界、说明里有换行", () => {
    const base = { name: "a", host: "h", compat: false, scope: "user" as const };
    expect(() => sshAddArgs({ ...base, name: "bad name" })).toThrow(/name/);
    expect(() => sshAddArgs({ ...base, host: "-oProxyCommand=x" })).toThrow(/host/);
    expect(() => sshAddArgs({ ...base, host: "a b" })).toThrow(/host/);
    expect(() => sshAddArgs({ ...base, username: "-l" })).toThrow(/user/);
    expect(() => sshAddArgs({ ...base, port: 0 })).toThrow(/port/);
    expect(() => sshAddArgs({ ...base, port: 99999 })).toThrow(/port/);
    expect(() => sshAddArgs({ ...base, description: "a\nb" })).toThrow(/description/);
  });
});

describe("sshRemoveArgs", () => {
  it("名字和范围", () => {
    expect(sshRemoveArgs("box", "project")).toEqual(["ssh", "remove", "box", "--scope=project", "--json"]);
    expect(() => sshRemoveArgs("../x", "user")).toThrow(/name/);
  });
});

describe("读写（假 omp）", () => {
  it("list：解析 JSON；退出码非 0 时用 stdout 里的 `Error:` 原话抛出", async () => {
    const ok: RunOmp = () =>
      Promise.resolve({ code: 0, stdout: '{"project":{},"user":{"a":{"host":"h"}}}', stderr: "" });
    expect(await listSshHosts(ok)).toEqual([{ name: "a", scope: "user", host: "h", compat: false }]);
    const bad: RunOmp = () => Promise.resolve({ code: 1, stdout: "Error: boom\n", stderr: "" });
    await expect(listSshHosts(bad)).rejects.toThrow(/^boom$/);
  });

  it("写：成功返回 omp 的一句话，失败带原话", async () => {
    const calls: string[][] = [];
    const run: RunOmp = (args) => {
      calls.push(args);
      return Promise.resolve(
        args.includes("--host=dup")
          ? { code: 1, stdout: 'Error: Host "x" already exists in C:\\agent\\ssh.json\n', stderr: "" }
          : { code: 0, stdout: 'Added SSH host "x" to user config\n', stderr: "" },
      );
    };
    expect(await runSshWrite(run, ["ssh", "add", "x", "--host=h"])).toBe('Added SSH host "x" to user config');
    await expect(runSshWrite(run, ["ssh", "add", "x", "--host=dup"])).rejects.toThrow(/already exists/);
    expect(calls).toHaveLength(2);
  });
});
