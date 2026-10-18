// 任务行尾部的相对时间（spec §4.2）：刚刚 / N 分钟 / N 小时 / 昨天 / 日期。所有行共用一个每分钟的时钟。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Locale } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

const clock = createStore<number>(Date.now());
let started = false;

function startClock(): void {
  if (started) return;
  started = true;
  window.setInterval(() => clock.set(Date.now()), 60_000);
}

/** 每分钟更新一次的"现在"。 */
export function useNow(): number {
  startClock();
  return useStoreValue(clock, (state) => state);
}

const minute = 60_000;
const hour = 60 * minute;

export function formatTaskTime(t: TFunction, locale: Locale, timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < minute) return t("time.now");
  if (elapsed < hour) return t("time.minutes", { n: Math.floor(elapsed / minute) });
  if (elapsed < 24 * hour) return t("time.hours", { n: Math.floor(elapsed / hour) });
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (timestamp >= today - 24 * hour && timestamp < today) return t("time.yesterday");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(timestamp);
}
