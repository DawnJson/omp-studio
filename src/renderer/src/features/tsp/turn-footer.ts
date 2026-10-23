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

/** 脚注的文字和悬停提示（omp 的 `tLo`）。 */
export function formatTurnFooter(footer: TspTurnFooter): { text: string; title: string } {
  const total = footer.input + footer.output;
  const cost = footer.cost > 0 ? formatTurnCost(footer.cost) : undefined;
  const elapsed = footer.elapsedMs === null ? undefined : formatDuration(footer.elapsedMs);
  const short = [elapsed, `${formatTokens(total)} tok`, cost].filter((part) => part !== undefined).join(" · ");
  const detail = `${total.toLocaleString("en-US")} tokens (${footer.input.toLocaleString("en-US")} in · ${footer.output.toLocaleString("en-US")} out)`;
  const long = [elapsed, detail, cost].filter((part) => part !== undefined).join(" · ");
  return { text: `${short} this turn`, title: `This turn: ${long}` };
}
