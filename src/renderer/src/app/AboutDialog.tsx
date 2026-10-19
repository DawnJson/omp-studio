// 关于对话框：名称、版本、一句话说明。Esc 或点遮罩关闭，关闭后焦点回到打开前的元素。
import { useEffect, useRef } from "react";
import { useT } from "../i18n/use-t.ts";
import { useAppInfo } from "../store/index.ts";
import { usePresence } from "../ui/presence.ts";
import { useTitleBarDim } from "../ui/title-bar-dim.ts";

export function AboutDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT();
  const presence = usePresence(open);
  useTitleBarDim(open);
  const appInfo = useAppInfo();
  const closeRef = useRef<HTMLButtonElement>(null);

  // 焦点在 open 变化时立即处理，不等退出动画放完。
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!presence.mounted) return null;

  return (
    <div className="scrim" data-closing={presence.closing ? "fade" : undefined} onPointerDown={onClose}>
      <div
        className="about"
        {...presence.exitProps}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        data-testid="about-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Tab") {
            event.preventDefault();
          }
        }}
      >
        <h2 id="about-title" className="about-title">
          {t("shell.appName")} <span className="about-version">{appInfo?.version ?? ""}</span>
        </h2>
        <button ref={closeRef} type="button" className="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
