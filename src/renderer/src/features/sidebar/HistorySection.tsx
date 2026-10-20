// 侧栏的"会话"列表（spec §4.2–§4.5）：studio 任务和 omp 里还没挂在任务上的会话合在这一个列表里。
// 两种排列，标题右边切换，选择记在外壳状态里（historyOrder）：
// - 按文件夹：studio 项目和会话的 cwd 合并成文件夹，文件夹里任务和会话按最近活动混排；
// - 按时间：任务和会话平铺一列，按最近活动从新到旧。
// 搜索时只列匹配的行，按文件夹时有匹配的文件夹全部展开。点会话行 = 恢复成任务。
import type { Project, TaskId } from "../../../../shared/ipc.ts";
import type { SidebarFolder, SidebarItem } from "../../../../shared/ui/sidebar-model.ts";
import { setHistoryOrder, useShellUi } from "../../app/shell-store.ts";
import { FolderGroup } from "./FolderGroup.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { initialPerFolder, moreNavId, showMoreStep, timeLimitKey, visibleItems, initialByTime } from "./list-view.ts";
import type { RowHandlers } from "./TaskRow.tsx";

interface HistorySectionProps {
  folders: readonly SidebarFolder[];
  timeline: readonly SidebarItem[];
  searching: boolean;
  isOpen(folder: SidebarFolder): boolean;
  /** 已展开的行数上限，键是文件夹 key 或 timeLimitKey。 */
  limits: Readonly<Record<string, number>>;
  selectedTaskId: TaskId | null;
  tabStopId: string;
  renamingId: TaskId | null;
  rows: RowHandlers;
  onToggle(folder: SidebarFolder, open: boolean): void;
  onShowMore(key: string): void;
  onNewTask(folder: SidebarFolder): void;
  onOpenProjectMenu(project: Project, x: number, y: number, trigger: HTMLElement): void;
}

export function HistorySection(props: HistorySectionProps) {
  const { rows, searching } = props;
  const { t } = rows;
  const order = useShellUi().historyOrder;
  const empty = order === "time" ? props.timeline.length === 0 : props.folders.length === 0;
  if (empty) return null;

  const timeLimit = searching ? Infinity : (props.limits[timeLimitKey] ?? initialByTime);
  const time = visibleItems(props.timeline, timeLimit, props.selectedTaskId);
  const timeMoreId = moreNavId(timeLimitKey);

  return (
    <section className="sb-group sb-history" aria-label={t("sidebar.searchHistory")} data-testid="sidebar-history">
      <div className="sb-history-head">
        <p className="sb-group-title">{t("sidebar.searchHistory")}</p>
        <div className="sb-history-order" role="group" aria-label={t("sidebar.historyOrder")}>
          {(["folder", "time"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="sb-history-order-btn"
              data-testid={`sidebar-history-by-${value}`}
              aria-pressed={order === value}
              onClick={() => setHistoryOrder(value)}
            >
              {t(value === "folder" ? "sidebar.historyByFolder" : "sidebar.historyByTime")}
            </button>
          ))}
        </div>
      </div>
      {order === "time" ? (
        <>
          {time.shown.map((item) => (
            <ItemRow
              key={item.key}
              item={item}
              selectedTaskId={props.selectedTaskId}
              tabStopId={props.tabStopId}
              renamingId={props.renamingId}
              rows={rows}
            />
          ))}
          {time.remaining > 0 && (
            <button
              type="button"
              className="sb-show-more sb-show-more-flat"
              data-nav={timeMoreId}
              data-testid="sidebar-history-more"
              tabIndex={props.tabStopId === timeMoreId ? 0 : -1}
              onFocus={() => rows.onFocusItem(timeMoreId)}
              onClick={() => props.onShowMore(timeLimitKey)}
            >
              {t("sidebar.showMore", { n: Math.min(time.remaining, showMoreStep) })}
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
            selectedTaskId={props.selectedTaskId}
            tabStopId={props.tabStopId}
            renamingId={props.renamingId}
            rows={rows}
            onToggle={props.onToggle}
            onShowMore={(target) => props.onShowMore(target.key)}
            onNewTask={props.onNewTask}
            onOpenProjectMenu={props.onOpenProjectMenu}
          />
        ))
      )}
    </section>
  );
}
