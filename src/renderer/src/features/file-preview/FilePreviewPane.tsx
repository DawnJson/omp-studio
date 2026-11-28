// 右侧预览面板（spec §4.27）：头部一排标签（文件或代码片段，最多 maxPreviewTabs 个）+ 关闭，下面是当前标签的预览页，宽度可拖。
// 文件树在侧栏（SidebarFiles.tsx）；预览内容经主进程 IPC 读取（校验落在根目录内，文件链接走只读的直接预览）。
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { ProjectFilesTarget } from "../../../../shared/ipc.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { IconButton, useSlidingIndicator } from "../../ui/controls.tsx";
import { FileTypeIcon } from "../../ui/FileTypeIcon.tsx";
import type { ExitProps } from "../../ui/presence.ts";
import { useHeld } from "../composer/use-held.ts";
import { baseName } from "./PreviewContent.tsx";
import { PreviewPage } from "./PreviewPage.tsx";
import { filesTarget } from "./files-target.ts";
import {
  closeFilePreview,
  closePreviewTab,
  selectPreviewTab,
  setPreviewWidth,
  usePreviewPanel,
  usePreviewWidth,
  type PreviewPanel,
  type PreviewTab,
} from "./preview-store.ts";
import { snippetExtension, snippetLabel } from "./snippet.ts";
import "./file-preview.css";

const minWidth = 280;
const maxShare = 0.7;
const keyboardStep = 16;

/** 任务目标选额外根（下标）；别的目标（草稿的项目、默认文件夹）没有额外根。 */
function withRoot(target: ProjectFilesTarget, root: number | undefined): ProjectFilesTarget {
  return target.kind === "task" && root !== undefined && root > 0 ? { ...target, root } : target;
}

/** `exitProps`：App 的右栏 usePresence 给的，关闭时原路滑回（motion.css 的 panel-out）。 */
export function FilePreviewPane({ exitProps }: { exitProps: ExitProps }) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = usePreviewWidth();
  // 关闭后放退出动画的那一下 store 里已经是 null：沿用关闭前的，预览页不在滑走时换成别的内容。
  const panel = useHeld(usePreviewPanel());
  const panelKey = panel?.key ?? null;
  const target = useMemo(() => (panelKey === null ? null : filesTarget(panelKey)), [panelKey]);
  const tab = panel?.tabs.find((candidate) => candidate.id === panel.active) ?? null;
  const tabRoot = tab?.kind === "file" ? tab.root : undefined;
  const previewTarget = useMemo(() => (target === null ? null : withRoot(target, tabRoot)), [target, tabRoot]);

  // 打开、换标签时把焦点放进面板：Esc 才能关掉它；关闭后由 store 还焦点。
  // 从侧栏文件树打开的不抢：焦点留在树里接着挑文件（树里的 Esc 同样关预览）。
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active?.closest("[data-testid=sidebar-files]") || root.current?.contains(active)) return;
    root.current?.focus({ preventScroll: true });
  }, [tab?.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeFilePreview();
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
    const current = root.current?.offsetWidth ?? minWidth;
    setPreviewWidth(clampWidth(current + (event.key === "ArrowLeft" ? keyboardStep : -keyboardStep)));
  };

  return (
    <section
      ref={root}
      className="file-preview"
      data-testid="file-preview"
      aria-label={t("preview.title")}
      tabIndex={-1}
      style={width === null ? undefined : { flexBasis: width }}
      onKeyDown={onKeyDown}
      {...exitProps}
    >
      <div
        className="file-preview-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("preview.resize")}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={onResizerKey}
      />
      <header className="file-preview-head">
        {panel !== null && <PreviewTabs panel={panel} />}
        <IconButton
          label={t("preview.close")}
          tip={`${t("preview.close")} (Esc)`}
          testId="file-preview-close"
          onClick={closeFilePreview}
        >
          <Close size={14} />
        </IconButton>
      </header>
      {tab !== null && previewTarget !== null && (
        <PreviewPage
          target={previewTarget}
          path={tab.kind === "file" ? tab.path : null}
          snippet={tab.kind === "snippet" ? tab.snippet : null}
          fromLink={tab.kind === "file" && tab.fromLink}
        />
      )}
    </section>
  );
}

function tabName(tab: PreviewTab, t: TFunction): { name: string; icon: string } {
  if (tab.kind === "file") return { name: baseName(tab.path), icon: baseName(tab.path) };
  return {
    name: t("preview.snippet", { lang: snippetLabel(tab.snippet.kind) }),
    icon: `snippet.${snippetExtension(tab.snippet.kind)}`,
  };
}

/** 标签条：←/→/Home/End 换标签（焦点跟着走），Delete 或中键关闭；标签先收窄（名字省略），收到最窄还放不下才横向滚动，竖着的滚轮也能滚。× 不进 Tab 顺序（键盘用 Delete）。 */
function PreviewTabs({ panel }: { panel: PreviewPanel }) {
  const t = useT();
  const strip = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(strip, barRef, ".file-preview-tab[data-active]", `${panel.active}:${panel.tabs.length}`);

  // 当前标签滚进视野（新开的标签在最右）。
  useLayoutEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [panel.active, panel.tabs.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = panel.tabs.length - 1;
    const to =
      event.key === "ArrowRight"
        ? (index + 1) % panel.tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + panel.tabs.length) % panel.tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (event.key === "Delete") {
      event.preventDefault();
      closePreviewTab(panel.tabs[index]!.id);
      requestAnimationFrame(() =>
        strip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
      );
      return;
    }
    if (to === null) return;
    event.preventDefault();
    selectPreviewTab(panel.tabs[to]!.id);
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };

  return (
    <div
      ref={strip}
      className="file-preview-tabs ui-scroll-fade-x"
      role="tablist"
      aria-label={t("preview.tabs")}
      data-testid="preview-tabs"
      onWheel={(event) => {
        // 竖着的滚轮换成横向滚动；触控板 / 高精度滚轮竖着滑时 deltaX 也常带一点，按主方向判断，不能只认 deltaX 为 0。
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
      }}
    >
      {panel.tabs.map((tab, index) => {
        const { name, icon } = tabName(tab, t);
        const title = tab.kind === "file" ? tab.path : name;
        const onAuxClick = (event: MouseEvent) => {
          if (event.button !== 1) return;
          event.preventDefault();
          closePreviewTab(tab.id);
        };
        return (
          <div
            key={tab.id}
            className="file-preview-tab"
            data-active={tab.id === panel.active || undefined}
            data-testid="preview-tab"
            onAuxClick={onAuxClick}
          >
            <button
              type="button"
              role="tab"
              className="file-preview-tab-main"
              aria-selected={tab.id === panel.active}
              tabIndex={tab.id === panel.active ? 0 : -1}
              title={title}
              onClick={() => selectPreviewTab(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <FileTypeIcon name={icon} size={14} />
              <span className="file-preview-tab-name">{name}</span>
            </button>
            <button
              type="button"
              className="file-preview-tab-close"
              tabIndex={-1}
              aria-label={t("preview.closeTab", { name })}
              title={`${t("preview.closeTab", { name })} (Delete)`}
              data-testid="preview-tab-close"
              onClick={() => closePreviewTab(tab.id)}
            >
              <Close size={12} />
            </button>
          </div>
        );
      })}
      <span ref={barRef} className="file-preview-tabs-bar" aria-hidden="true" />
    </div>
  );
}
