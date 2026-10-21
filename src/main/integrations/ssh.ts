// 设置 → 集成 → SSH 主机：`omp ssh list|add|remove`（omp 18.12.5 的 CLI，没有 rpc 命令）。读写都只经 omp 自己的命令，不直接改 ssh.json。
// 参数用数组、值一律写成 `--flag=value`：omp 的命令行解析会把 `-` 开头的值当成缺参（实测 `--desc - x` 报 ambiguous）。
// 项目范围的主机在项目目录里跑（`.omp/ssh.json`），用户范围在中性目录里跑。

import {
  parseSshList,
  sshWriteResult,
  type SshHost,
  type SshHostInput,
  type SshScope,
} from "../../shared/omp-output/ssh.ts";
import type { RunOmp } from "../usage/usage-service.ts";

const NAME = /^[A-Za-z0-9._-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

class SshInputError extends Error {
  override name = "SshInputError";
}

function singleLine(value: string, label: string, maxChars: number): string {
  if (value.trim() === "" || value.length > maxChars || CONTROL.test(value))
    throw new SshInputError(`${label} is invalid`);
  return value;
}

/** 地址和用户名最终会交给 ssh：不允许空白，也不允许以 `-` 开头（否则会被 ssh 当成选项）。 */
function sshWord(value: string, label: string): string {
  if (!/^[^\s-]\S{0,254}$/.test(value) || CONTROL.test(value)) throw new SshInputError(`${label} is invalid`);
  return value;
}

export function checkSshName(name: string): string {
  if (!NAME.test(name)) throw new SshInputError("name may only contain letters, digits, . _ -");
  return name;
}

/** 添加主机的 CLI 参数（不含 `omp`）。校验失败抛错，不改写输入。 */
export function sshAddArgs(input: SshHostInput): string[] {
  const args = ["ssh", "add", checkSshName(input.name), `--host=${sshWord(input.host, "host")}`];
  if (input.username !== undefined && input.username !== "") args.push(`--user=${sshWord(input.username, "user")}`);
  if (input.port !== undefined) {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
      throw new SshInputError("port must be 1-65535");
    args.push(`--port=${input.port}`);
  }
  if (input.keyPath !== undefined && input.keyPath !== "") args.push(`--key=${singleLine(input.keyPath, "key", 1024)}`);
  if (input.description !== undefined && input.description !== "")
    args.push(`--desc=${singleLine(input.description, "description", 500)}`);
  if (input.compat) args.push("--compat");
  args.push(`--scope=${input.scope}`, "--json");
  return args;
}

export function sshRemoveArgs(name: string, scope: SshScope): string[] {
  return ["ssh", "remove", checkSshName(name), `--scope=${scope}`, "--json"];
}

/** 用户范围 + （run 的 cwd 是项目目录时）该项目的主机。 */
export async function listSshHosts(run: RunOmp): Promise<SshHost[]> {
  const result = await run(["ssh", "list", "--json"]);
  // 列表出错也走 stdout（`Error: …`），按写操作同一套规则取原话。
  if (result.code !== 0) sshWriteResult(result);
  return parseSshList(result.stdout);
}

export async function runSshWrite(run: RunOmp, args: string[]): Promise<string> {
  return sshWriteResult(await run(args));
}
