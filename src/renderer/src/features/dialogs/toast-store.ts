// toast 队列（spec 4.17 notify / §1.2 Toast）：右下角，5 秒，同类合并。任何功能都可以 pushToast。
import type { NotifyType } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface ToastInput {
  level?: NotifyType;
  message: string;
  action?: { label: string; run(): void };
  durationMs?: number;
  /** 悬停提示：放原始细节（报错原文等），不占版面。 */
  title?: string;
}

export interface Toast {
  id: number;
  level: NotifyType;
  message: string;
  action: ToastInput["action"] | undefined;
  title: string | undefined;
  /** 合并进来的同类提示数（包括它自己）。 */
  count: number;
}

const defaultDurationMs = 5000;
const maxVisible = 4;

const toasts = createStore<readonly Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  toasts.set(toasts.get().filter((toast) => toast.id !== id));
}

function arm(id: number, durationMs: number): void {
  const previous = timers.get(id);
  if (previous !== undefined) clearTimeout(previous);
  timers.set(id, setTimeout(() => dismissToast(id), durationMs));
}

export function pushToast(input: ToastInput): void {
  const level = input.level ?? "info";
  const durationMs = input.durationMs ?? defaultDurationMs;
  const same = input.action ? undefined : toasts.get().find((toast) => toast.level === level && toast.message === input.message && !toast.action);
  if (same) {
    toasts.set(toasts.get().map((toast) => (toast.id === same.id ? { ...toast, count: toast.count + 1 } : toast)));
    arm(same.id, durationMs);
    return;
  }
  const toast: Toast = { id: nextId++, level, message: input.message, action: input.action, title: input.title, count: 1 };
  const next = [...toasts.get(), toast];
  for (const dropped of next.slice(0, Math.max(0, next.length - maxVisible))) dismissToast(dropped.id);
  toasts.set([...toasts.get(), toast].slice(-maxVisible));
  arm(toast.id, durationMs);
}

export function useToasts(): readonly Toast[] {
  return useStoreValue(toasts, (state) => state);
}
