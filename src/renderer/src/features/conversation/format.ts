import type { TFunction } from "../../../../shared/i18n/index.ts";

/** 时长文案：<60 秒 "N 秒"，<1 小时 "M 分 S 秒"，其余 "H 小时 M 分"。 */
export function formatDuration(t: TFunction, ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total >= 3600) return t("duration.hm", { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60) });
  if (total >= 60) return t("duration.ms", { m: Math.floor(total / 60), s: total % 60 });
  return t("duration.s", { s: total });
}
