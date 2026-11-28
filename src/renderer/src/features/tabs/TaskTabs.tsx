// 顶栏中段的任务标签（spec §4.6）：开着的任务一个标签（颜色竖条 + 状态图标 + 标题 + ×），没有选中任务时最右多一个"新任务"草稿标签，末尾 + 开新任务。
// 当前标签悬停时 × 左边多一个重开会话。标签可以拖动换位置（插入线画在放下的那一边）。
// 右键：重命名（就地改，改的是任务标题，侧栏跟着变）、颜色、关闭 / 关闭其他 / 关闭右侧 / 全部关闭。
// 放不下时标签先收窄（标题省略），收到最窄再横向滚动，竖着的滚轮也能滚；当前标签总滚进视野。
// 键盘：标签上 ←/→/Home/End 换标签（焦点跟着走），Delete 关；中键点标签也关。× 和重开不进 Tab 顺序。
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { limits, type TaskId, type TaskState } from "../../../../shared/ipc.ts";
import { taskTitle } from "../../../../shared/ui/sidebar-model.ts";
import { withShortcut } from "../../app/platform-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Pencil, Plus, Restart } from "../../icons.tsx";
import { selectTask, showView, useMainView, useSelectedTaskId, useTasksState } from "../../store/index.ts";
import { IconButton } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";
import { WipeText } from "../../ui/WipeText.tsx";
import { restartBlockedKey, restartSession } from "../../app/restart-session.ts";
import { useShellValue } from "../../app/shell-store.ts";
import { startDraft } from "../empty/index.ts";
import { useHiddenTasks } from "../sidebar/archive-store.ts";
import { StatusDot } from "../sidebar/StatusDot.tsx";
import { closeTaskTab, closeTaskTabs, moveTaskTab, setTaskColor, tabsToClose, useTaskTabsSync } from "./tabs-store.tsx";
import { TaskColorBar } from "./TaskColorBar.tsx";
import "./tabs.css";

const colorIds = Array.from({ length: limits.taskColorCount }, (_, index) => index + 1);

/** 就地改名：Enter / 失焦提交，Esc 取消；空的或没变不改。 */
function TabRename({ task, title, onDone }: { task: TaskState; title: string; onDone(): void }) {
  const t = useT();
  const settled = useRef(false);
  const finish = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone();
    const next = value?.trim() ?? "";
    if (next !== "" && next !== task.title)
      void window.studio.renameTask(task.id, next).catch((error: unknown) => reportError(t, error));
  };
  return (
    <span className="task-tab-main task-tab-editing">
      <StatusDot task={task} t={t} />
      <input
        className="task-tab-rename"
        aria-label={t("task.renameLabel")}
        defaultValue={title}
        maxLength={limits.titleMaxChars}
        spellCheck={false}
        autoFocus
        data-testid="task-tab-rename"
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) finish(event.currentTarget.value);
          else if (event.key === "Escape") {
            event.stopPropagation();
            finish(null);
          }
        }}
        onBlur={(event) => finish(event.currentTarget.value)}
      />
    </span>
  );
}

export function TaskTabs() {
  const t = useT();
  useTaskTabsSync();
  const view = useMainView();
  const selected = useSelectedTaskId();
  const openTabs = useShellValue("openTabs");
  const tasks = useTasksState();
  const hidden = useHiddenTasks();
  const strip = useRef<HTMLDivElement>(null);
  const colors = useShellValue("taskColors");
  const [menu, setMenu] = useState<{ id: TaskId; anchor: MenuAnchor } | null>(null);
  const [renaming, setRenaming] = useState<TaskId | null>(null);
  // 正在拖的标签和插入线的位置（在哪个标签的左边 / 右边）。拖的是谁另记在 ref 里：dragstart 到 dragover / drop
  // 之间 React 可能还没重渲染（快速拖动只有一次 dragover），闭包里的 state 会是旧的。
  const draggingRef = useRef<TaskId | null>(null);
  const [dragging, setDragging] = useState<TaskId | null>(null);
  const [drop, setDrop] = useState<{ id: TaskId; edge: "before" | "after" } | null>(null);
  const endDrag = () => {
    draggingRef.current = null;
    setDragging(null);
    setDrop(null);
  };
  const edgeAt = (event: DragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? ("before" as const) : ("after" as const);
  };
  const onDrop = (target: TaskId, edge: "before" | "after") => {
    const moving = draggingRef.current;
    if (moving !== null && moving !== target) {
      const rest = openTabs.filter((id) => id !== moving);
      const at = rest.indexOf(target);
      if (at !== -1) moveTaskTab(moving, at + (edge === "after" ? 1 : 0));
    }
    endDrag();
  };

  // 归档撤销期里的任务在侧栏藏着，标签也先不画（撤销后回来，确定归档后从任务表消失、标签跟着去掉）。
  const shown = openTabs
    .map((id) => tasks.byId[id])
    .filter((task): task is TaskState => task !== undefined && !hidden.has(task.id));
  const active = view === "conversation" ? selected : undefined;
  const draft = selected === null;

  useLayoutEffect(() => {
    strip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [active, shown.length]);

  const open = (id: TaskId) => selectTask(id).catch((error: unknown) => reportError(t, error));
  const ids: (TaskId | null)[] = [...shown.map((task) => task.id), ...(draft ? [null] : [])];

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const id = ids[index] ?? null;
    if (event.key === "Delete" && id !== null) {
      event.preventDefault();
      closeTaskTab(t, id);
      return;
    }
    const last = ids.length - 1;
    const to =
      event.key === "ArrowRight"
        ? (index + 1) % ids.length
        : event.key === "ArrowLeft"
          ? (index - 1 + ids.length) % ids.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    const target = ids[to] ?? null;
    if (target === null) showView("conversation");
    else void open(target);
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };

  const tabMenuItems = (id: TaskId): MenuEntry[] => {
    const current = colors[id] ?? null;
    const closeScope = (scope: "others" | "right" | "all", label: string): MenuEntry => ({
      id: `close-${scope}`,
      label,
      disabled: tabsToClose(scope, id).length === 0,
      testId: `task-tab-menu-${scope}`,
      onSelect: () => closeTaskTabs(t, tabsToClose(scope, id)),
    });
    return [
      {
        id: "rename",
        label: t("tabs.rename"),
        icon: <Pencil />,
        testId: "task-tab-menu-rename",
        onSelect: () => setRenaming(id),
      },
      {
        kind: "swatches",
        id: "color",
        label: t("tabs.color"),
        options: [
          { id: "0", label: t("tabs.colorNone"), color: null, checked: current === null, testId: "task-tab-color-0" },
          ...colorIds.map((n) => ({
            id: String(n),
            label: t("tabs.colorN", { n }),
            color: `var(--chart-${n})`,
            checked: current === n,
            testId: `task-tab-color-${n}`,
          })),
        ],
        onPick: (value) => setTaskColor(id, Number(value) || null),
      },
      { kind: "separator", id: "sep" },
      {
        id: "close",
        label: t("tabs.close"),
        icon: <Close />,
        shortcut: "Ctrl W",
        testId: "task-tab-menu-close",
        onSelect: () => closeTaskTab(t, id),
      },
      closeScope("others", t("tabs.closeOthers")),
      closeScope("right", t("tabs.closeRight")),
      closeScope("all", t("tabs.closeAll")),
    ];
  };

  return (
    <div className="task-tabs" data-testid="task-tabs">
      <div
        ref={strip}
        className="task-tabs-strip ui-scroll-fade-x"
        role="tablist"
        aria-label={t("tabs.label")}
        onWheel={(event) => {
          // 竖着的滚轮换成横向滚动；触控板 / 高精度滚轮竖着滑时 deltaX 也常带一点，按主方向判断。
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {shown.map((task, index) => {
          const title = taskTitle(task) || t("task.untitled");
          const onAuxClick = (event: MouseEvent) => {
            if (event.button !== 1) return;
            event.preventDefault();
            closeTaskTab(t, task.id);
          };
          const onContextMenu = (event: MouseEvent) => {
            event.preventDefault();
            const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setMenu({ id: task.id, anchor: { x: event.clientX, y: event.clientY, returnFocus } });
          };
          const onDragOver = (event: DragEvent<HTMLDivElement>) => {
            if (draggingRef.current === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const edge = edgeAt(event);
            if (drop?.id !== task.id || drop.edge !== edge) setDrop({ id: task.id, edge });
          };
          const blocked = restartBlockedKey(task);
          return (
            <div
              key={task.id}
              className="task-tab"
              data-active={task.id === active || undefined}
              data-dragging={dragging === task.id || undefined}
              data-drop={dragging !== null && dragging !== task.id && drop?.id === task.id ? drop.edge : undefined}
              data-testid="task-tab"
              data-task-id={task.id}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", title);
                draggingRef.current = task.id;
                setDragging(task.id);
              }}
              onDragOver={onDragOver}
              onDrop={(event) => {
                event.preventDefault();
                onDrop(task.id, edgeAt(event));
              }}
              onDragEnd={endDrag}
              onAuxClick={onAuxClick}
              onContextMenu={onContextMenu}
              draggable={renaming !== task.id}
            >
              <TaskColorBar id={task.id} />
              {renaming === task.id ? (
                <TabRename task={task} title={title} onDone={() => setRenaming(null)} />
              ) : (
                <button
                  type="button"
                  role="tab"
                  className="task-tab-main"
                  aria-selected={task.id === active}
                  tabIndex={task.id === active ? 0 : -1}
                  title={title}
                  onClick={() => void open(task.id)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                >
                  <StatusDot task={task} t={t} />
                  <WipeText className="task-tab-name" text={title} />
                </button>
              )}
              {task.id === active && (
                <button
                  type="button"
                  className="task-tab-action task-tab-restart"
                  tabIndex={-1}
                  aria-label={t("task.restart")}
                  aria-disabled={blocked !== null || undefined}
                  title={blocked !== null ? t(blocked) : withShortcut(t("task.restart"), "Ctrl Shift R")}
                  data-testid="task-tab-restart"
                  onClick={() => {
                    if (blocked === null) void restartSession(t, task);
                  }}
                >
                  <Restart size={12} />
                </button>
              )}
              <button
                type="button"
                className="task-tab-action task-tab-close"
                tabIndex={-1}
                aria-label={t("tabs.close")}
                title={withShortcut(t("tabs.close"), "Ctrl W")}
                data-testid="task-tab-close"
                onClick={() => closeTaskTab(t, task.id)}
              >
                <Close size={12} />
              </button>
            </div>
          );
        })}
        {draft && (
          <div className="task-tab" data-active={view === "conversation" || undefined} data-testid="task-tab-draft">
            <button
              type="button"
              role="tab"
              className="task-tab-main"
              aria-selected={view === "conversation"}
              tabIndex={0}
              onClick={() => showView("conversation")}
              onKeyDown={(event) => onKeyDown(event, ids.length - 1)}
            >
              <span className="task-tab-name">{t("menu.newTask")}</span>
            </button>
          </div>
        )}
      </div>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={t("tabs.menu")}
          testId="task-tab-menu"
          onClose={() => setMenu(null)}
          items={tabMenuItems(menu.id)}
        />
      )}
      <IconButton
        label={t("menu.newTask")}
        tip={withShortcut(t("menu.newTask"), "Ctrl N")}
        testId="task-tab-new"
        onClick={() => startDraft()}
      >
        <Plus size={14} />
      </IconButton>
    </div>
  );
}
