// 每轮用量脚注（omp.turn.usage）的文字：omp 恢复会话时不重发这一行，studio 用会话文件算出的数据补一行。
// 格式和 omp 的 `tLo`（packages/tui/src/overlays/usage-row.ts）完全一致（"13.4s · 728 tok · <$0.01 this turn"，悬停 "This turn: …"），
// 恢复出来的行和实时的行写法相同；"this turn" 是 omp 自己写死的英文，不走 i18n。
import type { TspTurnFooter } from "../../../../shared/ipc.ts";

/** omp 的费用写法：不到半分钱 `<$0.01`，否则两位小数。 */
function formatTurnCost(usd: number): string {
  return usd < 0.005 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** omp 的 `bt`：毫秒 → 244ms / 13.4s / 2m5s / 1h3m / 2d4h。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.floor(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
  }
  if (ms < 86_400_000) {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return hours > 0 ? `${days}d${hours}h` : `${days}d`;
}

/** omp 的 `_e`：token 数 → 728 / 1.2K / 13K / 1.5M。 */
export function formatTokens(count: number): string {
  const one = (value: number): string => {
    const text = value.toFixed(1);
    return text.endsWith(".0") ? text.slice(0, -2) : text;
  };
  if (count < 1000) return String(count);
  if (count < 10_000) return `${one(count / 1000)}K`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}K`;
  if (count < 10_000_000) return `${one(count / 1_000_000)}M`;
  if (count < 1_000_000_000) return `${Math.round(count / 1_000_000)}M`;
  return `${one(count / 1_000_000_000)}B`;
}

/** 回答完成的时刻，写法同 omp 用户消息时间的悬停（"2026/10/22 02:47:57"，本地时间）。 */
export function formatFinishedAt(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 脚注的文字和悬停提示（omp 的 `tLo`）；悬停再加一行回答完成的时刻（omp 没有，studio 补）。 */
export function formatTurnFooter(footer: TspTurnFooter): { text: string; title: string } {
  const total = footer.input + footer.output;
  const cost = footer.cost > 0 ? formatTurnCost(footer.cost) : undefined;
  const elapsed = footer.elapsedMs === null ? undefined : formatDuration(footer.elapsedMs);
  const short = [elapsed, `${formatTokens(total)} tok`, cost].filter((part) => part !== undefined).join(" · ");
  const detail = `${total.toLocaleString("en-US")} tokens (${footer.input.toLocaleString("en-US")} in · ${footer.output.toLocaleString("en-US")} out)`;
  const long = [elapsed, detail, cost].filter((part) => part !== undefined).join(" · ");
  return { text: `${short} this turn`, title: withFinishedAt(`This turn: ${long}`, footer.completedAt) };
}

/** 用量行的悬停加上回答完成的时刻（omp 实时画的用量行也用它）；没有时刻时原样返回。 */
export function withFinishedAt(title: string, completedAt: number | null): string {
  return completedAt === null ? title : `${title}\nFinished ${formatFinishedAt(completedAt)}`;
}
