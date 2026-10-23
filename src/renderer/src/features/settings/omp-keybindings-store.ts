// 转发给 omp 的键位（默认键位 + 用户 keybindings.yml 的覆盖，主进程算好）的渲染进程镜像。
// 没读到之前用默认键位（转发不用等）；之后在输入框 / 过程区拿到焦点、窗口回到前台、打开设置页时静默重读（终端里可能改过文件）。
import type { OmpKeybinding } from "../../../../shared/tsp/omp-keybindings.ts";
import { forwardedChords, resolveOmpKeybindings } from "../../../../shared/tsp/omp-keybindings.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { reportErrorNow } from "../../ui/errors.ts";

interface KeybindingState {
  bindings: readonly OmpKeybinding[];
  chords: ReadonlySet<string>;
}

function stateOf(bindings: readonly OmpKeybinding[]): KeybindingState {
  return { bindings, chords: forwardedChords(bindings) };
}

const store = createStore<KeybindingState>(stateOf(resolveOmpKeybindings(null)));
let loading: Promise<void> | null = null;

/** 重读（同时只有一次在飞）。 */
export function refreshOmpKeybindings(): Promise<void> {
  loading ??= window.studio
    .getOmpKeybindings()
    .then((bindings) => store.set(stateOf(bindings)))
    .catch((error: unknown) => reportErrorNow(error))
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function currentOmpKeybindings(): KeybindingState {
  return store.get();
}

export function useOmpKeybindings(): readonly OmpKeybinding[] {
  return useStoreValue(store, (state) => state.bindings);
}
