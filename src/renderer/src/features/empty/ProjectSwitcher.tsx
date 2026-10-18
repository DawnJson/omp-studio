// 项目名（点击弹切换菜单：最近 8 个 + 打开文件夹…）。键盘：↑↓ Home End，Esc 关闭并回到触发按钮。
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Project } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { openFolderAsDraft } from "./actions.ts";

const recentProjectLimit = 8;

export function ProjectSwitcher(props: {
  projects: readonly Project[];
  current: Project;
  onPick(project: Project): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (project: Project) => {
    close();
    props.onPick(project);
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
  };

  return (
    <div
      ref={rootRef}
      className="empty-switcher"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="empty-project-name"
        data-testid="empty-project"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("sidebar.projectMenu")}: ${props.current.name}`}
        onClick={() => setOpen(!open)}
      >
        {props.current.name}
      </button>
      {open && (
        <div className="empty-menu" role="menu" onKeyDown={onMenuKeyDown}>
          {props.projects.slice(0, recentProjectLimit).map((project) => (
            <button
              key={project.id}
              type="button"
              role="menuitemradio"
              aria-checked={project.id === props.current.id}
              className="empty-menu-item"
              onClick={() => choose(project)}
            >
              {project.name}
            </button>
          ))}
          <div className="empty-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="empty-menu-item"
            onClick={() => {
              setOpen(false);
              void openFolderAsDraft(t);
            }}
          >
            {t("empty.openFolder")}
          </button>
        </div>
      )}
    </div>
  );
}
