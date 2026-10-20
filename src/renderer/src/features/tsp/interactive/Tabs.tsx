// `tabs`：一排标签，当前的下划线。当前项归 omp：点击发 `select`（item 是标签自己的 id，不是节点 id），收到新的 `active` 才变。
import type { TspTabsProps } from "../../../../../shared/tsp/tsp.generated.ts";
import type { NodeProps } from "../node-props.ts";
import { TspSpans } from "../spans.tsx";

export function Tabs({ node, ctx }: NodeProps) {
  const p = node.p as unknown as TspTabsProps;
  return (
    <div className="tspi-tabs" data-id={node.id} role="tablist">
      {(p.items ?? [])
        .filter((tab) => typeof tab.id === "string")
        .map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            data-tab={tab.id}
            aria-selected={tab.id === p.active}
            className={tab.id === p.active ? "tspi-tab on" : "tspi-tab"}
            onClick={() => ctx.send({ ev: "select", sf: ctx.sf, id: node.id, item: tab.id })}
          >
            <TspSpans text={tab.label} />
          </button>
        ))}
    </div>
  );
}
