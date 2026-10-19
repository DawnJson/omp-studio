// omp 的全部设置：把 `omp config list --json`（type、description、value、redacted）和
// `omp config list`（文本：`[tab]` 分组、枚举行 `key = v (a|b|c)` 的可选值）合并成 schema。纯函数，不碰进程和文件。
// 实测版本：omp 18.12.1（555 项，11 个 tab）；样本输出在 fixtures/omp-config/。
import { stripAnsi } from "../../shared/ansi.ts";
import type { OmpConfigItem, OmpConfigSnapshot, OmpConfigType } from "../../shared/ipc.ts";

export interface TextEntry {
  tab: string;
  /** 括号里是枚举的可选值（`a|b|c`）；是类型名（string/number/…）时为 null。 */
  options: string[] | null;
}

export interface ParsedConfigText {
  tabs: string[];
  entries: Map<string, TextEntry>;
}

const typeNames = new Set(["string", "number", "boolean", "array", "record"]);
const tabLine = /^\[([^\]\s]+)\]\s*$/;
// `  key = <值，可能含括号，如 "(not set)"> (<类型或枚举>)`：值部分贪婪，括号组取最后一个。
const entryLine = /^ {2}(\S+) = (.*) \(([^()]*)\)$/;

export function parseConfigText(text: string): ParsedConfigText {
  const tabs: string[] = [];
  const entries = new Map<string, TextEntry>();
  let tab = "";
  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const tabMatch = tabLine.exec(line);
    if (tabMatch?.[1]) {
      tab = tabMatch[1];
      if (!tabs.includes(tab)) tabs.push(tab);
      continue;
    }
    const match = entryLine.exec(line);
    if (!match?.[1] || !match[3] || tab === "") continue;
    entries.set(match[1], { tab, options: typeNames.has(match[3]) ? null : match[3].split("|") });
  }
  return { tabs, entries };
}

export interface SchemaEntry {
  key: string;
  tab: string;
  type: OmpConfigType;
  description: string;
  options: string[] | null;
  defaultValue: unknown;
  hasDefault: boolean;
}

export interface ConfigSchema {
  ompVersion: string;
  tabs: string[];
  entries: SchemaEntry[];
}

interface JsonEntry {
  type?: unknown;
  description?: unknown;
  value?: unknown;
  redacted?: unknown;
}

const configTypes: readonly OmpConfigType[] = ["boolean", "enum", "number", "string", "array", "record"];

function jsonEntries(json: unknown): [string, JsonEntry][] {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new Error("`omp config list --json` did not print an object");
  return Object.entries(json as Record<string, JsonEntry>);
}

/** 凭据类字段：值不回显、不在界面里编辑（`omp config set` 的值走命令行参数，进程列表里看得到）。 */
export function isCredentialKey(key: string, redacted: boolean): boolean {
  return redacted || /(token|secret|password|credentials|apikey)$/i.test(key);
}

/** 在**空的 agent 目录**里读出来的 JSON + 文本，得到 schema 和 omp 自己的默认值。 */
export function buildSchema(ompVersion: string, json: unknown, text: string): ConfigSchema {
  const parsed = parseConfigText(text);
  const entries: SchemaEntry[] = [];
  for (const [key, entry] of jsonEntries(json)) {
    const type = configTypes.find((candidate) => candidate === entry.type);
    if (!type) continue;
    const fromText = parsed.entries.get(key);
    entries.push({
      key,
      tab: fromText?.tab ?? "internal",
      type,
      description: typeof entry.description === "string" ? entry.description : "",
      options: type === "enum" ? (fromText?.options ?? null) : null,
      defaultValue: entry.value,
      hasDefault: "value" in entry,
    });
  }
  return { ompVersion, tabs: parsed.tabs, entries };
}

/** 把用户当前的 `omp config list --json` 套到 schema 上。 */
export function applyValues(schema: ConfigSchema, json: unknown): OmpConfigSnapshot {
  const current = new Map(jsonEntries(json));
  const items: OmpConfigItem[] = schema.entries.map((entry) => {
    const now = current.get(entry.key);
    const redacted = isCredentialKey(entry.key, now?.redacted === true);
    // 凭据：hasValue 只表示"已设置"（omp 标了 redacted），值永远不带出来。
    const hasValue = redacted ? now?.redacted === true : now !== undefined && "value" in now;
    return {
      key: entry.key,
      tab: entry.tab,
      type: entry.type,
      description: entry.description,
      options: entry.options,
      value: hasValue && !redacted ? now?.value : null,
      hasValue,
      redacted,
      defaultValue: entry.hasDefault && !redacted ? entry.defaultValue : null,
      hasDefault: entry.hasDefault && !redacted,
    };
  });
  return { ompVersion: schema.ompVersion, tabs: schema.tabs, items };
}
