// 审批 select 的显示规则（spec 4.17）：按键位置决定行为，标签只影响显示。
// 只对精确匹配的 Approve / Deny / "Approve <tool> for this session" 本地化，其余原样显示，不报错、不丢选项。
// 真实帧见 fixtures/rpc/approval-select.ndjson（omp 18.12.1）：title = "Allow tool: bash\nCommand: echo ..."，options = [Approve, Approve bash for this session, Deny]。
import type { TFunction } from "../../../../shared/i18n/index.ts";

export function approvalOptionLabel(option: string, t: TFunction): string {
  if (option === "Approve") return t("gate.allow");
  if (option === "Deny") return t("gate.deny");
  const session = /^Approve (.+) for this session$/.exec(option);
  if (session?.[1]) return t("gate.allowTool", { tool: session[1] });
  return option;
}

/** 请求正文：第一行是标题（"Allow tool: bash"），其余行是细节（Command: …、Path: …）。 */
export function splitTitle(title: string): { headline: string; details: string } {
  const newline = title.indexOf("\n");
  if (newline === -1) return { headline: title, details: "" };
  return { headline: title.slice(0, newline), details: title.slice(newline + 1).replace(/\s+$/, "") };
}

/** 标题首行 "Allow tool: bash" → 工具名；对不上返回 null（按原文显示）。 */
export function approvalTool(headline: string): string | null {
  return /^Allow tool: (.+)$/.exec(headline)?.[1] ?? null;
}

/** 细节行去掉 "Command: " 前缀（只剩命令本身）；其它前缀（Path: 等）保留。 */
export function stripCommandPrefix(details: string): string {
  return details.replace(/^Command: /, "");
}

/** 审批的"拒绝"选项：最后一项（主进程识别审批时已确认它是 Deny）。 */
export function denyOption(options: readonly string[]): string | null {
  return options.length > 0 ? (options[options.length - 1] ?? null) : null;
}
