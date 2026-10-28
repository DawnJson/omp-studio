// 斜杠菜单的命令列表按目录缓存（存在启动缓存里，startup-cache.ts）：取一次就要起一个完整的项目 rpc-ui（project-omp.ts），
// 而打开任务、每次敲 "/" 都会来要。目录的输入指纹（omp、studio 版本 + omp 找命令、skill、扩展、MCP 服务器的那些位置的修改时间，
// 见 slashCommandInputs）和记下时一样就直接给上次的列表，不起 omp；没记过或指纹变了才现取。空列表不记（omp 没就绪）。
// 项目进程主动推来的新列表（available_commands_update）也记下（remember），和推给界面的是同一份。
// 已知盲区：只改已有 skill / 命令文件的内容（描述）不改目录的修改时间；`.claude/commands` 只列到下一层子目录；
// `~/.claude.json`（Claude Code 自己一直在写）不列；MCP 服务器上 prompt 的增减不改任何文件。这些要等别的输入变了或项目进程再推一次才更新。
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AvailableSlashCommand } from "../../shared/omp-wire/rpc-wire.generated.ts";
import type { StartupCache } from "./startup-cache.ts";

/** `.claude/commands` 下最多列多少个子目录。 */
const maxClaudeCommandDirs = 32;

export interface SlashCommandCacheDeps {
  /** 目录的输入指纹（见 slashCommandInputs、input-stamp.ts）。 */
  stamp(dir: string): Promise<string>;
  key(dir: string): string;
  cache: Pick<StartupCache, "slashCommands" | "setSlashCommands">;
}

/**
 * omp 为 `dir` 收集命令（文件命令、skill 命令、扩展命令、MCP prompt 命令）时读的位置（omp://slash-command-internals.md、skills.md、
 * extension-loading.md、marketplace.md、mcp-config.md；omp 18.13.3）。目录列目录本身（增删子项时修改时间变），设置、插件登记、MCP 配置列文件。
 * `configRoot` 是 `<home>/<PI_CONFIG_DIR 或 .omp>`（用户级插件登记在它下面，不在 agent 目录里）。
 * `.claude/commands` 是递归扫的：新文件放进已有子目录时外层的修改时间不变，所以下一层子目录也列进来。
 */
export async function slashCommandInputs(
  dir: string,
  agentDir: string,
  configRoot: string,
  home: string,
): Promise<string[]> {
  const project = [
    ".omp",
    ".omp/config.yml",
    ".omp/settings.json",
    ".omp/commands",
    ".omp/skills",
    ".omp/extensions",
    ".omp/plugins/installed_plugins.json",
    ".omp/plugins/omp-plugins.lock.json",
    ".claude/commands",
    ".claude/skills",
    ".codex/commands",
    ".codex/skills",
    ".opencode/commands",
    ".agent/commands",
    ".agent/skills",
    ".agents/commands",
    ".agents/skills",
    ".github/skills",
    ".omp/mcp.json",
    ".omp/.mcp.json",
    "mcp.json",
    ".mcp.json",
    ".claude/mcp.json",
    ".claude/.mcp.json",
    ".cursor/mcp.json",
    ".vscode/mcp.json",
    ".gemini/settings.json",
  ].map((entry) => path.join(dir, entry));
  const agent = [
    "config.yml",
    "config.yaml",
    "settings.json",
    "commands",
    "skills",
    "managed-skills",
    "extensions",
    "mcp.json",
    ".mcp.json",
  ].map((entry) => path.join(agentDir, entry));
  const plugins = ["installed_plugins.json", "omp-plugins.lock.json"].map((entry) =>
    path.join(configRoot, "plugins", entry),
  );
  const user = [
    ".claude/commands",
    ".claude/skills",
    ".agent/commands",
    ".agent/skills",
    ".agents/commands",
    ".agents/skills",
    ".claude/mcp.json",
    ".cursor/mcp.json",
    ".gemini/settings.json",
  ].map((entry) => path.join(home, entry));
  const claudeCommandDirs = await Promise.all(
    [dir, home].map((root) => subdirectories(path.join(root, ".claude", "commands"))),
  );
  return [...project, ...agent, ...plugins, ...user, ...claudeCommandDirs.flat()];
}

async function subdirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .slice(0, maxClaudeCommandDirs)
    .map((entry) => path.join(root, entry.name));
}

export class SlashCommandCache {
  readonly #deps: SlashCommandCacheDeps;

  constructor(deps: SlashCommandCacheDeps) {
    this.#deps = deps;
  }

  /** `dir` 的命令列表：指纹没变就是上次的，否则 `fetch`（起 omp 去取）并记下。 */
  async list(dir: string, fetch: () => Promise<AvailableSlashCommand[]>): Promise<AvailableSlashCommand[]> {
    const key = this.#deps.key(dir);
    // 先取指纹再取列表：取的期间输入变了，记下的是旧指纹，下次对不上会重取。
    const stamp = await this.#deps.stamp(dir);
    const cached = this.#deps.cache.slashCommands(key, stamp);
    if (cached) return cached;
    const commands = await fetch();
    if (commands.length > 0) this.#deps.cache.setSlashCommands(key, stamp, commands);
    return commands;
  }

  /** omp 主动推来的 `dir` 的新列表。 */
  async remember(dir: string, commands: AvailableSlashCommand[]): Promise<void> {
    if (commands.length === 0) return;
    this.#deps.cache.setSlashCommands(this.#deps.key(dir), await this.#deps.stamp(dir), commands);
  }
}
