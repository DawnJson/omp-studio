// 整个窗口同一时刻只显示一条 toast（规范 elements-chrome.md#toast）：新的替换旧的。
// 停留 2.2 秒（success）或 5.2 秒（info / error），`ttl` 只能缩短；到点淡出 260ms（ttl 触发的 200ms）。
import { useSyncExternalStore } from "react";

export type ToastTone = "success" | "info" | "error";

export interface ToastData {
  text: string;
  sub?: string | undefined;
  tone: ToastTone;
  ttl?: number | undefined;
}

export interface ToastState extends ToastData {
  /** 哪个节点实例的（节点移除时只收自己的）。 */
  owner: string;
  leaving: boolean;
}

export const SUCCESS_STAY_MS = 2200;
export const INFO_STAY_MS = 5200;
export const FADE_MS = 260;
export const TTL_FADE_MS = 200;

/** `tone` 属性 → 显示的类别：error 为错误，info / accent 为提示，其余为成功。 */
export function toastTone(tone: unknown): ToastTone {
  if (tone === "error") return "error";
  if (tone === "info" || tone === "accent") return "info";
  return "success";
}

/** 实际停留多久（ms）：默认由 tone 定，ttl 只能缩短，负数忽略。 */
export function stayMs(tone: ToastTone, ttl: number | undefined): number {
  const base = tone === "success" ? SUCCESS_STAY_MS : INFO_STAY_MS;
  if (ttl === undefined || !Number.isFinite(ttl) || ttl < 0) return base;
  return Math.min(base, Math.trunc(ttl));
}

let current: ToastState | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const listeners = new Set<() => void>();

function emit(next: ToastState | null): void {
  current = next;
  for (const l of listeners) l();
}

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

export function showToast(owner: string, data: ToastData, reducedMotion: boolean): void {
  clearTimers();
  emit({ ...data, owner, leaving: false });
  const early =
    data.ttl !== undefined && stayMs(data.tone, data.ttl) < (data.tone === "success" ? SUCCESS_STAY_MS : INFO_STAY_MS);
  const fade = reducedMotion ? 0 : early ? TTL_FADE_MS : FADE_MS;
  timers.push(
    setTimeout(
      () => {
        if (current?.owner === owner) emit({ ...current, leaving: true });
        timers.push(
          setTimeout(() => {
            if (current?.owner === owner) emit(null);
          }, fade),
        );
      },
      stayMs(data.tone, data.ttl),
    ),
  );
}

/** 节点被移除：它的 toast 还在显示就收掉。 */
export function hideToast(owner: string): void {
  if (current?.owner !== owner) return;
  clearTimers();
  emit(null);
}

export function useToast(): ToastState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
