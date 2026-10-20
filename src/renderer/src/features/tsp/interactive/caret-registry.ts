// editor 和锚在它光标上的 overlay（斜杠菜单）之间的小登记表：
// - overlay 要知道光标在屏幕上的位置（editor 注册一个量位置的函数）；
// - editor 要知道有没有锚在自己光标上的 overlay（打开时 ↑↓ 归 omp，给它的列表用，规范 protocol-input.md）。
import { useSyncExternalStore } from "react";

const probes = new Map<string, () => DOMRect | null>();
const overlays = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (sf: string, id: string) => `${sf}\u0000${id}`;

function bump(): void {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** editor 挂载时登记量光标位置的函数；返回注销函数。 */
export function registerCaretProbe(sf: string, id: string, probe: () => DOMRect | null): () => void {
  const key = keyOf(sf, id);
  probes.set(key, probe);
  bump();
  return () => {
    if (probes.get(key) === probe) probes.delete(key);
    bump();
  };
}

/** editor 在光标可能移动后调用，让订阅的 overlay 重新量。 */
export function notifyCaretMoved(): void {
  bump();
}

/** overlay 挂载时登记自己锚在哪个 editor 上；返回注销函数。 */
export function registerCaretOverlay(sf: string, editorId: string): () => void {
  const key = keyOf(sf, editorId);
  overlays.set(key, (overlays.get(key) ?? 0) + 1);
  bump();
  return () => {
    const n = (overlays.get(key) ?? 1) - 1;
    if (n <= 0) overlays.delete(key);
    else overlays.set(key, n);
    bump();
  };
}

export function caretRect(sf: string, id: string): DOMRect | null {
  return probes.get(keyOf(sf, id))?.() ?? null;
}

/** 订阅登记表变化（光标移动、editor / overlay 增减）；返回版本号，调用方只用它触发重渲染。 */
export function useCaretVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

/** 有没有 overlay 锚在这个 editor 的光标上。 */
export function useCaretOverlayOpen(sf: string, id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => overlays.has(keyOf(sf, id)),
    () => false,
  );
}
