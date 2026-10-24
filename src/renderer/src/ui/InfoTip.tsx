// ⓘ 说明：设置项、表单字段的描述不在标签下面另起一行灰字，而是放在这里（悬停、键盘聚焦、点击都能看）。
// 悬停 250 ms 后出现，离开消失；点击固定住，点外面或 Esc 关闭（Esc 只关它，不退出设置页）。
// 跟在文字后面（.ui-info 是行内块，基线下移 0.125em），英文标签折两行时 ⓘ 跟着最后一个词。
// 弹层挂到 body 上、按 ⓘ 的位置 fixed 定位（对话框正文是 overflow: auto，放在里面会被裁掉）：默认从 ⓘ 左边往右展开、
// 在 ⓘ 下方；右边放不下往左挪，下方放不下放上方，始终在窗口内。滚动时收起（fixed 的弹层不跟着滚）。
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/use-t.ts";
import { Info } from "../icons.tsx";
import { usePresence } from "./presence.ts";

const hoverDelayMs = 250;
const edgePx = 8;
const gapPx = 6;

export function InfoTip({ children }: { children: ReactNode }) {
  const t = useT();
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const presence = usePresence(shown, "fade");

  // 先不可见地画出来量尺寸，再按 ⓘ 定位（布局阶段完成，不闪）。
  useLayoutEffect(() => {
    const element = pop.current;
    const anchor = root.current;
    if (!presence.mounted || element === null || anchor === null) {
      setStyle({ visibility: "hidden" });
      return;
    }
    const a = anchor.getBoundingClientRect();
    const { width, height } = element.getBoundingClientRect();
    const below = a.bottom + gapPx;
    const top = below + height + edgePx <= window.innerHeight ? below : Math.max(edgePx, a.top - gapPx - height);
    const left = Math.min(Math.max(edgePx, a.left - edgePx), window.innerWidth - edgePx - width);
    setStyle({ top, left });
  }, [presence.mounted]);

  useEffect(() => {
    if (!presence.mounted) return;
    const close = () => {
      setPinned(false);
      setShown(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [presence.mounted]);

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (root.current?.contains(target) || pop.current?.contains(target))) return;
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
      {presence.mounted &&
        createPortal(
          <span ref={pop} role="tooltip" id={id} className="ui-info-pop" style={style} {...presence.exitProps}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
