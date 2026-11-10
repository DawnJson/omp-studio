// 侧栏的"任务"列表（spec §4.2–§4.5）：studio 任务和 omp 里还没挂在任务上的会话合在这一个列表里。
// 标题右边分段：
// - 项目：studio 项目和会话的 cwd 合并成文件夹，文件夹顺序由用户拖动决定，文件夹里任务和会话按最近活动混排；默认文件夹不在这里；
// - 对话：默认文件夹（不属于任何项目）里的任务和会话平铺一列，按最近活动从新到旧；
// 这两段记在外壳状态里（historyOrder）。
// - 归档（有归档的会话时才有这一段）：归档了的会话平铺一列，点开恢复成任务。
// 分叉出来的会话缩进在原会话下面，原会话那一行可以收起它下面的分叉（collapsedForks）。搜索时只列匹配的行，项目里有匹配的文件夹全部展开。
// 点会话行 = 恢复成任务。
import type { HistoryOrder, Project, TaskId } from "../../../../shared/ipc.ts";
import { visibleItems, type SidebarFolder, type SidebarItem } from "../../../../shared/ui/sidebar-model.ts";
import { useState } from "react";
import { Segmented } from "../../ui/controls.tsx";
import { FolderGroup, type DropEdge } from "./FolderGroup.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { initialPerFolder, moreNavId, showMoreStep, flatLimitKey, initialFlat } from "./list-view.ts";
import type { RowHandlers } from "./TaskRow.tsx";

export type HistoryMode = HistoryOrder | "archived";

interface HistorySectionProps {
  mode: HistoryMode;
  onModeChange(mode: HistoryMode): void;
  /** "项目"分段的文件夹（不含默认文件夹）。 */
  folders: readonly SidebarFolder[];
  /** 平铺的列表："对话"里的任务和会话，或归档的会话。 */
  flat: readonly SidebarItem[];
  /** 有归档的会话（不看搜索）：才显示"归档"这一段。 */
  hasArchived: boolean;
  /** 项目、对话、归档都没有东西：整块不画。 */
  empty: boolean;
  searching: boolean;
  isOpen(folder: SidebarFolder): boolean;
  /** 已展开的行数上限，键是文件夹 key 或 flatLimitKey。 */
  limits: Readonly<Record<string, number>>;
  /** 收起了分叉的行（key）；搜索时是空集合。 */
  collapsedForks: ReadonlySet<string>;
  selectedTaskId: TaskId | null;
  tabStopId: string;
  renamingId: TaskId | null;
  rows: RowHandlers;
  onToggle(folder: SidebarFolder, open: boolean): void;
  onShowMore(key: string): void;
  onNewTask(folder: SidebarFolder): void;
  onOpenProjectMenu(project: Project, x: number, y: number, trigger: HTMLElement): void;
  /** 把文件夹移到第 to 个（不含它自己，0 起），见 sidebar-model 的 moveFolder。 */
  onMoveFolder(folder: SidebarFolder, to: number): void;
}

export function HistorySection(props: HistorySectionProps) {
  const { rows, searching, mode } = props;
  const { t } = rows;
  // 正在拖的文件夹和插入线的位置（在哪个文件夹的上边 / 下边）。
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; edge: DropEdge } | null>(null);
  /** 放下的位置换算成 moveFolder 的 to。 */
  const dropIndex = (moving: string, target: string, edge: DropEdge): number => {
    const rest = props.folders.map((folder) => folder.key).filter((key) => key !== moving);
    const at = rest.indexOf(target);
    return at === -1 ? 0 : at + (edge === "after" ? 1 : 0);
  };
  const endDrag = () => {
    setDragging(null);
    setDrop(null);
  };
  // 三段都没有东西（也不在搜索）才整块不画；否则留着标题行，免得切不回别的分段。
  if (props.empty && !searching) return null;

  const flatLimit = searching ? Infinity : (props.limits[flatLimitKey] ?? initialFlat);
  const flat = visibleItems(props.flat, flatLimit, props.selectedTaskId, props.collapsedForks);
  const flatMoreId = moreNavId(flatLimitKey);

  return (
    <section className="sb-group sb-history" aria-label={t("sidebar.searchHistory")} data-testid="sidebar-history">
      <div className="sb-history-head">
        <p className="sb-group-title">{t("sidebar.searchHistory")}</p>
        <Segmented
          size="sm"
          label={t("sidebar.historyOrder")}
          testId="sidebar-history-by"
          value={mode}
          options={[
            { value: "folder", label: t("sidebar.historyProjects") },
            { value: "chats", label: t("sidebar.historyChats") },
            ...(props.hasArchived ? [{ value: "archived" as const, label: t("sidebar.historyArchived") }] : []),
          ]}
          onChange={props.onModeChange}
        />
      </div>
      {mode !== "folder" ? (
        <>
          {flat.shown.map((item) => (
            <ItemRow
              key={item.key}
              item={item}
              forks={flat.forks.get(item.key)}
              collapsed={props.collapsedForks.has(item.key)}
              selectedTaskId={props.selectedTaskId}
              tabStopId={props.tabStopId}
              renamingId={props.renamingId}
              rows={rows}
            />
          ))}
          {flat.remaining > 0 && (
            <button
              type="button"
              className="sb-show-more sb-show-more-flat"
              data-nav={flatMoreId}
              data-testid="sidebar-history-more"
              tabIndex={props.tabStopId === flatMoreId ? 0 : -1}
              onFocus={() => rows.onFocusItem(flatMoreId)}
              onClick={() => props.onShowMore(flatLimitKey)}
            >
              {t("sidebar.showMore", { n: Math.min(flat.remaining, showMoreStep) })}
            </button>
          )}
        </>
      ) : (
        props.folders.map((folder) => (
          <FolderGroup
            key={folder.key}
            folder={folder}
            open={props.isOpen(folder)}
            limit={searching ? Infinity : (props.limits[folder.key] ?? initialPerFolder)}
            collapsedForks={props.collapsedForks}
            selectedTaskId={props.selectedTaskId}
            tabStopId={props.tabStopId}
            renamingId={props.renamingId}
            rows={rows}
            onToggle={props.onToggle}
            onShowMore={(target) => props.onShowMore(target.key)}
            onNewTask={props.onNewTask}
            onOpenProjectMenu={props.onOpenProjectMenu}
            dragging={dragging === folder.key}
            dropEdge={dragging !== null && drop?.key === folder.key ? drop.edge : undefined}
            onDragStart={() => setDragging(folder.key)}
            onDragOver={(edge) => {
              if (dragging === null) return false;
              if (drop?.key !== folder.key || drop.edge !== edge) setDrop({ key: folder.key, edge });
              return true;
            }}
            onDrop={() => {
              const moving = props.folders.find((candidate) => candidate.key === dragging);
              if (moving !== undefined && drop !== null)
                props.onMoveFolder(moving, dropIndex(moving.key, drop.key, drop.edge));
              endDrag();
            }}
            onDragEnd={endDrag}
            onMoveBy={(delta) => {
              const at = props.folders.indexOf(folder);
              if (at !== -1) props.onMoveFolder(folder, at + delta);
            }}
          />
        ))
      )}
    </section>
  );
}
