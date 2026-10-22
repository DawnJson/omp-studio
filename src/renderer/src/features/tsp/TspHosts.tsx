// TspView 里常驻的两个小浮层：节点 `actions.menu` 的右键菜单、image 的 zoom 大图查看器。
import { useEffect } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { hideTspMenu, useTspMenu } from "./menu-store.ts";
import { closeZoom, stepZoom, useZoom } from "./zoom-store.ts";

/** 动作名 → 菜单文字：copy 用翻译，其它把 `-` `.` `_` 换成空格。 */
function actionLabel(act: string, copy: string): string {
  if (act === "copy") return copy;
  const text = act.replace(/[-._]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function TspMenuHost() {
  const t = useT();
  const menu = useTspMenu();
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hideTspMenu();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", hideTspMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", hideTspMenu);
    };
  }, [menu]);
  if (!menu) return null;
  return (
    <>
      <div className="tsp-menu-scrim" onPointerDown={hideTspMenu} onContextMenu={(event) => event.preventDefault()} />
      <div className="tsp-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
        {menu.items.map((item) => (
          <button
            key={item.act}
            type="button"
            role="menuitem"
            className="tsp-menu-item"
            onClick={() => {
              hideTspMenu();
              item.run();
            }}
          >
            {actionLabel(item.act, t("common.copy"))}
          </button>
        ))}
      </div>
    </>
  );
}

function TspZoomHost() {
  const t = useT();
  const zoom = useZoom();
  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeZoom();
      else if (event.key === "ArrowLeft") stepZoom(-1);
      else if (event.key === "ArrowRight") stepZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  if (!zoom) return null;
  const item = zoom.items[zoom.index];
  if (!item) return null;
  return (
    <div className="tsp-zoom" role="dialog" aria-label={item.alt} onClick={closeZoom}>
      <img src={item.src} alt={item.alt} onClick={(event) => event.stopPropagation()} />
      <button type="button" className="tsp-zoom-close" aria-label={t("common.close")} onClick={closeZoom}>
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
