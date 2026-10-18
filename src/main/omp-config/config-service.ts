// 读写 omp 的全部设置：只通过 `omp config` 命令（带锁的写入，不直接碰 config.yml，AGENTS.md "omp 的边界"）。
//   读：`omp config list --json`（值）；schema（tab、枚举可选值、类型、描述、默认值）来自**空 agent 目录**里的
//       `list --json` + `list` 文本，按 omp 版本缓存，同时给出"已修改"的比较基准。
//   写：`omp config set --json <key> -- <value>` / `omp config reset --json <key>`。`--` 是必须的：负数（`-1`）否则被当成选项。
// 子进程用参数数组，不开 shell；omp 拒绝时把它的原话（stderr）作为错误透传。
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OmpConfigSnapshot, OmpConfigWriteResult } from "../../shared/ipc.ts";
import { applyValues, buildSchema, isCredentialKey, type ConfigSchema, type SchemaEntry } from "./schema.ts";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** omp config 子命令失败；message 是 omp 自己的错误文字，去掉了 `Error: ` 前缀。 */
export class OmpConfigError extends Error {
  override name = "OmpConfigError";
}

export interface ConfigServiceDeps {
  /**
   * 执行 `omp config <args>`。给了 isolated 就在**干净的环境**里跑：空的 agent 目录，并且不带当前进程的环境变量
   * （环境变量会覆盖设置，读出来的就不是 omp 自己的默认值了）。
   */
  run(args: string[], isolated?: { agentDir: string }): Promise<RunResult>;
  /** 当前使用的 omp 的版本（schema 缓存的键）。 */
  version(): Promise<string>;
  /** schema 缓存文件；不给就只缓存在内存里。 */
  cacheFile?: string | undefined;
}

/** 只留 omp 启动要用的系统变量（PATH、临时目录、用户目录等）；会覆盖设置的 API/代理/功能开关一概不带。 */
const systemVariables = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "COMSPEC", "USERNAME", "OS", "PROCESSOR_ARCHITECTURE"]);

function cleanEnv(agentDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (systemVariables.has(name.toUpperCase())) env[name] = value;
  env["PI_CODING_AGENT_DIR"] = agentDir;
  return env;
}

export function runOmpConfig(exePath: string, cwd: string): ConfigServiceDeps["run"] {
  return (args, isolated) => {
    const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
    execFile(
      exePath,
      ["config", ...args],
      {
        cwd,
        // 不要颜色：输出是给程序读的，FORCE_COLOR 之类会让 omp 在管道里也加转义码。
        env: { ...(isolated ? cleanEnv(isolated.agentDir) : process.env), NO_COLOR: "1", FORCE_COLOR: "0" },
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") reject(error);
        else resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
    return promise;
  };
}

function failure(result: RunResult): OmpConfigError {
  const text = (result.stderr.trim() || result.stdout.trim() || `omp config exited with code ${result.code}`).split(/\r?\n/)[0] ?? "";
  return new OmpConfigError(text.replace(/^Error:\s*/, ""));
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new OmpConfigError(`${what} did not print JSON`);
  }
}

export class OmpConfigService {
  readonly #deps: ConfigServiceDeps;
  #schema: Promise<ConfigSchema> | null = null;
  #schemaVersion: string | null = null;

  constructor(deps: ConfigServiceDeps) {
    this.#deps = deps;
  }

  async #loadSchema(): Promise<ConfigSchema> {
    const version = await this.#deps.version();
    if (this.#schema && this.#schemaVersion === version) return this.#schema;
    this.#schemaVersion = version;
    this.#schema = this.#readOrBuild(version);
    // 失败的 promise 不缓存，下次重试。
    this.#schema.catch(() => {
      if (this.#schemaVersion === version) this.#schema = null;
    });
    return this.#schema;
  }

  async #readOrBuild(version: string): Promise<ConfigSchema> {
    const { cacheFile } = this.#deps;
    if (cacheFile) {
      try {
        const cached = JSON.parse(await readFile(cacheFile, "utf8")) as ConfigSchema;
        if (cached.ompVersion === version && Array.isArray(cached.entries)) return cached;
      } catch {
        // 没有缓存或缓存坏了：重新读。
      }
    }
    const scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-config-"));
    try {
      const isolated = { agentDir: scratch };
      const [json, text] = await Promise.all([this.#deps.run(["list", "--json"], isolated), this.#deps.run(["list"], isolated)]);
      if (json.code !== 0) throw failure(json);
      if (text.code !== 0) throw failure(text);
      const schema = buildSchema(version, parseJson(json.stdout, "`omp config list --json`"), text.stdout);
      if (cacheFile) await writeFile(cacheFile, JSON.stringify(schema), "utf8");
      return schema;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  async snapshot(): Promise<OmpConfigSnapshot> {
    const schema = await this.#loadSchema();
    const result = await this.#deps.run(["list", "--json"]);
    if (result.code !== 0) throw failure(result);
    return applyValues(schema, parseJson(result.stdout, "`omp config list --json`"));
  }

  async #entry(key: string): Promise<SchemaEntry> {
    const entry = (await this.#loadSchema()).entries.find((candidate) => candidate.key === key);
    // key 只能是 schema 里的：不让渲染进程传来的字符串变成命令行选项。
    if (!entry) throw new OmpConfigError(`Unknown setting: ${key}`);
    return entry;
  }

  /** valueJson 是 JSON 文本；按 schema 的类型转成 `omp config set` 要的参数。 */
  async set(key: string, valueJson: string): Promise<OmpConfigWriteResult> {
    const entry = await this.#entry(key);
    if (isCredentialKey(key, false)) throw new OmpConfigError(`${key} is a credential: set it with \`omp config set\` in a terminal, not through the command line of omp-studio`);
    const value = parseJson(valueJson, "the value");
    let argument: string;
    switch (entry.type) {
      case "boolean":
        if (typeof value !== "boolean") throw new OmpConfigError("Invalid boolean: expected true or false");
        argument = String(value);
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) throw new OmpConfigError("Invalid number");
        argument = String(value);
        break;
      case "string":
      case "enum":
        if (typeof value !== "string") throw new OmpConfigError("Invalid value: expected text");
        argument = value;
        break;
      case "array":
        if (!Array.isArray(value)) throw new OmpConfigError("Invalid value: expected a JSON array");
        argument = JSON.stringify(value);
        break;
      case "record":
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new OmpConfigError("Invalid value: expected a JSON object");
        argument = JSON.stringify(value);
        break;
    }
    return this.#write(["set", "--json", key, "--", argument]);
  }

  async reset(key: string): Promise<OmpConfigWriteResult> {
    await this.#entry(key);
    return this.#write(["reset", "--json", key]);
  }

  async #write(args: string[]): Promise<OmpConfigWriteResult> {
    const result = await this.#deps.run(args);
    if (result.code !== 0) throw failure(result);
    const json = parseJson(result.stdout, `\`omp config ${args[0]}\``) as Record<string, unknown>;
    const key = String(json["key"]);
    const redacted = json["redacted"] === true || isCredentialKey(key, false);
    const hasValue = "value" in json && !redacted;
    return {
      key,
      value: hasValue ? json["value"] : null,
      hasValue,
      redacted,
      ...(typeof json["overriddenBy"] === "string" && { overriddenBy: json["overriddenBy"] }),
      ...(typeof json["fallbackEnv"] === "string" && { fallbackEnv: json["fallbackEnv"] }),
    };
  }
}
