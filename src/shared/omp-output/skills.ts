// 设置 → 集成与插件 → Skills：`omp skill list --json`（omp 18.12.6 实测）列出所有发现到的 skill：
// `{ skills: [{ name, description, filePath, baseDir, source, hide }], warnings }`，`source` 形如 `<provider>:<level>`
// （`native:user`、`agents:user`、`claude:user`、`agents:project`、`native:project`……）。被 `disabledExtensions` 里 `skill:<name>` 停用的 skill 不在列表里。
import { isRecord } from "../type-guards.ts";

export type SkillScope = "user" | "project";

/** 渲染进程看到的一行。绝对路径不下发：`folder` 只是脱敏后的显示文本（家目录写成 `~`）。 */
export interface SkillEntry {
  /** 重名的 skill omp 给的是 `<命名空间>/<名字>`，原样保留。 */
  name: string;
  description?: string;
  /** 来源层级；被停用的补行（只有名字）算用户级，因为 `disabledExtensions` 写在用户配置里。 */
  scope: SkillScope;
  /** omp 给的 provider（`agents`、`native`、`claude-plugins`……），只用于悬停提示；停用补行没有。 */
  provider?: string;
  /** 插件带来的（marketplace / npm 插件、registry 包、自动学习），不提供删除。 */
  plugin: boolean;
  disabled: boolean;
  /** 开关能不能用：只改用户配置，项目层的 skill 要在项目的 `.omp/config.yml` 里停用。 */
  toggleable: boolean;
  /** 能移进回收站：磁盘上的普通 skill 文件夹（`…/skills/<目录>`，带 SKILL.md），不是插件带的。 */
  removable: boolean;
  /** skill 文件夹的显示路径（`~/.agents/skills/foo`）；停用补行没有。 */
  folder?: string;
  /** 在 `.agents/skills` 里：别的 agent 工具也读这个文件夹。 */
  shared: boolean;
}

/** 添加对话框里选中的文件夹：路径留在主进程，界面只拿到文件夹名和解析出的名字 / 说明。 */
export interface SkillCandidate {
  /** 主进程记着这次选择；`addSkill` 带回来，对不上就拒绝。 */
  token: string;
  folderName: string;
  name: string;
  description: string;
}

/** 添加到哪里：`shared` = `.agents/skills`（各家 agent 共用），`omp` = agent 目录 / 项目 `.omp` 的 `skills/`（只有 omp）。 */
export type SkillTarget = "shared" | "omp";

export interface RawSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
}

/** 这些 provider 的 skill 由插件 / registry / 自动学习管理，不是用户放进 `skills/` 的文件夹。 */
const PLUGIN_PROVIDERS: Record<string, true> = {
  "omp-plugins": true,
  "agent-plugins": true,
  "claude-plugins": true,
  skillshare: true,
  "omp-managed": true,
};

export function isPluginProvider(provider: string): boolean {
  return Object.hasOwn(PLUGIN_PROVIDERS, provider);
}

/** `native:user` → { provider: "native", level: "user" }；不是 `project` 的层级都按用户级。 */
export function parseSource(source: string): { provider: string; level: SkillScope } {
  const cut = source.lastIndexOf(":");
  if (cut < 0) return { provider: source, level: "user" };
  return { provider: source.slice(0, cut), level: source.slice(cut + 1) === "project" ? "project" : "user" };
}

/** `omp skill list --json` 的输出；形状不对就抛错，不猜。 */
export function parseSkillList(stdout: string): RawSkill[] {
  const start = stdout.indexOf("{");
  let parsed: unknown;
  try {
    parsed = JSON.parse(start < 0 ? stdout : stdout.slice(start));
  } catch {
    throw new Error("omp skill list --json did not print JSON");
  }
  const skills = isRecord(parsed) ? parsed["skills"] : undefined;
  if (!Array.isArray(skills)) throw new Error("omp skill list --json: no skills array");
  return skills.map((item): RawSkill => {
    if (!isRecord(item)) throw new Error("omp skill list --json: unexpected skill entry");
    const { name, description, filePath, baseDir, source } = item;
    if (
      typeof name !== "string" ||
      typeof filePath !== "string" ||
      typeof baseDir !== "string" ||
      typeof source !== "string"
    )
      throw new Error("omp skill list --json: unexpected skill entry");
    return { name, description: typeof description === "string" ? description.trim() : "", filePath, baseDir, source };
  });
}

/** `omp config get --json disabledExtensions` 的输出 → 条目数组。 */
export function parseDisabledExtensions(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(Math.max(0, stdout.indexOf("{"))));
  } catch {
    throw new Error("omp config get disabledExtensions did not print JSON");
  }
  const value = isRecord(parsed) ? parsed["value"] : undefined;
  if (!Array.isArray(value)) throw new Error("omp config get disabledExtensions: value is not an array");
  return value.filter((item): item is string => typeof item === "string");
}

const DISABLED_PREFIX = "skill:";

/** `disabledExtensions` 里停用的 skill 名字。 */
export function disabledSkillNames(entries: readonly string[]): string[] {
  return entries
    .filter((entry) => entry.startsWith(DISABLED_PREFIX))
    .map((entry) => entry.slice(DISABLED_PREFIX.length));
}

/** 只加减 `skill:<name>`，别的条目（`context-file:…`、`extension-module:…`）按原顺序原样保留；已经停用的再停用不动。 */
export function withSkillEnabled(entries: readonly string[], name: string, enabled: boolean): string[] {
  const id = `${DISABLED_PREFIX}${name}`;
  if (enabled) return entries.filter((entry) => entry !== id);
  return entries.includes(id) ? [...entries] : [...entries, id];
}
