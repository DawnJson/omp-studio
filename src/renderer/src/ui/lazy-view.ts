// 按需加载的视图组件（各自一个 chunk，不进入口包）。
// 不用 React.lazy + Suspense：Suspense 从 fallback 换成内容时，React 要等到上一次显示 fallback 之后满 300ms
// （react-dom 的 fallback 节流），第一次打开设置、终端、命令面板因此慢了约 250ms（2026-10-27 实测，chunk 已预载也一样）。
// 这里 chunk 到之前什么也不画，到了立刻画；加载失败弹错误，下次再用时重试。
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { reportErrorNow } from "./errors.ts";

export interface LazyView<P extends object> {
  View: (props: P) => ReactNode;
  /** 提前载入 chunk（窗口淡入后空闲时），第一次打开时直接画。 */
  preload: () => Promise<void>;
}

export function lazyView<P extends object>(load: () => Promise<ComponentType<P>>): LazyView<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const preload = (): Promise<void> =>
    (pending ??= load().then(
      (component) => {
        loaded = component;
      },
      (error: unknown) => {
        pending = null;
        reportErrorNow(error);
      },
    ));
  function View(props: P): ReactNode {
    const [, setReady] = useState(loaded !== null);
    useEffect(() => {
      if (loaded !== null) return;
      let alive = true;
      void preload().then(() => {
        if (alive && loaded !== null) setReady(true);
      });
      return () => {
        alive = false;
      };
    }, []);
    return loaded === null ? null : createElement(loaded, props);
  }
  return { View, preload };
}
