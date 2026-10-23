// `tabs`：一排标签，当前的下划线。当前项归 omp：点击发 `select`（item 是标签自己的 id，不是节点 id），收到新的 `active` 才变。
// `actions.click: "activate"`（模型 / 代理中心的 chip 条）时发 `activate`，按规范 actions 的约定。
import type { TspTabsProps } from "../../../../../shared/tsp/tsp.generated.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { TspSpans } from "../spans.tsx";

export function Tabs(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p as unknown as TspTabsProps;
  const actions = node.p.actions;
  const ev = isRecord(actions) && actions.click === "activate" ? "activate" : "select";
  return (
    <div {...nodeDomProps(props, "ui-tabs", { pointer: false })} role="tablist">
      {(p.items ?? [])
        .filter((tab) => typeof tab.id === "string")
        .map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            data-tab={tab.id}
            aria-selected={tab.id === p.active}
            className="ui-tab"
            onClick={() => ctx.send({ ev, sf: ctx.sf, id: node.id, item: tab.id })}
          >
            <TspSpans text={tab.label} />
          </button>
        ))}
    </div>
  );
}
