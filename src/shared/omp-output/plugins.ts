// `omp plugin …` 的输出解析和动作参数（omp 18.12.5 实测，样本在 fixtures/omp-plugin/）。
//
// 实测要点：
// - `--json` 只对部分子命令有效：`list`、`doctor`、`features`、`config list`、`link` 输出 JSON；
//   `marketplace list`、`discover`、`install`、`upgrade`、`uninstall <name@marketplace>`、`marketplace add/remove/update` 即使带 `--json`
//   也输出纯文本（`✔ …` / `✘ …` 行）。`features --enable` 的 JSON 前面还有一行 `✔ Updated features for …`。
// - 市场插件（`name@marketplace`）没有 features / config 子命令（`Plugin "…" not found`）；只有 npm / link 插件有。
// - `marketplace list` / `discover` 没有任何条目时输出一句话；`discover` 不带市场名时不标出每个插件属于哪个市场，
//   所以界面按市场逐个 `discover <市场>`。
// 输出格式不是 omp 的契约：解析不了就抛 PluginOutputError（带原文），界面显示原文，不吞。
import { isRecord } from "../type-guards.ts";

export class PluginOutputError extends Error {
  override name = "PluginOutputError";
  constructor(what: string, raw: string) {
    super(`Could not read omp ${what} output: ${raw.trim().slice(0, 400) || "(empty)"}`);
  }
}

// ───────── 数据类型 ─────────

export interface PluginSettingSchema {
  type: string;
  default?: unknown;
  description?: string;
  /** 枚举型设置的可选值（omp 没规定时为空）。 */
  enum?: readonly unknown[];
}

export interface PluginFeatureInfo {
  name: string;
  description: string | null;
  /** 清单里标的"默认启用"。 */
  default: boolean;
}

/** npm / link 安装的插件。 */
export interface NpmPlugin {
  kind: "npm";
  name: string;
  version: string;
  description: string | null;
  /** 全局开关；`enabled` 缺省视为 true。 */
  enabled: boolean;
  features: readonly PluginFeatureInfo[];
  /** null = 用清单里的默认；数组 = 用户显式选了这些。 */
  enabledFeatures: readonly string[] | null;
  settings: Readonly<Record<string, PluginSettingSchema>>;
}

export interface MarketplaceInstall {
  scope: string;
  version: string;
  installedAt: string | null;
  lastUpdated: string | null;
  enabled: boolean;
}

/** 市场安装的插件，`id` 是 `name@marketplace`；同一个插件可能在 user 和 project 两个范围都装了。 */
export interface MarketplacePlugin {
  kind: "marketplace";
  id: string;
  name: string;
  marketplace: string;
  installs: readonly MarketplaceInstall[];
}

export interface PluginList {
  npm: readonly NpmPlugin[];
  marketplace: readonly MarketplacePlugin[];
}

export interface MarketplaceSource {
  name: string;
  source: string;
}

/**
 * 预设市场（Anthropic 官方文档 https://code.claude.com/docs/en/plugins/anthropic-marketplaces ）。
 * `source` 是传给 `marketplace add` 的 `owner/repo`；`name` 是 omp 18.12.6 加完后 `marketplace list` 里的市场名（实测，
 * `list` 的来源列原样是加的时候写的 `owner/repo`）。`anthropics/claude-code` 是演示市场，插件与官方重复，不预设。
 */
export const PRESET_MARKETPLACES: readonly {
  source: string;
  name: string;
  label: { "zh-CN": string; en: string };
}[] = [
  {
    source: "anthropics/claude-plugins-official",
    name: "claude-plugins-official",
    label: { "zh-CN": "官方", en: "Official" },
  },
  {
    source: "anthropics/claude-plugins-community",
    name: "claude-community",
    label: { "zh-CN": "社区", en: "Community" },
  },
  {
    source: "anthropics/knowledge-work-plugins",
    name: "knowledge-work-plugins",
    label: { "zh-CN": "知识工作", en: "Knowledge work" },
  },
  {
    source: "anthropics/skills",
    name: "anthropic-agent-skills",
    label: { "zh-CN": "Agent Skills", en: "Agent Skills" },
  },
];

/** `listPlugins` 的结果：已装的插件 + 配置的市场。 */
export interface PluginsSnapshot extends PluginList {
  marketplaces: readonly MarketplaceSource[];
}

export interface DiscoverEntry {
  name: string;
  /** 目录里声明的版本；没声明为 null。 */
  version: string | null;
  description: string;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
}

export interface PluginConfig {
  /** 用户已设置的值（没设的键不在里面，界面显示 schema 的默认值）。 */
  settings: Readonly<Record<string, unknown>>;
  schema: Readonly<Record<string, PluginSettingSchema>>;
}

// ───────── 通用 ─────────

/** 去掉 JSON 前面的 `✔ …` 提示行，取第一个以 `{` 或 `[` 开头的行起的整段。 */
export function extractJson(stdout: string, what: string): unknown {
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((line) => /^[[{]/.test(line));
  if (start === -1) throw new PluginOutputError(what, stdout);
  try {
    return JSON.parse(lines.slice(start).join("\n"));
  } catch {
    throw new PluginOutputError(what, stdout);
  }
}

/**
 * 输出里的结果句：去掉 `✔` / `✘` 前缀，取第一行有内容的文字。JSON 行（`{"enabled":…}`、feature 命令跟在提示后面的 JSON）不是给人看的，
 * 跳过；只有 JSON 时返回空串（界面不弹 toast，开关本身已经变了）。
 */
export function actionMessage(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[✔✘]\s*/u, "").trim())
    .filter((line) => line !== "" && !/^[[{]/.test(line));
  return lines[0] ?? "";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function schemaOf(value: unknown): Record<string, PluginSettingSchema> {
  const out: Record<string, PluginSettingSchema> = {};
  if (!isRecord(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const entry: PluginSettingSchema = { type: typeof raw["type"] === "string" ? raw["type"] : "string" };
    if ("default" in raw) entry.default = raw["default"];
    const description = str(raw["description"]);
    if (description !== null) entry.description = description;
    if (Array.isArray(raw["enum"])) entry.enum = raw["enum"];
    out[key] = entry;
  }
  return out;
}

// ───────── 解析 ─────────

function parseNpmPlugin(raw: unknown): NpmPlugin | null {
  if (!isRecord(raw)) return null;
  const name = str(raw["name"]);
  if (name === null) return null;
  const manifest = isRecord(raw["manifest"]) ? raw["manifest"] : {};
  const features: PluginFeatureInfo[] = isRecord(manifest["features"])
    ? Object.entries(manifest["features"]).map(([featureName, value]) => {
        const info = isRecord(value) ? value : {};
        return { name: featureName, description: str(info["description"]), default: info["default"] === true };
      })
    : [];
  const enabledFeatures = Array.isArray(raw["enabledFeatures"])
    ? raw["enabledFeatures"].filter((item): item is string => typeof item === "string")
    : null;
  return {
    kind: "npm",
    name,
    version: str(raw["version"]) ?? "",
    description: str(manifest["description"]),
    enabled: raw["enabled"] !== false,
    features,
    enabledFeatures,
    settings: schemaOf(manifest["settings"]),
  };
}

function parseMarketplacePlugin(raw: unknown): MarketplacePlugin | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  if (id === null) return null;
  const at = id.lastIndexOf("@");
  if (at <= 0) return null;
  const entries = Array.isArray(raw["entries"]) ? raw["entries"] : [];
  const installs = entries.filter(isRecord).map((entry): MarketplaceInstall => ({
    scope: str(entry["scope"]) ?? "user",
    version: str(entry["version"]) ?? "",
    installedAt: str(entry["installedAt"]),
    lastUpdated: str(entry["lastUpdated"]),
    enabled: entry["enabled"] !== false,
  }));
  return { kind: "marketplace", id, name: id.slice(0, at), marketplace: id.slice(at + 1), installs };
}

function mergeById(plugins: readonly MarketplacePlugin[]): MarketplacePlugin[] {
  const byId = new Map<string, MarketplacePlugin>();
  for (const plugin of plugins) {
    const first = byId.get(plugin.id);
    byId.set(plugin.id, first === undefined ? plugin : { ...first, installs: [...first.installs, ...plugin.installs] });
  }
  return [...byId.values()];
}

/** `omp plugin list --json`：`{ npm: [...], marketplace: [...] }`（空时两个数组都是空的）。 */
export function parsePluginList(stdout: string): PluginList {
  const data = extractJson(stdout, "plugin list");
  if (!isRecord(data) || !Array.isArray(data["npm"]) || !Array.isArray(data["marketplace"]))
    throw new PluginOutputError("plugin list", stdout);
  return {
    npm: data["npm"].map(parseNpmPlugin).filter((plugin): plugin is NpmPlugin => plugin !== null),
    // 在项目目录里跑时，同一个插件在用户和项目范围各有一条记录（实测）；合并成一个插件、多个安装。
    marketplace: mergeById(
      data["marketplace"].map(parseMarketplacePlugin).filter((plugin): plugin is MarketplacePlugin => plugin !== null),
    ),
  };
}

/** `omp plugin doctor --json`：`[{ name, status, message }]`。 */
export function parseDoctor(stdout: string): DoctorCheck[] {
  const data = extractJson(stdout, "plugin doctor");
  if (!Array.isArray(data)) throw new PluginOutputError("plugin doctor", stdout);
  return data.filter(isRecord).map((item) => {
    const status = item["status"];
    return {
      name: str(item["name"]) ?? "",
      status: status === "ok" || status === "warning" ? status : "error",
      message: typeof item["message"] === "string" ? item["message"] : "",
    };
  });
}

/** `omp plugin config list <name> --json`：`{ settings, schema }`。 */
export function parsePluginConfig(stdout: string): PluginConfig {
  const data = extractJson(stdout, "plugin config");
  if (!isRecord(data) || !isRecord(data["schema"])) throw new PluginOutputError("plugin config", stdout);
  return { settings: isRecord(data["settings"]) ? data["settings"] : {}, schema: schemaOf(data["schema"]) };
}

/**
 * `omp plugin marketplace list`（纯文本）：
 * `Configured Marketplaces:` 空行 后每行 `  <名称>  <来源>`；没有时是 `No marketplaces configured…`。
 */
export function parseMarketplaceList(stdout: string): MarketplaceSource[] {
  if (/^\s*No marketplaces configured/m.test(stdout)) return [];
  if (!/^\s*Configured Marketplaces:/m.test(stdout)) throw new PluginOutputError("marketplace list", stdout);
  const out: MarketplaceSource[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^ {2}(\S+) {2,}(\S.*)$/.exec(line);
    if (match) out.push({ name: match[1]!, source: match[2]!.trim() });
  }
  return out;
}

/**
 * `omp plugin discover <市场>`（纯文本）：`Available Plugins (<市场>):`、空行，每个插件一行 `  <名称>[@<版本>]`，
 * 下面是缩进 4 格的说明（可能多行）；没有时是 `No plugins available`。名称里没有 `@`，所以最后一个 `@` 之后就是版本。
 */
export function parseDiscover(stdout: string): DiscoverEntry[] {
  if (/^\s*No plugins available/m.test(stdout)) return [];
  if (!/^\s*Available Plugins/m.test(stdout)) throw new PluginOutputError("discover", stdout);
  const out: { name: string; version: string | null; description: string[] }[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const head = /^ {2}(\S+)\s*$/.exec(line);
    if (head) {
      const label = head[1]!;
      const at = label.lastIndexOf("@");
      out.push(
        at > 0
          ? { name: label.slice(0, at), version: label.slice(at + 1), description: [] }
          : { name: label, version: null, description: [] },
      );
      continue;
    }
    if (/^ {4}\S/.test(line)) out.at(-1)?.description.push(line.trim());
  }
  return out.map((entry) => ({ name: entry.name, version: entry.version, description: entry.description.join(" ") }));
}

// ───────── 动作：渲染进程只能传这个封闭联合，主进程拼成参数数组 ─────────

/** npm 包名（可带 scope）或 `name@marketplace`；不以 `-` 开头，拼进参数不会被当成选项。 */
const PLUGIN_ID = /^(?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*(?:@[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
/** 市场名 / 清单里的功能名 / 设置键。 */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MARKETPLACE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type PluginScope = "user" | "project";

export type PluginAction =
  /** `scope`：同一个插件在用户和项目范围都装了时必须指定（omp 会拒绝含糊的请求）；`project` 要求调用时带 projectId。 */
  | { kind: "enable" | "disable" | "uninstall"; id: string; scope?: PluginScope }
  /** `id` 为 null：升级全部市场插件（`scope` 被 omp 忽略，不带）。 */
  | { kind: "upgrade"; id: string | null; scope?: PluginScope }
  /** 只装市场插件（`name@marketplace`）。 */
  | { kind: "install"; id: string; scope?: PluginScope }
  | { kind: "feature"; id: string; feature: string; on: boolean }
  | { kind: "configSet"; id: string; key: string; value: string }
  | { kind: "configDelete"; id: string; key: string }
  | { kind: "marketplaceAdd"; source: string }
  | { kind: "marketplaceRemove"; name: string }
  /** `name` 为 null：更新全部目录。 */
  | { kind: "marketplaceUpdate"; name: string | null }
  | { kind: "doctor"; fix: boolean };

function bad(message: string): never {
  throw new Error(`invalid plugin action: ${message}`);
}

function pluginId(value: unknown, label = "id"): string {
  if (typeof value !== "string" || !PLUGIN_ID.test(value) || value.length > 200) bad(`${label} is not a plugin id`);
  return value;
}

function token(value: unknown, label: string): string {
  if (typeof value !== "string" || !TOKEN.test(value)) bad(`${label} must be 1-100 chars of letters, digits, . _ -`);
  return value;
}

function optionalScope(value: unknown): { scope?: PluginScope } {
  if (value === undefined) return {};
  if (value !== "user" && value !== "project") return bad("scope must be user or project");
  return { scope: value };
}

/** 校验来自渲染进程的值；不合法抛 Error（validate.ts 包成 IpcValidationError）。 */
export function parsePluginAction(value: unknown): PluginAction {
  if (!isRecord(value)) return bad("expected an object");
  switch (value["kind"]) {
    case "enable":
    case "disable":
    case "uninstall":
      return { kind: value["kind"], id: pluginId(value["id"]), ...optionalScope(value["scope"]) };
    case "upgrade":
      return value["id"] === null
        ? { kind: "upgrade", id: null }
        : { kind: "upgrade", id: pluginId(value["id"]), ...optionalScope(value["scope"]) };
    case "install": {
      const id = pluginId(value["id"]);
      if (!MARKETPLACE_ID.test(id)) return bad("install needs name@marketplace");
      return { kind: "install", id, ...optionalScope(value["scope"]) };
    }
    case "feature": {
      if (typeof value["on"] !== "boolean") return bad("on must be a boolean");
      return {
        kind: "feature",
        id: pluginId(value["id"]),
        feature: token(value["feature"], "feature"),
        on: value["on"],
      };
    }
    case "configSet": {
      const raw = value["value"];
      // omp 的参数解析会把以 `-` 开头的值当成选项（实测 `config set … -5` 报 Unknown option）。
      if (typeof raw !== "string" || raw === "" || raw.length > 2000 || CONTROL.test(raw) || raw.startsWith("-"))
        return bad("value must be a non-empty single-line string that does not start with '-'");
      return { kind: "configSet", id: pluginId(value["id"]), key: token(value["key"], "key"), value: raw };
    }
    case "configDelete":
      return { kind: "configDelete", id: pluginId(value["id"]), key: token(value["key"], "key") };
    case "marketplaceAdd": {
      const source = value["source"];
      if (
        typeof source !== "string" ||
        source.trim() === "" ||
        source.length > 2000 ||
        CONTROL.test(source) ||
        source.trim().startsWith("-")
      )
        return bad("source must be a non-empty single-line string that does not start with '-'");
      return { kind: "marketplaceAdd", source: source.trim() };
    }
    case "marketplaceRemove":
      return { kind: "marketplaceRemove", name: token(value["name"], "name") };
    case "marketplaceUpdate":
      return { kind: "marketplaceUpdate", name: value["name"] === null ? null : token(value["name"], "name") };
    case "doctor":
      if (typeof value["fix"] !== "boolean") return bad("fix must be a boolean");
      return { kind: "doctor", fix: value["fix"] };
    default:
      return bad(`unknown action ${JSON.stringify(value["kind"])}`);
  }
}

/** 带 `scope` 的动作才加 `--scope`；`project` 要在项目目录里跑（主进程按 projectId 定 cwd）。 */
function scopeArgs(scope: PluginScope | undefined): string[] {
  return scope === undefined ? [] : ["--scope", scope];
}

/** 动作 → `omp` 的参数数组（不含可执行文件）。校验过的动作才能传进来。 */
export function pluginActionArgs(action: PluginAction): string[] {
  switch (action.kind) {
    case "enable":
    case "disable":
    case "uninstall":
      return ["plugin", action.kind, action.id, ...scopeArgs(action.scope), "--json"];
    case "upgrade":
      return action.id === null
        ? ["plugin", "upgrade", "--json"]
        : ["plugin", "upgrade", action.id, ...scopeArgs(action.scope), "--json"];
    case "install":
      return ["plugin", "install", action.id, ...scopeArgs(action.scope), "--json"];
    case "feature":
      return ["plugin", "features", action.id, action.on ? "--enable" : "--disable", action.feature, "--json"];
    case "configSet":
      return ["plugin", "config", "set", action.id, action.key, action.value];
    case "configDelete":
      return ["plugin", "config", "delete", action.id, action.key];
    case "marketplaceAdd":
      return ["plugin", "marketplace", "add", action.source];
    case "marketplaceRemove":
      return ["plugin", "marketplace", "remove", action.name];
    case "marketplaceUpdate":
      return action.name === null
        ? ["plugin", "marketplace", "update"]
        : ["plugin", "marketplace", "update", action.name];
    case "doctor":
      return action.fix ? ["plugin", "doctor", "--json", "--fix"] : ["plugin", "doctor", "--json"];
  }
}

/** 读取类命令的参数（固定形状）。 */
export const pluginReadArgs = {
  list: ["plugin", "list", "--json"],
  marketplaces: ["plugin", "marketplace", "list"],
  discover: (marketplace: string) => ["plugin", "discover", marketplace],
  config: (id: string) => ["plugin", "config", "list", id, "--json"],
} as const;

export function parseMarketplaceName(value: unknown): string {
  return token(value, "marketplace");
}

export function parsePluginName(value: unknown): string {
  return pluginId(value, "plugin");
}
