// 输入历史（↑ 翻看、Ctrl+R 搜索）的纯逻辑，主进程（落盘）和渲染进程（翻看、搜索）共用。
// studio 自己持久化（userData/input-history.json，按项目分开），不读 omp 的 history.db。

/** 每个项目最多留多少条。 */
export const MAX_HISTORY = 200;
/** 单条最长字符数：更长的（几乎一定是整段粘贴）不记，免得历史文件被一条消息撑大。 */
export const MAX_HISTORY_CHARS = 20_000;

/** 追加一条：空的、太长的、和上一条相同的不记；超过上限丢最旧的。 */
export function pushEntry(entries: readonly string[], text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_HISTORY_CHARS || entries[entries.length - 1] === trimmed)
    return [...entries];
  return [...entries, trimmed].slice(-MAX_HISTORY);
}

/**
 * Ctrl+R 的搜索：`entries` 从旧到新，结果从新到旧、同一条只留最新的。
 * 查询按空白切成几个词，每个词都要出现（不分大小写，顺序随意）；空查询返回全部。
 */
export function searchHistory(entries: readonly string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const found: string[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const text = entries[index] ?? "";
    if (seen.has(text)) continue;
    seen.add(text);
    const lower = text.toLowerCase();
    if (words.every((word) => lower.includes(word))) found.push(text);
  }
  return found;
}
