// 输入框高度（用户拖出来的）：整个应用一个值，记在 localStorage（和 ModelPicker 的最近使用同一种存法），null = 自动增高。
import { createStore, useStoreValue } from "../../store/create-store.ts";

const storageKey = "composer.fieldHeight";

function read(): number | null {
  const stored = Number(localStorage.getItem(storageKey));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

const store = createStore<number | null>(read());

export function useFieldHeight(): number | null {
  return useStoreValue(store, (height) => height);
}

/** 拖动中：只改内存，不落盘。 */
export function previewFieldHeight(height: number | null): void {
  store.set(height);
}

/** 松手 / 键盘调整 / 双击还原（null）：写进 localStorage。 */
export function commitFieldHeight(height: number | null): void {
  store.set(height);
  if (height === null) localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, String(Math.round(height)));
}
