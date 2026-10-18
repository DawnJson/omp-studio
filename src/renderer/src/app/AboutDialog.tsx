// 关于对话框：名称、版本、一句话说明。Esc 或点遮罩关闭，关闭后焦点回到打开前的元素。
import { useEffect, useRef } from "react";
import { useT } from "../i18n/use-t.ts";
import { useAppInfo } from "../store/index.ts";

export function AboutDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  const appInfo = useAppInfo();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="scrim" onPointerDown={onClose}>
      <div
        className="about"
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
