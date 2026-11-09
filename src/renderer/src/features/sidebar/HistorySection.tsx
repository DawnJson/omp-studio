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
import { Segmented } from "../../ui/controls.tsx";
import { FolderGroup } from "./FolderGroup.tsx";
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
}

export function HistorySection(props: HistorySectionProps) {
  const { rows, searching, mode } = props;
  const { t } = rows;
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
          />
        ))
      )}
    </section>
  );
}
