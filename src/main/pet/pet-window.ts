// 桌面宠物的窗口（docs/architecture/pet.md「窗口」）：透明、无边框、置顶、不进任务栏、不抢焦点，拖到桌面任何位置。
// 安全同主窗口（security.md「窗口和页面」）：沙箱、上下文隔离、只加载 app://studio/pet.html、禁止导航和新开窗口；
// preload 是单独的 pet.cjs，只有 PetApi 的几个函数，主进程只认这个窗口顶层页面发来的 pet:* 通道。
// 窗口固定大小、整个留在屏幕工作区里；宠物平时在底部正中、上面留给气泡和属性卡，贴近屏幕上边时挪到窗口顶上、浮层放到下面，
// 贴近左右边时偏到窗口一侧（PetLayout 推给页面）。透明的地方鼠标穿透（setIgnoreMouseEvents + forward），
// 指针移到宠物、气泡、卡片上时渲染进程报告 setInteractive(true)。
// 拖动不用 -webkit-app-region（Windows 上拖动区吃掉点击和右键）：按下后主进程按光标位置逐帧 setBounds，松开后夹回屏幕、存位置。
import path from "node:path";
import {
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
} from "electron";
import type { PetGaze, PetLayout, PetReaction, PetView } from "../../shared/pet/model.ts";
import { petChannel, petEventChannel } from "../../shared/pet/pet-ipc.ts";
import { log } from "../log/log.ts";
import { loadWin32 } from "../platform/win32/ffi.ts";
import { isPetUrl, petPageUrl } from "../window/app-protocol.ts";
import { e2eBackground } from "../window/main-window.ts";
import { blockZoom } from "../window/security.ts";
import type { PetPosition } from "./pet-store.ts";

/** 窗口大小（DIP）；宠物（renderer/src/pet/pet.css 的 --pet-w / --pet-h）平时画在底部正中，上面留给属性卡和气泡。 */
const PET_WINDOW = { width: 260, height: 470 } as const;
const SPRITE = { width: 180, height: 186 } as const;
/** 宠物平时在窗口里的位置（底部正中）；pet.json 存的位置是按这个摆时窗口的左上角。 */
const HOME = { x: (PET_WINDOW.width - SPRITE.width) / 2, y: PET_WINDOW.height - SPRITE.height } as const;
/** 拖动时跟光标的间隔：Windows 的系统时钟约 15.6ms 一跳，写 10 才每跳都跑（同 main-window.ts 的 frameMs）。 */
const DRAG_FRAME_MS = 10;
/** 眼睛跟光标：多久看一次光标位置。只在朝向变了时发给页面。 */
const GAZE_MS = 200;

export interface PetWindowHandlers {
  getView(): PetView;
  pet(): void;
  openStudio(): void;
  menu(): MenuItemConstructorOptions[];
  rename(name: unknown): Promise<void>;
  /** 宠物窗口的确认框里确认了重新孵化。 */
  rehatch(): void;
  /** 拖完了：存新位置。 */
  moved(position: PetPosition): void;
}

let window: BrowserWindow | null = null;
let handlers: PetWindowHandlers | null = null;
let dragTimer: NodeJS.Timeout | undefined;
let layout: PetLayout = { ...HOME, below: false };
let gaze: PetGaze = { x: 0, y: 0 };

export function getPetWindow(): BrowserWindow | null {
  return window && !window.isDestroyed() ? window : null;
}

/** 宠物在屏幕上占的那块：position 是宠物在窗口底部正中时窗口的左上角。 */
function spriteRect(position: PetPosition): Rectangle {
  return { x: position.x + HOME.x, y: position.y + HOME.y, ...SPRITE };
}

/** 窗口现在的样子换算回存盘的位置（宠物在屏幕上的位置不变）。 */
function positionOf(target: BrowserWindow): PetPosition {
  const bounds = target.getBounds();
  return { x: bounds.x + layout.x - HOME.x, y: bounds.y + layout.y - HOME.y };
}

/**
 * 按宠物的位置摆窗口，窗口整个留在工作区里：宠物上方放得下浮层时宠物在窗口底边，放不下（贴近屏幕上边）时
 * 宠物在窗口顶边、浮层在下面；左右靠屏幕边时窗口夹在屏幕里，宠物偏到窗口一侧。
 */
function arrange(position: PetPosition): { bounds: Rectangle; layout: PetLayout } {
  const sprite = spriteRect(position);
  const area = screen.getDisplayMatching(sprite).workArea;
  const below = sprite.y - area.y < HOME.y;
  const x = Math.min(Math.max(position.x, area.x), area.x + area.width - PET_WINDOW.width);
  const y = below ? sprite.y : position.y;
  return { bounds: { x, y, ...PET_WINDOW }, layout: { x: sprite.x - x, y: sprite.y - y, below } };
}

/**
 * 把存盘的位置夹到某块屏幕的工作区里：保证宠物本身整个看得见（窗口怎么摆见 arrange）。
 * 没摆过（null）时放到主屏工作区右下角。拔掉显示器、改分辨率后也走这里。
 */
function clampPosition(position: PetPosition | null): PetPosition {
  if (position === null) {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + area.width - PET_WINDOW.width - 24,
      y: area.y + area.height - PET_WINDOW.height,
    };
  }
  const sprite = spriteRect(position);
  const area = screen.getDisplayMatching(sprite).workArea;
  const spriteX = Math.min(Math.max(sprite.x, area.x), area.x + area.width - SPRITE.width);
  const spriteY = Math.min(Math.max(sprite.y, area.y), area.y + area.height - SPRITE.height);
  return { x: Math.round(spriteX - HOME.x), y: Math.round(spriteY - HOME.y) };
}

/** 只认宠物窗口的顶层页面。 */
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const current = getPetWindow();
  const frame = event.senderFrame;
  return (
    current !== null &&
    event.sender === current.webContents &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    isPetUrl(frame.url)
  );
}

/** 用 setBounds 而不是 setPosition：在缩放比例不同的两块屏之间拖时，setPosition 会让窗口尺寸跟着变（Electron 的已知问题）。 */
function moveTo(target: BrowserWindow, x: number, y: number): void {
  target.setBounds({ x, y, ...PET_WINDOW });
}

/** 按存盘的位置摆好窗口；宠物在窗口里的位置变了就推给页面。 */
function place(target: BrowserWindow, position: PetPosition): void {
  const next = arrange(position);
  target.setBounds(next.bounds);
  if (next.layout.x === layout.x && next.layout.y === layout.y && next.layout.below === layout.below) return;
  layout = next.layout;
  target.webContents.send(petEventChannel("layout"), layout);
}

/** 光标在宠物哪个方向（-1 / 0 / 1）：离宠物中心超过半个身位才算偏；只在变了时发给页面。拖动中不看。 */
function trackGaze(target: BrowserWindow): void {
  if (target.isDestroyed() || !target.isVisible() || dragTimer !== undefined) return;
  const bounds = target.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - (bounds.x + layout.x + SPRITE.width / 2);
  const dy = cursor.y - (bounds.y + layout.y + SPRITE.height * 0.6);
  const side = (delta: number, half: number) => (delta > half ? 1 : delta < -half ? -1 : 0);
  const next = { x: side(dx, SPRITE.width / 2), y: side(dy, SPRITE.height / 2) };
  if (next.x === gaze.x && next.y === gaze.y) return;
  gaze = next;
  target.webContents.send(petEventChannel("gaze"), gaze);
}

function stopDrag(): void {
  clearInterval(dragTimer);
  dragTimer = undefined;
}

function startDrag(target: BrowserWindow): void {
  stopDrag();
  const cursor = screen.getCursorScreenPoint();
  const start = target.getBounds();
  const offset = { x: cursor.x - start.x, y: cursor.y - start.y };
  dragTimer = setInterval(() => {
    if (target.isDestroyed()) return stopDrag();
    const point = screen.getCursorScreenPoint();
    moveTo(target, point.x - offset.x, point.y - offset.y);
  }, DRAG_FRAME_MS);
}

function endDrag(target: BrowserWindow): void {
  if (dragTimer === undefined) return;
  stopDrag();
  const position = clampPosition(positionOf(target));
  place(target, position);
  handlers?.moved(position);
}

let ipcInstalled = false;

/** 宠物窗口的 IPC（只装一次；窗口不在时发来的一律忽略）。 */
function installIpc(): void {
  if (ipcInstalled) return;
  ipcInstalled = true;
  const on = (name: Parameters<typeof petChannel>[0], listener: (target: BrowserWindow, payload: unknown) => void) =>
    ipcMain.on(petChannel(name), (event, payload: unknown) => {
      const target = getPetWindow();
      if (target === null || !trusted(event)) return;
      listener(target, payload);
    });
  ipcMain.handle(petChannel("getView"), (event) => {
    if (!trusted(event) || handlers === null) throw new Error("发送方不是宠物窗口");
    return handlers.getView();
  });
  ipcMain.handle(petChannel("getLayout"), (event) => {
    if (!trusted(event)) throw new Error("发送方不是宠物窗口");
    return layout;
  });
  ipcMain.handle(petChannel("rename"), (event, name: unknown) => {
    if (!trusted(event) || handlers === null) throw new Error("发送方不是宠物窗口");
    return handlers.rename(name);
  });
  on("dragStart", (target) => startDrag(target));
  on("dragEnd", (target) => endDrag(target));
  on("setInteractive", (target, interactive) => {
    // 拖动中光标可能甩出宠物：这时不能放鼠标穿透，否则松开键的事件到不了页面。
    if (dragTimer !== undefined) return;
    target.setIgnoreMouseEvents(interactive !== true, { forward: true });
  });
  on("pet", () => handlers?.pet());
  on("openStudio", () => handlers?.openStudio());
  on("rehatch", () => handlers?.rehatch());
  on("menu", (target) => {
    if (handlers === null) return;
    Menu.buildFromTemplate(handlers.menu()).popup({ window: target });
  });
  on("setEditing", (target, editing) => {
    // 平时不可聚焦（点宠物不抢走用户正在打字的窗口）；改名、确认框打开时临时可聚焦并拿到焦点，结束还回去。
    target.setFocusable(editing === true);
    if (editing === true) target.focus();
  });
}

const reclamp = () => {
  const target = getPetWindow();
  if (target === null || dragTimer !== undefined) return;
  const position = clampPosition(positionOf(target));
  place(target, position);
};

/** 打开宠物窗口（已开着就什么也不做）。 */
export function openPetWindow(position: PetPosition | null, next: PetWindowHandlers): BrowserWindow {
  handlers = next;
  const existing = getPetWindow();
  if (existing !== null) return existing;
  installIpc();
  const initial = arrange(clampPosition(position));
  layout = initial.layout;
  const created = new BrowserWindow({
    ...initial.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    // mac：NSPanel 才能浮在别的应用的全屏 Space 上，又不用把整个应用变成没有 Dock 图标、菜单栏的后台应用（#16，下面 skipTransformProcessType）。
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "..", "preload", "pet.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    },
  });
  window = created;
  if (e2eBackground && process.platform === "win32")
    loadWin32().dwmapi.cloakWindow(Number(created.getNativeWindowHandle().readBigUInt64LE()));
  // 全屏的应用、mac 的其他桌面（Space）上也在（mac 15 实测，见 pet.md「置顶」）。
  created.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin")
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // Windows：置顶窗口之间按激活先后排，后激活的置顶窗口（开了"总在最前"的编辑器等）会盖住宠物，
  // 而宠物不可聚焦、自己永远不会被激活（#18）。别的窗口一变成前台，就把宠物提回置顶层最上面（moveTop 不抢焦点）。
  const stopRaising =
    process.platform === "win32"
      ? loadWin32().user32.onForegroundChange(() => {
          if (!created.isDestroyed() && created.isVisible()) created.moveTop();
        })
      : undefined;
  created.setIgnoreMouseEvents(true, { forward: true });
  created.webContents.on("will-navigate", (event, url) => {
    if (!isPetUrl(url)) event.preventDefault();
  });
  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  blockZoom(created.webContents);
  created.once("ready-to-show", () => created.showInactive());
  screen.on("display-removed", reclamp);
  screen.on("display-metrics-changed", reclamp);
  gaze = { x: 0, y: 0 };
  const gazeTimer = setInterval(() => trackGaze(created), GAZE_MS);
  created.once("closed", () => {
    stopDrag();
    clearInterval(gazeTimer);
    stopRaising?.();
    screen.off("display-removed", reclamp);
    screen.off("display-metrics-changed", reclamp);
    if (window === created) window = null;
  });
  void created.loadURL(petPageUrl()).catch((error: unknown) => log.error("loading the pet page failed", error));
  return created;
}

export function closePetWindow(): void {
  getPetWindow()?.destroy();
}

export function sendPetView(view: PetView): void {
  const target = getPetWindow();
  if (target !== null && !target.webContents.isDestroyed()) target.webContents.send(petEventChannel("view"), view);
}

export function sendPetReaction(reaction: PetReaction): void {
  const target = getPetWindow();
  if (target !== null && !target.webContents.isDestroyed())
    target.webContents.send(petEventChannel("reaction"), reaction);
}
