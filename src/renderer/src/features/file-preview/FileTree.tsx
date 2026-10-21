// 文件面板的"文件"页：根目录下的树，每层目录展开时才向主进程要（listDirectory），一层上千项也只画眼前的行（定高虚拟化）。
// 键盘：↑↓ 移动、→ 展开 / 进入第一个子项、← 收起 / 回到父目录、Enter 或空格打开文件（目录是展开收起）、Home/End。
// 路径校验全在主进程；这里只拼相对路径传回去。被 .gitignore 忽略的条目调暗显示。
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import type { DirListing, ProjectFilesTarget, TerminalKey } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronDown, ChevronRight, FileIcon, Folder } from "../../icons.tsx";
import { reportError } from "../../ui/errors.ts";
import { flattenTree, treeKeyAction, type NodeRow, type TreeKey, type TreeRow } from "./tree-model.ts";
import { treeMemory } from "./tree-state.ts";

const overscan = 8;
const treeKeys = new Set<string>(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "]);

interface FileTreeProps {
  /** 数据来源（任务目录或某个额外根，主进程按目标查根）。 */
  target: ProjectFilesTarget;
  /** 展开状态、光标和滚动位置按它记（同一个任务的不同根各记各的）。 */
  memoryKey: TerminalKey;
  /** 文件页正在显示：变成 true 时重新读一遍已加载的目录，并把焦点放进树。 */
  active: boolean;
  /** 刷新按钮每按一次加一。 */
  reload: number;
  /** 预览页正在看的文件（相对路径），树里对应的行高亮。 */
  selected: string | null;
  onOpenFile(path: string): void;
}

export function FileTree({ target, memoryKey, active, reload, selected, onOpenFile }: FileTreeProps) {
  const t = useT();
  const idBase = useId();
  const memory = treeMemory(memoryKey);
  const scroller = useRef<HTMLDivElement>(null);
  const [listings, setListings] = useState<ReadonlyMap<string, DirListing>>(() => new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(memory.expanded));
  const [cursor, setCursor] = useState<string | null>(memory.active);
  const [rowHeight, setRowHeight] = useState(28);
  const [viewHeight, setViewHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const revealNext = useRef(false);
  const restored = useRef(false);

  const rows = useMemo(() => flattenTree(listings, expanded), [listings, expanded]);
  const cursorIndex = cursor === null ? -1 : rows.findIndex((row) => row.type === "node" && row.path === cursor);
  const latest = useRef({ rows, expanded, rowHeight, cursorIndex });
  latest.current = { rows, expanded, rowHeight, cursorIndex };

  const changeExpanded = useCallback(
    (next: ReadonlySet<string>) => {
      memory.expanded = next;
      setExpanded(next);
    },
    [memory],
  );

  const loadDir = useCallback(
    (dir: string) => {
      window.studio.listDirectory(target, dir).then(
        (listing) => setListings((previous) => new Map(previous).set(dir, listing)),
        (error: unknown) => {
          reportError(t, error);
          const next = new Set(latest.current.expanded);
          if (next.delete(dir)) changeExpanded(next);
        },
      );
    },
    [target, t, changeExpanded],
  );

  // 页面显示（或按了刷新）时：根目录和所有展开的目录重新读一遍。
  useEffect(() => {
    if (!active) return;
    loadDir("");
    for (const dir of latest.current.expanded) loadDir(dir);
  }, [active, reload, loadDir]);

  useEffect(() => {
    if (active) scroller.current?.focus({ preventScroll: true });
  }, [active]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const height = parseFloat(getComputedStyle(el).getPropertyValue("--row-tool"));
    if (height > 0) setRowHeight(height);
    setViewHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setViewHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 切回任务时恢复滚动位置：列表加载出来、内容有高度之后才能滚。
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!active || restored.current || rows.length === 0 || el === null) return;
    restored.current = true;
    el.scrollTop = memory.scrollTop;
  }, [active, rows.length, memory]);

  // 键盘移动光标后，保证光标行在可见范围内。
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!revealNext.current || el === null || cursorIndex < 0) return;
    revealNext.current = false;
    const top = cursorIndex * latest.current.rowHeight;
    const bottom = top + latest.current.rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [cursorIndex]);

  const moveCursor = (path: string, reveal: boolean) => {
    revealNext.current = reveal;
    memory.active = path;
    setCursor(path);
  };

  const expand = (path: string) => {
    changeExpanded(new Set(expanded).add(path));
    loadDir(path);
  };
  const collapse = (path: string) => {
    const next = new Set(expanded);
    next.delete(path);
    changeExpanded(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey || !treeKeys.has(event.key)) return;
    const action = treeKeyAction(
      rows,
      cursor ?? (selected === null ? null : selected.replaceAll("\\", "/")),
      event.key as TreeKey,
    );
    if (action === null) return;
    event.preventDefault();
    moveCursor(action.path, action.type === "move");
    if (action.type === "expand") expand(action.path);
    else if (action.type === "collapse") collapse(action.path);
    else if (action.type === "open") onOpenFile(action.path);
  };

  const onRowClick = (row: NodeRow) => {
    moveCursor(row.path, false);
    if (row.kind === "file") onOpenFile(row.path);
    else if (row.expanded) collapse(row.path);
    else expand(row.path);
  };

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    if (active) memory.scrollTop = event.currentTarget.scrollTop;
  };

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  const selectedPath = selected?.replaceAll("\\", "/") ?? null;

  return (
    <div
      ref={scroller}
      className="file-tree"
      hidden={!active}
      data-testid="file-tree"
      role="tree"
      tabIndex={0}
      aria-label={t("preview.treeLabel")}
      aria-activedescendant={cursorIndex >= 0 ? `${idBase}-${cursorIndex}` : undefined}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
    >
      {listings.get("")?.entries.length === 0 && <p className="file-preview-note">{t("preview.emptyDir")}</p>}
      <div className="file-tree-canvas" style={{ height: rows.length * rowHeight }}>
        {rows.slice(first, last).map((row, offset) => (
          <TreeRowView
            key={row.path}
            id={`${idBase}-${first + offset}`}
            row={row}
            top={(first + offset) * rowHeight}
            cursor={row.type === "node" && row.path === cursor}
            selected={row.type === "node" && row.path === selectedPath}
            onClick={onRowClick}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeRowViewProps {
  id: string;
  row: TreeRow;
  top: number;
  cursor: boolean;
  selected: boolean;
  onClick(row: NodeRow): void;
}

function TreeRowView({ id, row, top, cursor, selected, onClick }: TreeRowViewProps) {
  const t = useT();
  const style = { top, "--depth": row.depth } as CSSProperties;
  if (row.type === "truncated") {
    return (
      <div className="file-tree-row file-tree-more" role="none" style={style}>
        {t("preview.truncated", { count: row.shown })}
      </div>
    );
  }
  return (
    <div
      id={id}
      className="file-tree-row"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.kind === "dir" ? row.expanded : undefined}
      aria-selected={selected}
      data-testid="file-tree-row"
      data-path={row.path}
      data-kind={row.kind}
      data-cursor={cursor || undefined}
      data-ignored={row.ignored || undefined}
      title={row.path}
      style={style}
      onClick={() => onClick(row)}
    >
      <span className="file-tree-chevron" aria-hidden="true">
        {row.kind === "dir" && (row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </span>
      {row.kind === "dir" ? <Folder size={14} /> : <FileIcon size={14} />}
      <span className="file-tree-name">{row.name}</span>
    </div>
  );
}
