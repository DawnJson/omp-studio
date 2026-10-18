// omp 状态（发现、接管询问、安装进度、就绪）：getOmpStatus 的结果加 ompStatus 事件。
import type { OmpStatus } from "../../../shared/ipc.ts";
import { createStore, useStoreValue } from "./create-store.ts";

const ompStore = createStore<OmpStatus | null>(null);

export function startOmpStore(): void {
  window.studio.onOmpStatus((status) => ompStore.set(status));
  window.studio.getOmpStatus().then(
    // 事件比 getOmpStatus 的应答新时不要覆盖。
    (status) => {
      if (ompStore.get() === null) ompStore.set(status);
    },
    (error: unknown) => console.error("getOmpStatus 失败", error),
  );
}

/** 启动初期（还没收到任何状态）为 null。 */
export function useOmpStatus(): OmpStatus | null {
  return useStoreValue(ompStore, (state) => state);
}
