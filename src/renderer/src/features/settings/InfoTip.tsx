// ⓘ 说明：设置项的描述不在标签下面另起一行灰字，而是放在这里（悬停、键盘聚焦、点击都能看）。
// 悬停 250 ms 后出现，离开消失；点击固定住，点外面或 Esc 关闭（Esc 只关它，不退出设置页）。
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n/use-t.ts";

const hoverDelayMs = 250;

export function InfoTip({ children }: { children: ReactNode }) {
  const t = useT();
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [pinned, setPinned] = useState(false);

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
    <span ref={root} className="st-tip" onMouseEnter={() => show(hoverDelayMs)} onMouseLeave={hide}>
      <button
        type="button"
        className="st-tip-btn"
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
          setPinned(false);
          setShown(false);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="var(--icon-stroke)" strokeLinecap="round" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7.2v3.6" />
          <circle cx="8" cy="5" r=".4" />
        </svg>
      </button>
      {shown && (
        <span role="tooltip" id={id} className="st-tip-pop">
          {children}
        </span>
      )}
    </span>
  );
}
