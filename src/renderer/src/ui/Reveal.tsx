// 折叠区域：展开时高度从 0 长到内容高、收起时缩回 0 再卸载（不是瞬间出现/消失）。
// 用 grid-template-rows 0fr <-> 1fr 的动画（motion.css 的 .reveal），不用量高度；
// 只在动画进行中裁剪溢出，平时不裁，里面的焦点环和弹层照常显示。
import { useState, type ReactNode } from "react";
import { usePresence } from "./presence.ts";

interface RevealProps {
  open: boolean;
  children: ReactNode;
  className?: string | undefined;
  /** 透传给外层，测试和 aria-controls 用。 */
  id?: string | undefined;
  testId?: string | undefined;
}

export function Reveal({ open, children, className, id, testId }: RevealProps) {
  const presence = usePresence(open);
  // 首次渲染就是展开的（启动时、切任务时）不放展开动画，只有用户展开才放。
  const [entering, setEntering] = useState(!open);
  if (!presence.mounted) {
    if (!entering) setEntering(true);
    return null;
  }
  return (
    <div
      id={id}
      data-testid={testId}
      className={className ? `reveal ${className}` : "reveal"}
      data-phase={presence.closing ? "exit" : entering ? "enter" : undefined}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (presence.closing) presence.exitProps.onAnimationEnd(event);
        else setEntering(false);
      }}
    >
      <div className="reveal-inner">{children}</div>
    </div>
  );
}
