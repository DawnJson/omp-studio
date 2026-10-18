// 窗口状态记忆：userData/window-state.json。位置、尺寸、最大化由主进程跟踪窗口事件写入；
// 侧栏宽度和折叠由渲染进程经 setShellState 写入（spec §3.1）。
import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import path from "node:path";
import type { ShellState } from "../../shared/ipc.ts";
import { IpcValidationError, parseBoolean, parseInteger, parseRecord, parseString } from "../ipc/validate.ts";
import { readJsonFile, writeJsonFileAtomic } from "../settings/json-file.ts";

export const sidebarWidthRange = [220, 360] as const;
const defaultShellState: ShellState = { sidebarWidth: 264, sidebarCollapsed: false, collapsedProjects: [] };

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

/** 折叠的项目组：最多 500 项，每项是不超过 200 字符的字符串。 */
export function parseCollapsedProjects(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new IpcValidationError("collapsedProjects 必须是不超过 500 项的数组");
  return value.map((item) => parseString(item, "collapsedProjects[]", 200));
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
  const raw = record["shell"] === undefined ? {} : parseShellRecord(record["shell"]);
  // 字段各自校验：旧文件缺字段或某一项越界，只影响那一项。
  try {
    shell.sidebarWidth = parseInteger(raw["sidebarWidth"], "sidebarWidth", ...sidebarWidthRange);
  } catch {
    // 保留默认值。
  }
  try {
    shell.sidebarCollapsed = parseBoolean(raw["sidebarCollapsed"], "sidebarCollapsed");
  } catch {
    // 保留默认值。
  }
  try {
    shell.collapsedProjects = parseCollapsedProjects(raw["collapsedProjects"]);
  } catch {
    // 保留默认值。
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
