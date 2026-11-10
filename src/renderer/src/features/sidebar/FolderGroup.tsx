// 文件夹分组（spec §4.3）：头部 [名称][箭头] + 任务和历史会话混排的行。头部右侧常驻 +（在这个文件夹新建任务，纯历史文件夹会先把它加成项目）；
// + 左边同一个位置：折叠时是行数（组内有等待任务再加一个琥珀菱形），展开时换成 ⋯ 项目菜单（只有 studio 项目才有），两者交叉淡入淡出。
// 文件夹的顺序由用户定（spec §4.5）：拖头部换位置（插入线画在落点那个文件夹的上边或下边），焦点在头部时 Alt+↑ / Alt+↓ 上下移一格；默认文件夹不能动。
import { useRef } from "react";
import type { Project, TaskId } from "../../../../shared/ipc.ts";
import { visibleItems, type SidebarFolder } from "../../../../shared/ui/sidebar-model.ts";
import { Dots, Plus } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { useFlip } from "../../ui/flip.ts";
import { ChevronIcon } from "./icons.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { folderNavId, moreNavId, showMoreStep } from "./list-view.ts";
import type { RowHandlers } from "./TaskRow.tsx";

interface FolderGroupProps {
  folder: SidebarFolder;
  open: boolean;
  /** 展开时先显示的行数上限（"显示更多"每次 +20）。 */
  limit: number;
  /** 收起了分叉的行（key）；搜索时是空集合。 */
  collapsedForks: ReadonlySet<string>;
  selectedTaskId: TaskId | null;
  tabStopId: string;
  renamingId: TaskId | null;
  rows: RowHandlers;
  onToggle(folder: SidebarFolder, open: boolean): void;
  onShowMore(folder: SidebarFolder): void;
  onNewTask(folder: SidebarFolder): void;
  onOpenProjectMenu(project: Project, x: number, y: number, trigger: HTMLElement): void;
  /** 能拖动、能 Alt+↑/↓（默认文件夹不能）。 */
  movable: boolean;
  /** 正在被拖的就是它。 */
  dragging: boolean;
  /** 插入线画在它的上边 / 下边。 */
  dropEdge: DropEdge | undefined;
  onDragStart(): void;
  /** 拖着别的文件夹经过它；返回 false = 不是在拖文件夹（拖文件进来之类），不接。 */
  onDragOver(edge: DropEdge): boolean;
  onDrop(): void;
  onDragEnd(): void;
  /** 键盘：上移（-1）/ 下移（+1）一格。 */
  onMoveBy(delta: -1 | 1): void;
}

export type DropEdge = "before" | "after";

/** 拖着经过这个文件夹：指针在头部中线以上算"上边"，以下（含展开的行）算"下边"。 */
function edgeAt(section: HTMLElement, clientY: number): DropEdge {
  const head = section.querySelector<HTMLElement>(".sb-group-head") ?? section;
  const box = head.getBoundingClientRect();
  return clientY < box.top + box.height / 2 ? "before" : "after";
}

export function FolderGroup(props: FolderGroupProps) {
  const { folder, open, rows } = props;
  const { t } = rows;
  const { project } = folder;
  const navId = folderNavId(folder);
  const hasWaiting = folder.items.some((item) => item.kind === "task" && item.task.status === "needs_you");
  const { shown, remaining, forks } = visibleItems(
    folder.items,
    props.limit,
    props.selectedTaskId,
    props.collapsedForks,
  );
  const moreId = moreNavId(folder.key);
  const body = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useFlip(body);

  return (
    <section
      className="sb-folder"
      aria-label={folder.label}
      data-testid="sidebar-folder"
      data-dragging={props.dragging || undefined}
      data-drop={props.dropEdge}
      onDragOver={(event) => {
        if (!props.onDragOver(edgeAt(event.currentTarget, event.clientY))) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop();
      }}
    >
      <div
        className="sb-group-head"
        draggable={props.movable}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", folder.cwd);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        onContextMenu={(event) => {
          if (project === null) return;
          event.preventDefault();
          props.onOpenProjectMenu(
            project,
            event.clientX,
            event.clientY,
            event.currentTarget.querySelector<HTMLElement>(".sb-group-toggle") ?? event.currentTarget,
          );
        }}
      >
        <button
          ref={toggle}
          type="button"
          className="sb-group-toggle"
          data-nav={navId}
          data-collapsed={!open}
          tabIndex={props.tabStopId === navId ? 0 : -1}
          aria-expanded={open}
          aria-label={t("sidebar.toggleProject", { project: folder.label })}
          aria-keyshortcuts={props.movable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          title={folder.cwd}
          onFocus={() => rows.onFocusItem(navId)}
          onClick={() => props.onToggle(folder, !open)}
          onKeyDown={(event) => {
            if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              if (!props.movable) return;
              props.onMoveBy(event.key === "ArrowUp" ? -1 : 1);
              // React 挪动 DOM 节点会让焦点丢掉：挪完把焦点放回这个头部。
              requestAnimationFrame(() => toggle.current?.focus());
            } else if (event.key === "ArrowLeft" && open) {
              event.preventDefault();
              props.onToggle(folder, false);
            } else if (event.key === "ArrowRight" && !open) {
              event.preventDefault();
              props.onToggle(folder, true);
            }
          }}
        >
          <span className="sb-group-name">{folder.label}</span>
          <span className="sb-chevron">
            <ChevronIcon />
          </span>
          <span className="sb-group-count" data-shown={!open || undefined}>
            {hasWaiting && <span className="sb-waiting-diamond" role="img" aria-label={t("sidebar.waitingHere")} />}
            {folder.items.length}
          </span>
        </button>
        <IconButton
          className="sb-group-action sb-group-new"
          testId="sidebar-project-new"
          tabIndex={-1}
          label={t("sidebar.newInProject")}
          onClick={() => props.onNewTask(folder)}
        >
          <Plus />
        </IconButton>
        {project !== null && (
          <IconButton
            className="sb-group-action sb-group-more"
            data-shown={open || undefined}
            tabIndex={-1}
            aria-hidden={!open || undefined}
            label={t("sidebar.projectMenu")}
            aria-haspopup="menu"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              props.onOpenProjectMenu(project, box.left, box.bottom + 4, event.currentTarget);
            }}
          >
            <Dots />
          </IconButton>
        )}
      </div>
      <Reveal open={open}>
        <div className="sb-group-body" ref={body}>
          {folder.items.length === 0 && <p className="sb-group-empty">{t("sidebar.empty")}</p>}
          {shown.map((item) => (
            <ItemRow
              key={item.key}
              item={item}
              forks={forks.get(item.key)}
              collapsed={props.collapsedForks.has(item.key)}
              selectedTaskId={props.selectedTaskId}
              tabStopId={props.tabStopId}
              renamingId={props.renamingId}
              rows={rows}
            />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              className="sb-show-more"
              data-nav={moreId}
              data-testid="sidebar-history-more"
              tabIndex={props.tabStopId === moreId ? 0 : -1}
              onFocus={() => rows.onFocusItem(moreId)}
              onClick={() => props.onShowMore(folder)}
            >
              {t("sidebar.showMore", { n: Math.min(remaining, showMoreStep) })}
            </button>
          )}
        </div>
      </Reveal>
    </section>
  );
}
