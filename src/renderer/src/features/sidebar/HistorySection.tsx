// 侧栏的"会话"列表（spec §4.2–§4.5）：studio 任务和 omp 里还没挂在任务上的会话合在这一个列表里。
// 标题右边切换：
// - 按文件夹：studio 项目和会话的 cwd 合并成文件夹，文件夹里任务和会话按最近活动混排；
// - 按时间：任务和会话平铺一列，按最近活动从新到旧；
// 这两种记在外壳状态里（historyOrder）。
// - 已归档（有归档的会话时才有这一档）：归档了的会话平铺一列，点开恢复成任务。
// 分叉出来的会话缩进在原会话下面，原会话那一行可以收起它下面的分叉（collapsedForks）。搜索时只列匹配的行，按文件夹时有匹配的文件夹全部展开。
// 点会话行 = 恢复成任务。
import type { HistoryOrder, Project, TaskId } from "../../../../shared/ipc.ts";
import { visibleItems, type SidebarFolder, type SidebarItem } from "../../../../shared/ui/sidebar-model.ts";
import { useState } from "react";
import { Segmented } from "../../ui/controls.tsx";
import { FolderGroup, type DropEdge } from "./FolderGroup.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { initialPerFolder, moreNavId, showMoreStep, timeLimitKey, initialByTime } from "./list-view.ts";
import type { RowHandlers } from "./TaskRow.tsx";

export type HistoryMode = HistoryOrder | "archived";

interface HistorySectionProps {
  mode: HistoryMode;
  onModeChange(mode: HistoryMode): void;
  folders: readonly SidebarFolder[];
  /** 平铺的列表：按时间排列的任务和会话，或已归档的会话。 */
  flat: readonly SidebarItem[];
  /** 有归档的会话（不看搜索）：才显示"已归档"这一档。 */
  hasArchived: boolean;
  searching: boolean;
  isOpen(folder: SidebarFolder): boolean;
  /** 已展开的行数上限，键是文件夹 key 或 timeLimitKey。 */
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
  /** 默认文件夹的 key：固定第一个，拖不动、也不能放到它前面。 */
  fixedFolderKey: string | null;
  /** 把文件夹移到第 to 个（按能移动的文件夹算、不含它自己，0 起），见 sidebar-model 的 moveFolder。 */
  onMoveFolder(folder: SidebarFolder, to: number): void;
}

export function HistorySection(props: HistorySectionProps) {
  const { rows, searching, mode } = props;
  const { t } = rows;
  // 正在拖的文件夹和插入线的位置（在哪个文件夹的上边 / 下边）。
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; edge: DropEdge } | null>(null);
  const movable = props.folders.filter((folder) => folder.key !== props.fixedFolderKey).map((folder) => folder.key);
  /** 放下的位置换算成 moveFolder 的 to：落在默认文件夹上 = 最前。 */
  const dropIndex = (moving: string, target: string, edge: DropEdge): number => {
    const rest = movable.filter((key) => key !== moving);
    const at = rest.indexOf(target);
    return at === -1 ? 0 : at + (edge === "after" ? 1 : 0);
  };
  const endDrag = () => {
    setDragging(null);
    setDrop(null);
  };
  const empty = mode === "folder" ? props.folders.length === 0 : props.flat.length === 0;
  // 列表空了也留着标题行，免得切不回"已归档"/平常的列表（搜索没有匹配时同理）。
  if (empty && !props.hasArchived && !searching) return null;

  const flatLimit = searching ? Infinity : (props.limits[timeLimitKey] ?? initialByTime);
  const flat = visibleItems(props.flat, flatLimit, props.selectedTaskId, props.collapsedForks);
  const flatMoreId = moreNavId(timeLimitKey);

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
            { value: "folder", label: t("sidebar.historyByFolder") },
            { value: "time", label: t("sidebar.historyByTime") },
            ...(props.hasArchived ? [{ value: "archived" as const, label: t("task.archived") }] : []),
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
              onClick={() => props.onShowMore(timeLimitKey)}
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
            movable={folder.key !== props.fixedFolderKey}
            dragging={dragging === folder.key}
            dropEdge={dragging !== null && drop?.key === folder.key ? drop.edge : undefined}
            onDragStart={() => setDragging(folder.key)}
            onDragOver={(edge) => {
              if (dragging === null) return false;
              // 默认文件夹上面不能放：落在它身上一律算"它下面"。
              const next = folder.key === props.fixedFolderKey ? "after" : edge;
              if (drop?.key !== folder.key || drop.edge !== next) setDrop({ key: folder.key, edge: next });
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
              const at = movable.indexOf(folder.key);
              if (at !== -1) props.onMoveFolder(folder, at + delta);
            }}
          />
        ))
      )}
    </section>
  );
}
