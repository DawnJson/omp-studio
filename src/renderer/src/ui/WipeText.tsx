// 换掉的标题从左往右擦出来（spec §2.6「文字变化」）：文字变了就换一个元素（key），新元素放 motion.css 的 wipe-in。
// 第一次挂上不擦：只有挂着时文字变了（任务从"新任务"拿到标题、改名）才擦。减少动效时时长为 0，直接换。
import { useState } from "react";

export function WipeText({ text, className, title }: { text: string; className: string; title?: string | undefined }) {
  const [state, setState] = useState({ text, seq: 0 });
  if (state.text !== text) setState({ text, seq: state.seq + 1 });
  return (
    <span key={state.seq} className={className} title={title} data-wipe={state.seq > 0 || undefined}>
      {text}
    </span>
  );
}
