// `web`（omp 19，规范 TspWebProps）：回答里内嵌的网页（回复里单独一行 `<iframe src>`，omp ui/transcript/figures/embed.tsx；
// hello 声明了 `web` 才发，否则 omp 退回一行说明文字）。规范：不点不交互，点一下拿焦点，Esc 离开，闲下来换成静态画面。
//   - 网页（http/https）：iframe 直接载入那个地址（所有者批准：omp 内嵌的地址可以加载，2026-11-26）。sandbox 给 allow-scripts +
//     allow-same-origin（网页用它自己的源，和应用页面 app://studio 不同源，碰不到应用）+ allow-forms；不给 allow-top-navigation /
//     allow-popups。框架里只能导航到别的网页（主进程 window/web-frames.ts 的 guardFrames）；拿不到 preload，权限一律拒绝。
//   - 本地文件（file://）：不直接载入 file://。和回答里的本地图片一样经主进程 readPreviewFile 读（只读任务目录和已加入的工作区，
//     有大小上限），是网页才登记成 studio-preview://<token>/（文件预览同一条路，响应头 CSP 不许联网）；脚本在点了之后才放行
//     （和预览里勾"运行脚本"一样是用户的明确动作）。读不到、不是网页就只画静态卡片。
//   - 不交互时盖一层透明的接点击层，指针事件到不了网页；点了拿焦点（iframe.focus()），按键进网页。离开：焦点在网页里按 Esc
//     （按键到不了应用页面，主进程 relayFrameEscape 转来 frameEscape）、或在网页外按下指针。
//   - 闲下来 = 滚出视口：卸掉 iframe，换成静态卡片（标题、地址、在浏览器 / 预览里打开）。不截真实画面：截图要主进程 capturePage
//     加一条 IPC，回来时网页还是要重新载入，卡片已经够认出是哪一页。卡片滚回视口自动重新载入；点卡片直接进入交互。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { previewUrl } from "../../../../../shared/ipc.ts";
import type { TspWebProps } from "../../../../../shared/tsp/tsp.generated.ts";
import { reportErrorNow } from "../../../ui/errors.ts";
import { openHref } from "../actions.ts";
import { TspIcon } from "../icons.tsx";
import { labels } from "../labels.ts";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import "./web.css";

type Mode = "still" | "live" | "focused";

/** CSS 长度只认数字 + 常见单位（规范例子：50%、400px、60vw、80ch、30em），其余按没给处理。 */
const LENGTH = /^\d+(?:\.\d+)?(?:px|%|vw|vh|ch|em|rem)$/;

function cssLength(value: unknown): string | undefined {
  return typeof value === "string" && LENGTH.test(value.trim()) ? value.trim() : undefined;
}

type Source = { kind: "web"; url: string } | { kind: "file"; path: string } | null;

/** omp 给的地址：http/https 原样用；file:// 换成本机路径（网络共享不读）；其余不载入。 */
function sourceOf(url: string): Source {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return { kind: "web", url: parsed.href };
  if (parsed.protocol !== "file:" || parsed.host !== "") return null;
  const path = decodeURIComponent(parsed.pathname);
  return { kind: "file", path: /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path };
}

/** 本地网页：经主进程读、登记成 studio-preview 地址；不是网页、读不到时为 null。卸载或换文件时放手。 */
function useLocalPage(taskId: NodeProps["ctx"]["taskId"], path: string | null): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setToken(null);
    if (path === null) return undefined;
    let gone = false;
    const registered = window.studio
      .readPreviewFile({ kind: "task", taskId }, path)
      .then((file) => (file.kind === "html" ? window.studio.registerHtmlPreview(file.text ?? "") : null));
    registered.then((value) => {
      if (!gone) setToken(value);
    }, reportErrorNow);
    return () => {
      gone = true;
      void registered
        .then(
          (value) => (value === null ? undefined : window.studio.releaseHtmlPreview(value)),
          () => undefined,
        )
        .catch(reportErrorNow);
    };
  }, [taskId, path]);
  return token;
}

export function Web(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p as Partial<TspWebProps>;
  const url = typeof p.url === "string" ? p.url : "";
  const title = typeof p.title === "string" && p.title.trim() !== "" ? p.title.trim() : url;
  const source = sourceOf(url);
  const localToken = useLocalPage(ctx.taskId, source?.kind === "file" ? source.path : null);
  const src = source?.kind === "web" ? source.url : localToken === null ? null : previewUrl(localToken);

  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<Mode>("still");
  /** 本地网页的脚本：点过一次之后放行（sandbox 只在载入时生效，换 key 重新载入）。 */
  const [scripts, setScripts] = useState(source?.kind === "web");

  // 滚进视口载入，滚出视口（不在交互中）换回静态卡片。
  useEffect(() => {
    const element = root.current;
    if (element === null || src === null) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry?.isIntersecting === true;
      setMode((current) => {
        if (current === "focused") return current;
        return visible ? "live" : "still";
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [src]);

  // 交互中：Esc（主进程转来）或在网页外按下指针时离开。
  useEffect(() => {
    if (mode !== "focused") return undefined;
    const leave = (): void => {
      setMode("live");
      root.current?.focus({ preventScroll: true });
    };
    const offEscape = window.studio.onFrameEscape(() => {
      if (document.activeElement === frame.current) leave();
    });
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setMode("live");
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      offEscape();
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [mode]);

  useEffect(() => {
    if (mode === "focused") frame.current?.focus();
  }, [mode, scripts]);

  const enter = (): void => {
    if (src === null) return;
    setScripts(true);
    setMode("focused");
  };

  const width = cssLength(p.w);
  const height = cssLength(p.h);
  const box: CSSProperties = { width: width ?? "100%", ...(height ? { height } : { aspectRatio: "16 / 10" }) };
  const dom = nodeDomProps(props, "tsp-web", { pointer: false, noTitle: true, style: box });

  return (
    <div {...dom} ref={root} data-mode={mode} tabIndex={-1} data-testid="tsp-web">
      {mode !== "still" && src !== null ? (
        <>
          <iframe
            key={`${src}:${scripts}`}
            ref={frame}
            className="tsp-web-frame"
            title={title}
            src={src}
            sandbox={
              source?.kind === "web" ? "allow-scripts allow-same-origin allow-forms" : scripts ? "allow-scripts" : ""
            }
            referrerPolicy="no-referrer"
            allow=""
            data-testid="tsp-web-frame"
          />
          {mode === "live" && (
            <button
              type="button"
              className="tsp-web-shield"
              aria-label={title}
              data-testid="tsp-web-shield"
              onClick={enter}
            />
          )}
        </>
      ) : (
        <div className="tsp-web-still" data-testid="tsp-web-still" onClick={enter}>
          <TspIcon name="globe" size={20} />
          <div className="tsp-web-still-text">
            <span className="tsp-web-title">{title}</span>
            {title !== url && <span className="tsp-web-url">{url}</span>}
          </div>
          <button
            type="button"
            className="tsp-web-open"
            aria-label={labels.webOpen(url)}
            title={labels.webOpen(url)}
            onClick={(event) => {
              event.stopPropagation();
              openHref(url, ctx);
            }}
          >
            <TspIcon name="open" />
          </button>
        </div>
      )}
    </div>
  );
}
