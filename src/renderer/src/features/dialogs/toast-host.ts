// omp 自己的 toast（features/tsp/interactive/Toast.tsx）画进 studio toast 叠放区里的这个容器，两者同一个位置、同一个外观。
import { createStore, useStoreValue } from "../../store/create-store.ts";

const host = createStore<HTMLElement | null>(null);

/** Toasts.tsx 的容器 ref 回调。 */
export function setToastHost(element: HTMLElement | null): void {
  host.set(element);
}

/** 还没挂上（或已卸载）时为 null。 */
export function useToastHost(): HTMLElement | null {
  return useStoreValue(host, (element) => element);
}
