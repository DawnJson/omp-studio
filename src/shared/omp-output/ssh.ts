// `omp ssh ... --json` 的输出解析（omp 18.12.5，样本见 test/omp-output-integrations.test.ts）。
// 实测的形状：
// - `ssh list --json`：`{"project":{<名>:{host,username?,port?,keyPath?,description?,compat?}},"user":{…}}`（两个范围都在，project 取决于 cwd）。
// - `add` / `remove` 即使带 `--json` 也只输出一句话（`Added SSH host "x" to user config`）。
// - 出错时退出码 1，**错误写在 stdout**：`Error: Host "x" already exists in …`；命令行解析错误才写 stderr。

export type SshScope = "user" | "project";

export interface SshHost {
  name: string;
  scope: SshScope;
  host: string;
  username?: string;
  port?: number;
  keyPath?: string;
  description?: string;
  compat: boolean;
}

/** 添加主机的输入（渲染进程 → 主进程）。不填的可选项用 omp 的默认值（端口 22）。 */
export interface SshHostInput {
  name: string;
  host: string;
  username?: string;
  port?: number;
  keyPath?: string;
  description?: string;
  compat: boolean;
  scope: SshScope;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 解析 `ssh list --json`；形状不对抛错（界面显示原文）。 */
export function parseSshList(stdout: string): SshHost[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`omp ssh list did not print JSON: ${stdout.trim().slice(0, 300)}`);
  }
  const top = record(parsed);
  if (top === null) throw new Error("omp ssh list: expected a JSON object");
  const hosts: SshHost[] = [];
  for (const scope of ["user", "project"] as const) {
    const group = record(top[scope]);
    if (group === null) throw new Error(`omp ssh list: missing "${scope}"`);
    for (const [name, entry] of Object.entries(group)) {
      const fields = record(entry);
      if (fields === null || typeof fields["host"] !== "string") throw new Error(`omp ssh list: bad entry "${name}"`);
      const { username, port, keyPath, description } = fields;
      hosts.push({
        name,
        scope,
        host: fields["host"],
        ...(typeof username === "string" && { username }),
        ...(typeof port === "number" && { port }),
        ...(typeof keyPath === "string" && { keyPath }),
        ...(typeof description === "string" && { description }),
        compat: fields["compat"] === true,
      });
    }
  }
  return hosts;
}

/** 写操作的结果：成功返回 omp 的一句话，失败抛带原话的错（去掉 `Error: ` 前缀）。 */
export function sshWriteResult(result: { code: number; stdout: string; stderr: string }): string {
  const out = result.stdout.trim();
  if (result.code === 0) return out;
  const stderr = result.stderr.trim();
  const message = (out !== "" ? out : stderr).replace(/^Error:\s*/, "");
  throw new Error(message !== "" ? message : `omp ssh exited with code ${result.code}`);
}
