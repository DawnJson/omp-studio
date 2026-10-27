// omp-studio 自身的更新状态：getUpdateState 的结果加 updateState 事件。
import type { UpdateState } from "../../../shared/ipc.ts";
import { createStore, useStoreValue } from "./create-store.ts";

const updateStore = createStore<UpdateState | null>(null);

export function startUpdateStore(): void {
  window.studio.onUpdateState((state) => updateStore.set(state));
  window.studio.getUpdateState().then(
    // 事件比 getUpdateState 的应答新时不要覆盖。
    (state) => {
      if (updateStore.get() === null) updateStore.set(state);
    },
    (error: unknown) => console.error("getUpdateState 失败", error),
  );
}

/** 还没收到任何状态时为 null。 */
export function useUpdateState(): UpdateState | null {
  return useStoreValue(updateStore, (state) => state);
}

/** 新版本已下载好时是它的版本号（没写版本号时 "?"），否则 null；只在这个值变了时重渲染（下载进度事件很密）。 */
export function useDownloadedVersion(): string | null {
  return useStoreValue(updateStore, (state) => (state?.phase === "downloaded" ? (state.latestVersion ?? "?") : null));
}
