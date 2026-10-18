// 最小的外部 store：get / set / subscribe，配合 React 的 useSyncExternalStore。
// 约定：state 不可变；set 传入新对象（没变就别调用），订阅者用选择器取稳定引用。
import { useRef, useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 订阅 store 的一个切片。selector 必须对没变的数据返回同一个引用（不要在里面 map/filter 出新数组）。 */
export function useStoreValue<T, S>(store: Store<T>, selector: (state: T) => S): S {
  // 用 ref 持有最新的 selector：调用方每次渲染传新的箭头函数也不会让订阅重建。
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  return useSyncExternalStore(store.subscribe, () => selectorRef.current(store.get()));
}
