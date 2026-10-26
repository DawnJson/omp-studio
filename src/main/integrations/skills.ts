// 设置 → 集成与插件 → Skills 的主进程部分（不 import electron，单测直接用；回收站和选文件夹对话框由 ipc/integrations-handlers.ts 注入）。
// 读：`omp skill list --json`；停用 / 启用：`omp config get|set disabledExtensions`，只加减 `skill:<name>`；
// 添加 / 删除：AGENTS.md "omp 的边界"里仓库所有者 2026-10-24 批准的 skill 文件夹例外。
// 用户范围的命令在中性目录（userData/service）里跑：omp 18.12.6 实测，家目录下的 cwd 不会把 `~/.agents/skills` 标成 project
// （19 个 `agents:user` + 3 个 `native:user`）；cwd 就是家目录本身时 `~/.codex/skills` 等才会按 project 算，所以不用家目录当 cwd。
// omp 找项目层 skill 会沿 cwd 往上走：中性目录或项目在某个带 `.agents/skills` 的目录下面时，那个祖先目录里的 skill 也被标成 project
// （e2e 把 HOME 指到临时目录时，真实 `~/.agents/skills` 就这样混进来）。所以 project 层只认文件夹在当前项目目录之内的，别的不列、不能删。
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  disabledSkillNames,
  isPluginProvider,
  parseDisabledExtensions,
  parseSkillList,
  parseSource,
  withSkillEnabled,
  type RawSkill,
  type SkillCandidate,
  type SkillEntry,
  type SkillScope,
  type SkillTarget,
} from "../../shared/omp-output/skills.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { requireSuccess, type RunOmp } from "../usage/usage-service.ts";

export const SKILL_FILE = "SKILL.md";
const DISABLED_KEY = "disabledExtensions";

export class SkillInputError extends Error {
  override name = "SkillInputError";
}

/** 路径怎么解析：全部由主进程算，渲染进程只传名字、范围、目的地。 */
export interface SkillPlaces {
  home: string;
  /** omp 的 agent 目录（`PI_CODING_AGENT_DIR` 或 `~/.omp/agent`）。 */
  agentDir: string;
  /** 项目范围时是项目目录，用户范围时为 null。 */
  project: string | null;
}

// ---------------------------------------------------------------- 显示

/** 路径是否在 `parent` 之内（含它自己）。 */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** 家目录写成 `~`，分隔符统一成 `/`；家目录之外的路径原样。 */
export function displayPath(target: string, home: string): string {
  if (!isInside(target, home)) return target;
  const relative = path.relative(home, target);
  return relative === "" ? "~" : `~/${relative.split(path.sep).join("/")}`;
}

// ---------------------------------------------------------------- 列表

/** `…/skills/<目录>`：skill 文件夹的形状（omp 对常规 provider 只扫 `skills/` 下一层）。 */
function isSkillFolderShape(baseDir: string): boolean {
  return path.isAbsolute(baseDir) && path.basename(path.dirname(baseDir)).toLowerCase() === "skills";
}

async function hasSkillFile(baseDir: string): Promise<boolean> {
  try {
    return (await stat(path.join(baseDir, SKILL_FILE))).isFile();
  } catch {
    return false;
  }
}

async function toEntry(raw: RawSkill, home: string): Promise<SkillEntry> {
  const { provider, level } = parseSource(raw.source);
  const plugin = isPluginProvider(provider);
  const removable = !plugin && isSkillFolderShape(raw.baseDir) && (await hasSkillFile(raw.baseDir));
  return {
    name: raw.name,
    ...(raw.description !== "" && { description: raw.description }),
    scope: level,
    provider,
    plugin,
    disabled: false,
    // 开关只写用户配置：项目层的 skill 要在项目的 .omp/config.yml 里停用。
    toggleable: level === "user",
    removable,
    folder: displayPath(raw.baseDir, home),
    shared: provider === "agents",
  };
}

export async function readDisabledExtensions(run: RunOmp): Promise<string[]> {
  const result = await run(["config", "get", "--json", DISABLED_KEY]);
  requireSuccess("omp config get", result);
  return parseDisabledExtensions(result.stdout);
}

/**
 * 当前能用的 skill + 被 `disabledExtensions` 停用的补行（omp 的列表里没有它们，只有名字）。
 * `runList` 的 cwd 决定范围（中性目录 = 用户级，项目目录 = 用户级 + 该项目的）；`runConfig` 一律在中性目录里跑。
 */
export async function listSkillEntries(
  runList: RunOmp,
  runConfig: RunOmp,
  home: string,
  project: string | null,
): Promise<SkillEntry[]> {
  // 两次 omp 启动互不依赖：一起跑。两个都失败时报列表的错（和先后跑时一样）。
  const [listing, disabling] = await Promise.allSettled([
    runList(["skill", "list", "--json"]),
    readDisabledExtensions(runConfig),
  ]);
  if (listing.status === "rejected") throw listing.reason;
  requireSuccess("omp skill list", listing.value);
  if (disabling.status === "rejected") throw disabling.reason;
  const raws = parseSkillList(listing.value.stdout).filter((raw) => belongsToScope(raw, project));
  const entries = await Promise.all(raws.map((raw) => toEntry(raw, home)));
  const present = new Set(entries.map((entry) => entry.name));
  for (const name of disabledSkillNames(disabling.value)) {
    if (present.has(name)) continue;
    present.add(name);
    entries.push({
      name,
      scope: "user",
      plugin: false,
      disabled: true,
      toggleable: true,
      removable: false,
      shared: false,
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** user 层都算；project 层只算文件夹在 `project` 目录之内的（用户范围 `project` 为 null，一个都不算）。 */
function belongsToScope(raw: RawSkill, project: string | null): boolean {
  if (parseSource(raw.source).level !== "project") return true;
  return project !== null && isInside(raw.baseDir, project);
}

// ---------------------------------------------------------------- 停用 / 启用

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function checkSkillName(name: string): string {
  if (name.trim() === "" || name.length > 200 || CONTROL.test(name)) throw new SkillInputError("name is invalid");
  return name;
}

/** 读出 `disabledExtensions`、只加减 `skill:<name>`、原样写回；没变化就不写。 */
export async function setSkillEnabled(run: RunOmp, name: string, enabled: boolean): Promise<void> {
  const current = await readDisabledExtensions(run);
  const next = withSkillEnabled(current, checkSkillName(name), enabled);
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) return;
  // `--` 必须有：值以 `[` 开头没问题，但和 config-service 的写法保持一致。
  requireSuccess("omp config set", await run(["config", "set", "--json", DISABLED_KEY, "--", JSON.stringify(next)]));
}

// ---------------------------------------------------------------- 删除

/**
 * 重新跑 `omp skill list --json` 按名字和层级找到 skill，校验后返回要移进回收站的文件夹。
 * 校验：不是插件带的、形如 `…/skills/<目录>`、里面有 SKILL.md。
 */
export async function removableSkillFolder(
  runList: RunOmp,
  name: string,
  scope: SkillScope,
  project: string | null,
): Promise<string> {
  const listed = await runList(["skill", "list", "--json"]);
  requireSuccess("omp skill list", listed);
  const raw = parseSkillList(listed.stdout).find(
    (item) => item.name === name && parseSource(item.source).level === scope && belongsToScope(item, project),
  );
  if (raw === undefined) throw new SkillInputError(`skill "${name}" not found`);
  if (isPluginProvider(parseSource(raw.source).provider))
    throw new SkillInputError("skills from plugins cannot be removed");
  if (!isSkillFolderShape(raw.baseDir)) throw new SkillInputError("skill folder is not under a skills directory");
  if (!(await hasSkillFile(raw.baseDir))) throw new SkillInputError(`skill folder has no ${SKILL_FILE}`);
  return raw.baseDir;
}

export async function removeSkill(
  runList: RunOmp,
  name: string,
  scope: SkillScope,
  project: string | null,
  trash: (folder: string) => Promise<void>,
): Promise<void> {
  await trash(await removableSkillFolder(runList, checkSkillName(name), scope, project));
}

// ---------------------------------------------------------------- 添加

/** 文件夹名里不能出现的字符：`/` `\` 是 omp 为命名空间保留的，其余是 Windows 文件名不允许的。 */
const FOLDER_UNSAFE = /[/\\<>:"|?*]/;

/** SKILL.md 开头的 YAML frontmatter（`---` 到下一个 `---`）；没有就返回 null。 */
function frontmatter(text: string): unknown {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (match === null) return null;
  try {
    return parse(match[1] ?? "");
  } catch {
    return null;
  }
}

/** 读源文件夹的 SKILL.md：frontmatter 必须有合法的 name 和 description。 */
export async function readSkillFolder(folder: string): Promise<{ name: string; description: string }> {
  if (!(await stat(folder)).isDirectory()) throw new SkillInputError("not a folder");
  let text: string;
  try {
    text = await readFile(path.join(folder, SKILL_FILE), "utf8");
  } catch {
    throw new SkillInputError(`no ${SKILL_FILE} in the folder`);
  }
  const data = frontmatter(text);
  const record = isRecord(data) ? data : {};
  const name = typeof record["name"] === "string" ? record["name"].trim() : "";
  const description = typeof record["description"] === "string" ? record["description"].trim() : "";
  if (name === "") throw new SkillInputError(`${SKILL_FILE} frontmatter has no name`);
  if (description === "") throw new SkillInputError(`${SKILL_FILE} frontmatter has no description`);
  // 名字会成为目标文件夹名：不允许分隔符、Windows 非法字符、控制字符、`.` `..` 和以点或空格结尾。
  if (
    FOLDER_UNSAFE.test(name) ||
    CONTROL.test(name) ||
    name === "." ||
    name === ".." ||
    /[. ]$/.test(name) ||
    name.length > 100
  )
    throw new SkillInputError(`skill name "${name}" is not a valid folder name`);
  return { name, description };
}

/** 目标目录：`shared` = `.agents/skills`，`omp` = agent 目录（用户）或项目 `.omp`（项目）下的 `skills`。 */
export function skillsRoot(target: SkillTarget, places: SkillPlaces): string {
  if (places.project === null)
    return target === "shared" ? path.join(places.home, ".agents", "skills") : path.join(places.agentDir, "skills");
  return path.join(places.project, target === "shared" ? ".agents" : ".omp", "skills");
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 把 `source` 复制成 `<root>/<name>`；同名文件夹已存在就拒绝，不合并也不覆盖。 */
export async function copySkillFolder(source: string, root: string, name: string): Promise<string> {
  const dest = path.join(root, name);
  if (await exists(dest)) throw new SkillInputError(`a skill folder named "${name}" already exists in the target`);
  if (isInside(dest, source)) throw new SkillInputError("the target is inside the folder being added");
  await mkdir(root, { recursive: true });
  await cp(source, dest, { recursive: true, errorOnExist: true, force: false });
  return dest;
}

/** 主进程记着最近一次选的文件夹；界面只拿到 token。 */
export class SkillPicker {
  #pending: { token: string; folder: string; name: string } | null = null;

  /** 校验所选文件夹并记下；校验失败抛错（界面显示原因），也清掉上一次的选择。 */
  async pick(folder: string): Promise<SkillCandidate> {
    this.#pending = null;
    const { name, description } = await readSkillFolder(folder);
    const token = randomUUID();
    this.#pending = { token, folder, name };
    return { token, folderName: path.basename(folder), name, description };
  }

  /** 复制到目标；token 对不上（过期或伪造）就拒绝。成功后清掉选择。 */
  async add(token: string, target: SkillTarget, places: SkillPlaces): Promise<{ name: string; folder: string }> {
    const pending = this.#pending;
    if (pending === null || pending.token !== token) throw new SkillInputError("no folder is selected");
    // 复制前重新读一遍：选完之后文件夹可能被改过。
    const current = await readSkillFolder(pending.folder);
    if (current.name !== pending.name) throw new SkillInputError("the skill changed after it was selected");
    const dest = await copySkillFolder(pending.folder, skillsRoot(target, places), pending.name);
    this.#pending = null;
    return { name: pending.name, folder: displayPath(dest, places.home) };
  }
}
