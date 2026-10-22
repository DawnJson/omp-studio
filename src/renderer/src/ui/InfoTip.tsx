// ⓘ 说明：设置项、表单字段的描述不在标签下面另起一行灰字，而是放在这里（悬停、键盘聚焦、点击都能看）。
// 悬停 250 ms 后出现，离开消失；点击固定住，点外面或 Esc 关闭（Esc 只关它，不退出设置页）。
// 跟在文字后面（.ui-info 是行内块，基线下移 0.125em），英文标签折两行时 ⓘ 跟着最后一个词。
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n/use-t.ts";
import { Info } from "../icons.tsx";
import { usePresence } from "./presence.ts";

const hoverDelayMs = 250;

export function InfoTip({ children }: { children: ReactNode }) {
  const t = useT();
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [pinned, setPinned] = useState(false);
  const presence = usePresence(shown, "fade");

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setPinned(false);
      setShown(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pinned]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (!pinned) setShown(false);
  };

  return (
    <span ref={root} className="ui-info" onMouseEnter={() => show(hoverDelayMs)} onMouseLeave={hide}>
      <button
        type="button"
        className="ui-info-btn"
        aria-label={t("settings.tip")}
        aria-expanded={shown}
        aria-describedby={shown ? id : undefined}
        onFocus={() => show(0)}
        onBlur={hide}
        onClick={() => {
          setPinned(!pinned);
          setShown(!pinned);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !shown) return;
          event.preventDefault();
          event.stopPropagation();
          setPinned(false);
          setShown(false);
        }}
      >
        <Info size={14} />
      </button>
      {presence.mounted && (
        <span role="tooltip" id={id} className="ui-info-pop" {...presence.exitProps}>
          {children}
        </span>
      )}
    </span>
  );
}
