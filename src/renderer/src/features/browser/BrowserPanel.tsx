// 右栏的浏览器面板（spec §4.29）：头部是后退 / 前进 / 刷新、地址栏、关闭；下面的占位区由主进程的页面（WebContentsView）盖住。
// 页面是原生视图，叠在网页上面：占位区的位置变了就告诉主进程；遮罩弹窗开着、或菜单这类浮层压到占位区上时把页面藏起来，否则浮层会被它挡住。
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { BrowserBounds, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { ArrowLeft, ArrowRight, Close, Restart } from "../../icons.tsx";
import { IconButton, TextField } from "../../ui/controls.tsx";
import { reportErrorNow } from "../../ui/errors.ts";
import { scrimsOpen, subscribeScrims } from "../../ui/title-bar-dim.ts";
import { setPreviewWidth, usePreviewWidth } from "../file-preview/preview-store.ts";
import { browserPanelTakesFocus, closeBrowserPanel, setBrowserState, useBrowserState } from "./browser-store.ts";
import "../file-preview/file-preview.css";
import "./browser.css";

const minWidth = 280;
const maxShare = 0.7;
const keyboardStep = 16;

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** body 下的浮层（菜单、下拉、弹窗、toast 都挂在 body 上）有没有压到占位区；原生 title 提示不在页面里，不用管。 */
function coveredByPortal(rect: DOMRect): boolean {
  for (const child of document.body.children) {
    if (child.id === "root" || child.getAttribute("role") === "tooltip") continue;
    const box = child.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && intersects(box, rect)) return true;
  }
  return false;
}

type Placement = BrowserBounds | "covered";

function samePlacement(a: Placement, b: Placement): boolean {
  if (a === "covered" || b === "covered") return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** 把占位区的位置同步给主进程；被挡住时藏起页面，卸载（面板关了、换了任务）时告诉主进程面板关了。 */
function usePlaceBrowser(taskId: TaskId, slot: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const element = slot.current;
    if (element === null) return;
    let frame = 0;
    let last: Placement | undefined;
    const place = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const hidden = scrimsOpen() || rect.width < 1 || rect.height < 1 || coveredByPortal(rect);
      const bounds: Placement = hidden
        ? "covered"
        : {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
      if (last !== undefined && samePlacement(last, bounds)) return;
      last = bounds;
      window.studio.placeBrowser(taskId, bounds).then(setBrowserState, reportErrorNow);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(place);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    // 浮层挂在 body 上：只看 body 的直接子节点增减，不看应用里的改动。
    const portals = new MutationObserver(schedule);
    portals.observe(document.body, { childList: true });
    const offScrims = subscribeScrims(schedule);
    window.addEventListener("resize", schedule);
    // 面板滑入（panel-in）用的是 transform，ResizeObserver 看不到位置变化：动画结束再量一次。
    window.addEventListener("animationend", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      portals.disconnect();
      offScrims();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("animationend", schedule, true);
      window.studio.placeBrowser(taskId, null).catch(reportErrorNow);
    };
  }, [taskId, slot]);
}

export function BrowserPanel({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = usePreviewWidth();
  const state = useBrowserState(taskId);
  // 地址栏：没在改时跟着页面走；改了没回车就保持用户的字。
  const [draft, setDraft] = useState<string | null>(null);
  usePlaceBrowser(taskId, slot);

  // 打开时把焦点放进面板：Esc 才关得掉它；关闭后由 store 还焦点。还没有页面时直接放进地址栏。AI 连上时自动打开的不抢焦点。
  useLayoutEffect(() => {
    if (!browserPanelTakesFocus()) return;
    if ((state?.url ?? "") === "") address.current?.focus({ preventScroll: true });
    else root.current?.focus({ preventScroll: true });
    // 只在打开时决定一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeBrowserPanel();
  };

  const clampWidth = (value: number) => {
    const parent = root.current?.parentElement;
    const max = parent ? parent.clientWidth * maxShare : value;
    return Math.max(minWidth, Math.min(max, value));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: root.current?.offsetWidth ?? minWidth };
  };
  // 向左拖 = 变宽。
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setPreviewWidth(clampWidth(drag.current.startWidth + drag.current.startX - event.clientX));
  };
  const onResizerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const now = root.current?.offsetWidth ?? minWidth;
    setPreviewWidth(clampWidth(now + (event.key === "ArrowLeft" ? keyboardStep : -keyboardStep)));
  };

  const act = (action: "back" | "forward" | "reload" | "stop") =>
    window.studio.browserAction(taskId, action).catch(reportErrorNow);
  const loading = state?.loading ?? false;
  const url = state?.url ?? "";

  return (
    <section
      ref={root}
      className="file-preview browser-panel"
      data-testid="browser-panel"
      aria-label={t("browser.panelLabel")}
      tabIndex={-1}
      style={width === null ? undefined : { flexBasis: width }}
      onKeyDown={onKeyDown}
    >
      <div
        className="file-preview-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("browser.resize")}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={onResizerKey}
      />
      {/* 头部下面是原生页面，提示画在下方会被它盖住 */}
      <header className="file-preview-head browser-head" data-tip-side="top">
        <IconButton
          label={t("browser.back")}
          testId="browser-back"
          disabled={!(state?.canGoBack ?? false)}
          onClick={() => void act("back")}
        >
          <ArrowLeft size={14} />
        </IconButton>
        <IconButton
          label={t("browser.forward")}
          testId="browser-forward"
          disabled={!(state?.canGoForward ?? false)}
          onClick={() => void act("forward")}
        >
          <ArrowRight size={14} />
        </IconButton>
        <IconButton
          label={loading ? t("browser.stop") : t("browser.reload")}
          testId="browser-reload"
          disabled={url === ""}
          onClick={() => void act(loading ? "stop" : "reload")}
        >
          {loading ? <Close size={14} /> : <Restart size={14} />}
        </IconButton>
        <form
          className="browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft === null || draft.trim() === "") return;
            window.studio.navigateBrowser(taskId, draft).then(() => setDraft(null), reportErrorNow);
          }}
        >
          <TextField
            ref={address}
            size="sm"
            width="100%"
            value={draft ?? url}
            onChange={setDraft}
            onBlur={() => {
              if (draft === url) setDraft(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t("browser.address")}
            placeholder={t("browser.address")}
            spellCheck={false}
            testId="browser-address"
          />
        </form>
        <IconButton label={t("browser.close")} testId="browser-close" onClick={() => closeBrowserPanel()}>
          <Close size={14} />
        </IconButton>
      </header>
      <div ref={slot} className="browser-view" data-testid="browser-view" />
    </section>
  );
}
