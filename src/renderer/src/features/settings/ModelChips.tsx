// 自定义 provider 卡片的模型一行：一个模型一个小标签，只排一行，放不下的收成 `+N`；悬停列出全部模型。
// 量法：标签全部留在 DOM 里（收起的设 visibility: hidden，不影响前面标签的位置），量出能放下几个，`+N` 绝对定位在最后一个露出的标签后面。
import { useLayoutEffect, useRef, useState } from "react";

export function ModelChips({ ids, testId }: { ids: readonly string[]; testId?: string | undefined }) {
  const box = useRef<HTMLSpanElement>(null);
  const more = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ shown: number; left: number }>({ shown: ids.length, left: 0 });
  // 父组件每次渲染都给新数组：按内容重量，状态没变不 set，免得量 → 渲染 → 再量地转圈。
  const key = ids.join("\n");
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const apply = (shown: number, left: number) =>
      setFit((current) => (current.shown === shown && current.left === left ? current : { shown, left }));
    const measure = () => {
      const chips = [...element.querySelectorAll<HTMLElement>(":scope > .cp-chip:not(.cp-chip-more)")];
      const width = element.clientWidth;
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      const rights = chips.map((chip) => chip.offsetLeft + chip.offsetWidth);
      if (rights.length === 0 || (rights.at(-1) ?? 0) <= width) {
        apply(chips.length, 0);
        return;
      }
      const plus = more.current?.offsetWidth ?? 0;
      let shown = 0;
      while (shown < chips.length && (rights[shown] ?? 0) + gap + plus <= width) shown++;
      apply(shown, shown === 0 ? 0 : (rights[shown - 1] ?? 0) + gap);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  const hidden = ids.length - fit.shown;
  return (
    <span ref={box} className="cp-chips" title={ids.join("\n")} data-testid={testId}>
      {ids.map((id, index) => (
        <span key={id} className="cp-chip" data-cut={index >= fit.shown || undefined}>
          {id}
        </span>
      ))}
      <span
        ref={more}
        className="cp-chip cp-chip-more"
        style={{ left: fit.left }}
        data-cut={hidden === 0 || undefined}
        aria-hidden={hidden === 0 || undefined}
      >
        +{hidden}
      </span>
    </span>
  );
}
