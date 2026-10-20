// 折叠状态（规范 Layout/card "Collapse state is local"）：用户翻一下立刻生效、不等往返，
// 记在 (任务, surface, 父节点, key 或 id) 上——同一父节点下删掉再加一个同 key 的节点，折叠状态保留。
// `collapsed` 属性是起始状态：用户翻过之后本地状态说了算，直到程序发来一个不同的 collapsed 值才重置。
import { useCallback } from "react";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import type { NodeProps } from "./node-props.ts";

interface Fold {
  /** 用户翻的时候程序给的 collapsed 值（用来识别"程序发了不同的值"）。 */
  prop: boolean;
  value: boolean;
}

const folds = createStore<Readonly<Record<string, Fold>>>({});

function foldKey({ node, ctx }: NodeProps): string {
  const key = typeof node.p.key === "string" ? node.p.key : node.id;
  return `${ctx.taskId}\u0000${ctx.sf}\u0000${node.parent ?? ""}\u0000${key}`;
}

/** 当前折叠状态和翻转函数；翻转时发 `toggle` 事件。`initial` 是程序给的 collapsed。 */
export function useFold(props: NodeProps, initial: boolean): [collapsed: boolean, toggle: () => void] {
  const { node, ctx } = props;
  const key = foldKey(props);
  const entry = useStoreValue(folds, (state) => state[key]);
  const collapsed = entry !== undefined && entry.prop === initial ? entry.value : initial;
  const nodeKey = typeof node.p.key === "string" ? node.p.key : undefined;
  const toggle = useCallback(() => {
    const next = !collapsed;
    folds.set({ ...folds.get(), [key]: { prop: initial, value: next } });
    ctx.send(
      nodeKey === undefined
        ? { ev: "toggle", sf: ctx.sf, id: node.id, collapsed: next }
        : { ev: "toggle", sf: ctx.sf, id: node.id, key: nodeKey, collapsed: next },
    );
  }, [collapsed, key, initial, ctx, node.id, nodeKey]);
  return [collapsed, toggle];
}
