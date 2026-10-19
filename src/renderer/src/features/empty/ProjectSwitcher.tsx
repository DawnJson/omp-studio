// 标志下面的项目胶囊（项目名 + ⌄，悬停看完整路径），点击弹切换菜单：最近 8 个 + 打开文件夹…。键盘：↑↓ Home End，Esc 关闭并回到触发按钮。
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Project } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronDown } from "../../icons.tsx";
import { openFolderAsDraft } from "./actions.ts";
import { usePresence } from "../../ui/presence.ts";

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
  const presence = usePresence(open);

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
        className="empty-project"
        data-testid="empty-project"
        title={props.current.path}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("sidebar.projectMenu")}: ${props.current.name}`}
        onClick={() => setOpen(!open)}
      >
        <span className="empty-project-name">{props.current.name}</span>
        <ChevronDown size={12} />
      </button>
      {presence.mounted && (
        <div className="empty-menu" role="menu" onKeyDown={onMenuKeyDown} {...presence.exitProps}>
          {props.projects.slice(0, recentProjectLimit).map((project) => (
            <button
              key={project.id}
              type="button"
              role="menuitemradio"
              aria-checked={project.id === props.current.id}
              className="empty-menu-item"
              title={project.name}
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
