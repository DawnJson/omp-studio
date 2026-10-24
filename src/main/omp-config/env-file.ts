// omp agent 目录的 `.env`（omp 启动时读进进程环境，omp://providers.md「.env discovery」）：自定义 provider 的
// `apiKey: 变量名` 引用的 key 写在这里。仓库所有者 2026-10-24 同意的例外（AGENTS.md「omp 的边界」）：
// - 只改一个变量的那一行（新增追加到末尾，删除删掉它的行），注释、空行、别的变量、`export` 前缀、CRLF、BOM 原样；
// - 改完用 `util.parseEnv`（和 omp 同一种语法）重新解析核对：别的变量的值一个都不能变、这个变量就是要写的值，
//   对不上（比如原来是跨行的引号值）就不写，返回 unsafe-env；
// - 原子写，写前留 `.env.bak`；和 models.yml 的写入在同一个队列里（models-file.ts 负责调度）；
// - key 只进不出：读出的只有变量名，日志里不出现值。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import type { EnvSource } from "../../shared/custom-models.ts";

export function envFilePath(agentDir: string): string {
  return path.join(agentDir, ".env");
}

/** `.env` 的原文；不存在时 null。 */
export async function readEnvText(agentDir: string): Promise<string | null> {
  try {
    return await readFile(envFilePath(agentDir), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** `.env` 解析出的变量（只给主进程内部用：拉取模型时解析 key，不经 IPC 返回）。 */
export function envValues(text: string | null): Record<string, string> {
  if (text === null) return {};
  return Object.fromEntries(
    Object.entries(parseEnv(stripBom(text))).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * 一个变量名的值从哪来（omp 的优先级：进程里非空的变量 > `.env`；空值不算设置）。
 * studio 起 omp 时把自己的进程环境原样传下去，所以 studio 的 process.env 就是 omp 看到的系统环境变量。
 */
export function envSourceOf(text: string | null): (name: string) => EnvSource {
  const values = envValues(text);
  return (name) => {
    const fromProcess = process.env[name];
    if (fromProcess !== undefined && fromProcess !== "") return "system";
    const fromFile = values[name];
    return fromFile !== undefined && fromFile !== "" ? "env-file" : "missing";
  };
}

export type EnvEdit = { ok: true; text: string } | { ok: false };

function lineOf(name: string): RegExp {
  // name 已校验过只含 [A-Za-z0-9_]，不用转义。
  return new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
}

/** 这一行的值以引号开头、同一行里没有收尾的引号：值跨到后面几行，只改这一行会留下半截。 */
function opensMultiline(line: string): boolean {
  const rest = line.slice(line.indexOf("=") + 1).trimStart();
  const quote = rest[0];
  return (quote === '"' || quote === "'" || quote === "`") && !rest.includes(quote, 1);
}

/** 写成 parseEnv 读回来正好是 value 的样子：能不加引号就不加，否则双引号，再不行单引号。 */
function candidates(value: string): string[] {
  return [value, `"${value}"`, `'${value}'`];
}

type Parsed = Readonly<Record<string, string | undefined>>;

function sameExcept(before: Parsed, after: Parsed, name: string): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete(name);
  for (const key of keys) if (before[key] !== after[key]) return false;
  return true;
}

/** 把 `name` 设成 `value`：已有的行就地改（保留 `export`），有多行只留第一行；没有就追加到末尾。 */
export function setEnvLine(text: string | null, name: string, value: string): EnvEdit {
  const original = text ?? "";
  const bom = original.charCodeAt(0) === 0xfeff;
  const source = stripBom(original);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const before = parseEnv(source);
  const match = lineOf(name);
  for (const written of candidates(value)) {
    const lines = source === "" ? [] : source.split(/\r?\n/);
    if (lines.some((line) => match.test(line) && opensMultiline(line))) return { ok: false };
    const first = lines.findIndex((line) => match.test(line));
    let next: string[];
    if (first === -1) {
      // 末尾是换行时 split 出来最后一项是空串：新行插在它前面，文件照旧以换行结尾。
      const endsWithEol = lines.length > 0 && lines[lines.length - 1] === "";
      const body = endsWithEol ? lines.slice(0, -1) : lines;
      next = [...body, `${name}=${written}`, ""];
    } else {
      const prefix = /^\s*export\s+/.test(lines[first] ?? "") ? "export " : "";
      next = lines.flatMap((line, index) => {
        if (index === first) return [`${prefix}${name}=${written}`];
        return match.test(line) ? [] : [line];
      });
    }
    const out = next.join(eol);
    const after = parseEnv(out);
    if (after[name] === value && sameExcept(before, after, name))
      return { ok: true, text: (bom ? "\uFEFF" : "") + out };
  }
  return { ok: false };
}

/** 删掉 `name` 的所有行。 */
export function removeEnvLine(text: string, name: string): EnvEdit {
  const bom = text.charCodeAt(0) === 0xfeff;
  const source = stripBom(text);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const before = parseEnv(source);
  const match = lineOf(name);
  const lines = source.split(/\r?\n/);
  if (lines.some((line) => match.test(line) && opensMultiline(line))) return { ok: false };
  const out = lines.filter((line) => !match.test(line)).join(eol);
  const after = parseEnv(out);
  if (name in after || !sameExcept(before, after, name)) return { ok: false };
  return { ok: true, text: (bom ? "\uFEFF" : "") + out };
}
