// 样式片段的 token 解析（纯函数，不依赖 React / window）：`s` 里的语义 token 和 omp 主题 token → 语义 token / tsp-t-* 类。
// omp 的主题 token 按规范 Text 那张映射表落到最近的语义 token；调色板（t 消息）不参与着色，原因见 tsp.css 顶部注释。

const SEMANTIC = new Set([
  "muted",
  "dim",
  "strong",
  "em",
  "accent",
  "success",
  "warning",
  "error",
  "info",
  "code",
  "mono",
  "path",
  "key",
  "link",
  "num",
  "ins",
  "del",
  "mark",
  "typo",
  "icon",
  "hide",
]);

/** omp 主题 token → 语义 token（规范 Text 的映射表）；空串 = 不着色。 */
const OMP_TOKENS: Record<string, string> = {};
const OMP_TABLE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["", ["text", "customMessageText", "syntaxVariable", "toolOutput", "userMessageText"]],
  [
    "accent",
    ["borderAccent", "customMessageLabel", "mdListBullet", "statusLineModel", "syntaxFunction", "thinkingMedium"],
  ],
  ["dim", ["borderMuted", "statusLineSep", "thinkingOff"]],
  [
    "muted",
    [
      "border",
      "mdCodeBlockBorder",
      "mdHr",
      "mdLinkUrl",
      "mdQuote",
      "mdQuoteBorder",
      "statusLineOutput",
      "statusLineSpend",
      "statusLineUntracked",
      "syntaxComment",
      "syntaxOperator",
      "syntaxPunctuation",
      "thinkingText",
      "thinkingMinimal",
      "toolDiffContext",
    ],
  ],
  ["error", ["thinkingXhigh", "thinkingMax", "toolDiffRemoved"]],
  ["success", ["statusLineCost", "statusLineGitClean", "statusLineStaged", "syntaxString"]],
  ["warning", ["bashMode", "statusLineDirty", "statusLineGitDirty", "thinkingHigh"]],
  ["info", ["pythonMode", "statusLineContext", "statusLineSubagents", "syntaxKeyword", "syntaxType", "thinkingLow"]],
  ["code", ["mdCode"]],
  ["mono", ["mdCodeBlock"]],
  ["strong", ["mdHeading", "toolTitle"]],
  ["link", ["mdLink"]],
  ["path", ["statusLinePath"]],
  ["num", ["syntaxNumber"]],
  ["ins", ["toolDiffAdded"]],
];
for (const [semantic, names] of OMP_TABLE) for (const name of names) OMP_TOKENS[name] = semantic;

/** omp 主题 token 或语义 token → 语义 token；不认识或不着色返回 null。 */
export function semanticOf(token: string): string | null {
  if (SEMANTIC.has(token)) return token;
  const mapped = OMP_TOKENS[token];
  return mapped ? mapped : null;
}

/** `s` 的 token 列表 → 语义 token 去重后的数组。未知 token 丢弃。 */
export function spanTokens(s: string | undefined): string[] {
  if (!s) return [];
  const out = new Set<string>();
  for (const token of s.split(/\s+/)) {
    if (token === "") continue;
    if (SEMANTIC.has(token)) out.add(token);
    else {
      const mapped = OMP_TOKENS[token];
      if (mapped) out.add(mapped);
    }
  }
  return [...out];
}

/** `s` → className（tsp-t-*）；没有可画的 token 返回 undefined。 */
export function spanClass(s: string | undefined): string | undefined {
  const tokens = spanTokens(s);
  return tokens.length === 0 ? undefined : tokens.map((token) => `tsp-t-${token}`).join(" ");
}

// Nerd Font 图标码位（私有区 U+E000–U+F8FF 和 15/16 平面）：我们没有那套字体，画出来是方框。
// 键盘键帽那几个（Material Design Icons 的 apple-keyboard-* / keyboard-*）换成对应的符号，其余的不画。
const ICON_GLYPHS = /[\uE000-\uF8FF\u{F0000}-\u{10FFFF}]/gu;
const KEYBOARD_GLYPHS: Readonly<Record<number, string>> = {
  0xf0632: "⇪",
  0xf0633: "⌘",
  0xf0634: "⌃",
  0xf0635: "⌥",
  0xf0636: "⇧",
  0xf0311: "⏎",
  0xf0312: "⇥",
  0xf12b7: "Esc",
};

export function cleanGlyphs(text: string): string {
  return text.replace(ICON_GLYPHS, (glyph) => KEYBOARD_GLYPHS[glyph.codePointAt(0) ?? 0] ?? "");
}
