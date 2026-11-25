// 窗口状态记忆：userData/window-state.json。位置、尺寸、最大化由主进程跟踪窗口事件写入；
// 侧栏宽度和折叠、对话列宽度由渲染进程经 setShellState 写入（spec §3.1、§3.2）。
import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import path from "node:path";
import { historyOrders, limits, type ShellState, type TaskId } from "../../shared/ipc.ts";
import {
  IpcValidationError,
  parseBoolean,
  parseInteger,
  parseOneOf,
  parseRecord,
  parseString,
  parseTaskId,
} from "../ipc/validate.ts";
import { readJsonFile, writeJsonFileAtomic } from "../settings/json-file.ts";

export const sidebarWidthRange = [200, 360] as const;
/** 2026-10-21 起默认 240；264 是旧默认值，磁盘上存着 264 的人从没拖过，按新默认处理。 */
const legacyDefaultSidebarWidth = 264;
const defaultShellState: ShellState = {
  sidebarWidth: 240,
  sidebarCollapsed: false,
  terminalHeight: 280,
  historyOrder: "folder",
  conversationWidth: null,
  folderOrder: [],
  sidebarFilesOpen: true,
  sidebarFilesShare: null,
  openTabs: [],
  activeTab: null,
  taskColors: {},
};

/** 对话列宽度（占主区的百分比）：null = 默认；数字要在 limits.conversationWidthRange 里，存两位小数。 */
export function parseConversationWidth(value: unknown): number | null {
  if (value === null) return null;
  const [min, max] = limits.conversationWidthRange;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new IpcValidationError(`conversationWidth 必须是 null 或 ${min}–${max} 的数`);
  }
  return Math.round(value * 100) / 100;
}

/** 侧栏文件区占的百分比：null = 默认；整数，在 limits.sidebarFilesShareRange 里。 */
export function parseSidebarFilesShare(value: unknown): number | null {
  if (value === null) return null;
  return parseInteger(value, "sidebarFilesShare", ...limits.sidebarFilesShareRange);
}

/** 侧栏文件夹顺序：字符串数组，不超过 limits.folderOrderMax 个，每个非空、不超过 limits.folderKeyMaxChars，不重复。 */
export function parseFolderOrder(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > limits.folderOrderMax) {
    throw new IpcValidationError(`folderOrder 必须是不超过 ${limits.folderOrderMax} 项的数组`);
  }
  const keys = value.map((key, index) => parseString(key, `folderOrder[${index}]`, limits.folderKeyMaxChars));
  if (new Set(keys).size !== keys.length) throw new IpcValidationError("folderOrder 有重复项");
  return keys;
}

/** 任务标签：任务 id 数组，不重复，不超过 limits.openTabsMax 个。任务已经不在了的 id 由渲染进程丢掉（主进程这里不查任务表）。 */
export function parseOpenTabs(value: unknown): TaskId[] {
  if (!Array.isArray(value) || value.length > limits.openTabsMax) {
    throw new IpcValidationError(`openTabs 必须是不超过 ${limits.openTabsMax} 项的数组`);
  }
  const ids = value.map((id) => parseTaskId(id));
  if (new Set(ids).size !== ids.length) throw new IpcValidationError("openTabs 有重复项");
  return ids;
}

/** 当前标签：null（新任务草稿）或任务 id。 */
export function parseActiveTab(value: unknown): TaskId | null {
  return value === null ? null : parseTaskId(value);
}

/** 任务颜色：任务 id → 1…limits.taskColorCount 的整数，不超过 limits.taskColorsMax 条。不在了的任务由渲染进程丢掉。 */
export function parseTaskColors(value: unknown): Record<TaskId, number> {
  const record = parseRecord(value, "taskColors");
  const entries = Object.entries(record);
  if (entries.length > limits.taskColorsMax) {
    throw new IpcValidationError(`taskColors 不能超过 ${limits.taskColorsMax} 条`);
  }
  const colors: Record<TaskId, number> = {};
  for (const [id, color] of entries) {
    colors[parseTaskId(id)] = parseInteger(color, `taskColors.${id}`, 1, limits.taskColorCount);
  }
  return colors;
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PersistedState {
  bounds: WindowBounds | null;
  maximized: boolean;
  shell: ShellState;
  /** 已经提示过"关窗口后应用仍在托盘运行"。 */
  trayNoticeShown: boolean;
}

let state: PersistedState | null = null;

function stateFile(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function parseBounds(value: unknown): WindowBounds | null {
  try {
    const record = parseRecord(value, "bounds");
    const bounds = {
      x: parseInteger(record["x"], "x", -100_000, 100_000),
      y: parseInteger(record["y"], "y", -100_000, 100_000),
      width: parseInteger(record["width"], "width", 1, 100_000),
      height: parseInteger(record["height"], "height", 1, 100_000),
    };
    // 显示器拔掉或分辨率变了：窗口至少要有一块落在某个工作区里，否则丢弃位置。
    const visible = screen.getAllDisplays().some(({ workArea }) => intersects(bounds, workArea));
    return visible ? bounds : null;
  } catch {
    return null;
  }
}

function intersects(a: WindowBounds, b: Rectangle): boolean {
  return a.x < b.x + b.width - 40 && a.x + a.width > b.x + 40 && a.y < b.y + b.height - 40 && a.y + a.height > b.y;
}

function parseShellRecord(value: unknown): Record<string, unknown> {
  try {
    return parseRecord(value, "shell");
  } catch {
    return {};
  }
}

function load(): PersistedState {
  if (state) return state;
  let record: Record<string, unknown> = {};
  try {
    record = parseRecord(readJsonFile(stateFile()), "window-state");
  } catch {
    // 没有文件或内容不对：全部用默认值。
  }
  const shell = { ...defaultShellState };
  const raw = parseShellRecord(record["shell"]);
  // 字段各自校验：旧文件缺字段或某一项越界，只影响那一项。
  try {
    const stored = parseInteger(raw["sidebarWidth"], "sidebarWidth", ...sidebarWidthRange);
    if (stored !== legacyDefaultSidebarWidth) shell.sidebarWidth = stored;
  } catch {
    // 保留默认值。
  }
  try {
    shell.sidebarCollapsed = parseBoolean(raw["sidebarCollapsed"], "sidebarCollapsed");
  } catch {
    // 保留默认值。
  }
  try {
    shell.terminalHeight = parseInteger(raw["terminalHeight"], "terminalHeight", ...limits.terminalHeightRange);
  } catch {
    // 保留默认值。
  }
  try {
    shell.historyOrder = parseOneOf(raw["historyOrder"], "historyOrder", historyOrders);
  } catch {
    // 保留默认值。
  }
  try {
    shell.conversationWidth = parseConversationWidth(raw["conversationWidth"]);
  } catch {
    // 保留默认值（缺字段、越界都按默认宽度）。
  }
  try {
    shell.folderOrder = parseFolderOrder(raw["folderOrder"]);
  } catch {
    // 保留默认值：所有文件夹当新文件夹，按最近活动排一次后记下来。
  }
  try {
    shell.sidebarFilesOpen = parseBoolean(raw["sidebarFilesOpen"], "sidebarFilesOpen");
  } catch {
    // 保留默认值（展开）。
  }
  try {
    shell.sidebarFilesShare = parseSidebarFilesShare(raw["sidebarFilesShare"]);
  } catch {
    // 保留默认值（各占一半）。
  }
  try {
    shell.openTabs = parseOpenTabs(raw["openTabs"]);
    shell.activeTab = parseActiveTab(raw["activeTab"]);
  } catch {
    // 保留默认值（没有标签，停在新任务草稿）。
  }
  try {
    shell.taskColors = parseTaskColors(raw["taskColors"]);
  } catch {
    // 保留默认值（都没颜色）。
  }
  state = {
    bounds: parseBounds(record["bounds"]),
    maximized: record["maximized"] === true,
    shell,
    trayNoticeShown: record["trayNoticeShown"] === true,
  };
  return state;
}

function save(): void {
  writeJsonFileAtomic(stateFile(), load());
}

export function getShellState(): ShellState {
  return load().shell;
}

export function setShellState(patch: Partial<ShellState>): void {
  const current = load();
  current.shell = { ...current.shell, ...patch };
  save();
}

export function trayNoticeShown(): boolean {
  return load().trayNoticeShown;
}

export function markTrayNoticeShown(): void {
  load().trayNoticeShown = true;
  save();
}

/** 创建窗口前取上次的位置和尺寸；没有记录时返回 null，由调用方用默认值。 */
export function restoredBounds(): { bounds: WindowBounds | null; maximized: boolean } {
  const { bounds, maximized } = load();
  return { bounds, maximized };
}

/** 跟踪窗口：移动/缩放防抖后写盘，关闭前再写一次。最大化时记的是还原后的尺寸（getNormalBounds）。 */
export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const capture = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const current = load();
    current.bounds = window.getNormalBounds();
    current.maximized = window.isMaximized();
    save();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(capture, 400);
  };
  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  window.on("close", () => {
    clearTimeout(timer);
    capture();
  });
}
