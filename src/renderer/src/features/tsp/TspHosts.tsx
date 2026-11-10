// TspView 里常驻的两个小浮层：节点 `actions.menu` 的右键菜单、image 的 zoom 大图查看器。
import { useEffect, useMemo } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { Menu, type MenuAnchor } from "../../ui/Menu.tsx";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { hideTspMenu, useTspMenu } from "./menu-store.ts";
import { useReducedMotion } from "./use-clock.ts";
import { closeZoom, stepZoom, useZoom } from "./zoom-store.ts";

/** 动作名 → 菜单文字：copy 用翻译，其它把 `-` `.` `_` 换成空格。 */
function actionLabel(act: string, copy: string): string {
  if (act === "copy") return copy;
  const text = act.replace(/[-._]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** 右键菜单用公共的 Menu（spec §4.23）：贴边时翻到右键点另一侧、夹在窗口里、太高自己滚；Esc / 点外面关，焦点回到原处。 */
function TspMenuHost() {
  const t = useT();
  const menu = useTspMenu();
  // 每次右键是一个新锚点（Menu 按锚点变没变决定要不要重新打开）；关闭后焦点回到右键前的元素。
  const anchor = useMemo<MenuAnchor | null>(
    () =>
      menu && {
        x: menu.x,
        y: menu.y,
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      },
    [menu],
  );
  useEffect(() => {
    if (!menu) return;
    window.addEventListener("blur", hideTspMenu);
    return () => window.removeEventListener("blur", hideTspMenu);
  }, [menu]);
  if (!menu || !anchor) return null;
  return (
    <Menu
      anchor={anchor}
      label={t("tsp.nodeMenu")}
      onClose={hideTspMenu}
      testId="tsp-menu"
      items={menu.items.map((item) => ({
        id: item.act,
        label: item.label ?? actionLabel(item.act, t("common.copy")),
        onSelect: item.run,
      }))}
    />
  );
}

function TspZoomHost() {
  const t = useT();
  const zoom = useZoom();
  const reduced = useReducedMotion();
  // 放大图的遮罩盖住整个窗口（含顶栏），系统三键也要一起调暗；遮罩随整窗交叉淡入出现、消失（zoom-store.ts），渐变按它的时长。
  useTitleBarDim(zoom !== null, "zoom");
  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeZoom(reduced);
      else if (event.key === "ArrowLeft") stepZoom(-1);
      else if (event.key === "ArrowRight") stepZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, reduced]);
  if (!zoom) return null;
  const item = zoom.items[zoom.index];
  if (!item) return null;
  return (
    <div
      className="tsp-zoom"
      data-testid="tsp-zoom"
      role="dialog"
      aria-label={item.alt}
      onClick={() => closeZoom(reduced)}
    >
      <img data-testid="tsp-zoom-image" src={item.src} alt={item.alt} onClick={(event) => event.stopPropagation()} />
      <button
        type="button"
        className="tsp-zoom-close"
        aria-label={t("common.close")}
        onClick={() => closeZoom(reduced)}
      >
        <Close size={16} />
      </button>
    </div>
  );
}

export function TspHosts() {
  return (
    <>
      <TspMenuHost />
      <TspZoomHost />
    </>
  );
}
