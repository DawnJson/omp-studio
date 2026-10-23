// omp 设置在 omp-studio 里的分组：不照搬 omp 自己的 tab（那是按终端界面的菜单分的），按用户要做的事分。
// 在 TSP（studio 渲染 omp 节点）下没有任何作用的项（终端外观、状态栏、终端里的快捷键和提示等）直接隐藏；
// 其余一律显示，包括这个版本的 omp 还不认识的新键（落进"其他"）——只隐藏确认没用的。
// 逐项的依据和实测结果见 docs/architecture/omp-settings.md「TSP 下的逐项核对」。
import type { OmpConfigItem } from "../ipc.ts";

const configGroups = ["models", "tools", "context", "agents", "behavior", "integrations", "voice", "other"] as const;
export type ConfigGroup = (typeof configGroups)[number];

/** 匹配：键完全相等，或以 `<匹配串>.` 开头（`tools` 命中 `tools.format`，不命中 `toolsX`）。 */
type Matcher = string;

/**
 * 只在终端界面里有意义的项。每一条的理由（实测或 omp 文档）在 omp-settings.md。
 * 排在分组规则前面：命中就隐藏。
 */
const terminalOnly: readonly Matcher[] = [
  "theme",
  "symbolPreset",
  "colorBlindMode",
  "statusLine",
  "tui",
  "display",
  "terminal",
  "showHardwareCursor",
  "composer",
  "input",
  "doubleEscapeAction",
  "treeFilterMode",
  "autocompleteMaxVisible",
  "spelling",
  "emojiAutocomplete",
  "paste",
  "startup",
  "update",
  "marketplace.autoUpdate",
  "title.icons",
  "task.showResolvedModelBadge",
  "goal.statusInFooter",
  "git.enabled",
  "autoResume",
  "setupVersion",
];

const rules: readonly (readonly [ConfigGroup, readonly Matcher[]])[] = [
  ["integrations", ["mcp", "browser", "exa", "searxng", "secrets", "images.urls", "extensionHandlers"]],
  ["voice", ["stt", "tts", "speech", "live"]],
  [
    "models",
    [
      "modelRoleStorage",
      "modelRoles",
      "modelPresets",
      "modelTags",
      "modelProviderOrder",
      "cycleOrder",
      "enabledModels",
      "enabledProviders",
      "disabledProviders",
      "defaultThinkingLevel",
      "thinkingBudgets",
      "omitThinking",
      "proseOnlyThinking",
      "hideThinkingBlock",
      "expandThinkingBlocks",
      "externalThinking",
      "includeModelInPrompt",
      "includeWorkspaceTree",
      "personality",
      "temperature",
      "topP",
      "topK",
      "minP",
      "presencePenalty",
      "repetitionPenalty",
      "textVerbosity",
      "tier",
      "model",
      "retry",
      "providers",
      "provider",
      "prewalk",
      "advisor",
      "features",
      "images",
      "codexResets",
      "claudeResets",
      "auth",
    ],
  ],
  [
    "tools",
    [
      "tools",
      "bash",
      "bashInterceptor",
      "shellMinimizer",
      "shellPath",
      "edit",
      "read",
      "readLineNumbers",
      "todo",
      "tasks",
      "glob",
      "grep",
      "astGrep",
      "astEdit",
      "find",
      "debug",
      "launch",
      "speechgen",
      "generate_image",
      "computer",
      "ratchet",
      "archive",
      "checkpoint",
      "fetch",
      "vault",
      "github",
      "web_search",
      "security",
      "async",
      "lsp",
      "eval",
      "python",
      "ida",
      "inlineToolDescriptors",
    ],
  ],
  [
    "context",
    [
      "compaction",
      "snapcompact",
      "contextPromotion",
      "extendedContext",
      "contextFiles",
      "workspace",
      "branchSummary",
      "memory",
      "memories",
      "mnemopi",
      "hindsight",
      "sharpshooter",
      "autolearn",
      "ttsr",
      "skillful",
    ],
  ],
  [
    "agents",
    [
      "task",
      "isolation",
      "worktree",
      "plan",
      "goal",
      "title",
      "skills",
      "commands",
      "extensions",
      "disabledExtensions",
    ],
  ],
  [
    "behavior",
    [
      "steeringMode",
      "followUpMode",
      "interruptMode",
      "loop",
      "magicKeywords",
      "ask",
      "power",
      "completion",
      "error",
      "recap",
    ],
  ],
];

/** 前缀命中了"终端专用"，但差分实测在 rpc-ui 里确实改变了 get_state 的项：单独放出来。 */
const measuredEffective: readonly Matcher[] = ["tui.reactions"];

function matches(key: string, matcher: Matcher): boolean {
  return key === matcher || key.startsWith(`${matcher}.`);
}

/** 这一项放进哪一组；终端专用的返回 null（不显示）。认不出来的落进 "other"。 */
export function groupOf(key: string): ConfigGroup | null {
  if (measuredEffective.includes(key)) return "behavior";
  if (terminalOnly.some((matcher) => matches(key, matcher))) return null;
  for (const [group, matchers] of rules) if (matchers.some((matcher) => matches(key, matcher))) return group;
  return "other";
}

export function isTerminalOnly(key: string): boolean {
  return groupOf(key) === null;
}

/** 按 omp-studio 的分组归类可见的项；每组内保持 omp 给出的顺序。没有项的组不出现。 */
export function groupConfigItems(items: readonly OmpConfigItem[]): Map<ConfigGroup, OmpConfigItem[]> {
  const byGroup = new Map<ConfigGroup, OmpConfigItem[]>();
  for (const item of items) {
    const group = groupOf(item.key);
    if (group === null) continue;
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(item);
    else byGroup.set(group, [item]);
  }
  return new Map(configGroups.flatMap((group) => (byGroup.has(group) ? [[group, byGroup.get(group)!] as const] : [])));
}
