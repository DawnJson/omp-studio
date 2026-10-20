// 不认识的节点种类（规范："未知种类按 div 画"）：把它的文字和子节点按纯文本画出来，并在控制台警告一次。
import { useEffect } from "react";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { plainText } from "../spans.tsx";
import { TspChildren } from "../TspChildren.tsx";
import type { TspText } from "../../../../../shared/tsp/tsp.generated.ts";

const warned = new Set<string>();

function ownText(p: Readonly<Record<string, unknown>>): string {
  for (const key of ["text", "spans", "label", "head", "title"]) {
    const value = p[key];
    if (typeof value === "string" || Array.isArray(value)) return plainText(value as TspText);
  }
  return "";
}

export function TextFallback(props: NodeProps) {
  const { node } = props;
  useEffect(() => {
    if (warned.has(node.k)) return;
    warned.add(node.k);
    console.warn(`TSP: 不认识的节点种类 "${node.k}"，按纯文本画`);
  }, [node.k]);
  const text = ownText(node.p);
  return (
    <div {...nodeDomProps(props, "tsp-fallback")} data-kind={node.k}>
      {text}
      <TspChildren {...props} />
    </div>
  );
}
