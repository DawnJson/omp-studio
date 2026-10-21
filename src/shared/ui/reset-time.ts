// 额度重置时间的文案。zh-CN 的 Intl 把"周三"和"13:07"直接连在一起，这里把两段分开格式化再用空格接上（en 本来就是 "Wed 13:07"）。
const dayMs = 24 * 60 * 60 * 1000;

/** 7 天内写"星期 时:分"，更远的写短日期。按本机时区。 */
export function formatQuotaReset(locale: string, resetsAtMs: number, nowMs: number): string {
  if (Math.abs(resetsAtMs - nowMs) >= 7 * dayMs)
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(resetsAtMs);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(resetsAtMs);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(
    resetsAtMs,
  );
  return `${weekday} ${time}`;
}
