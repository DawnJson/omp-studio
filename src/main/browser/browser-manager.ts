// 浏览器面板：每个任务一个 WebContentsView（叠在主窗口上，位置由渲染进程的占位元素给），同时是给这个任务的 omp 用的
// CDP 浏览器（cdp-bridge.ts + cdp-server.ts）。页面在第一次显示或 omp 第一次连上时建，任务归档/删除或应用退出时销毁。
// 所有任务共用一个持久分区：登录状态记住，和应用页面（默认会话）隔开。设计和实测见 docs/architecture/browser.md。
import { randomUUID } from "node:crypto";
import { session, WebContentsView, type BrowserWindow, type Session } from "electron";
import type { BrowserAction, BrowserBounds, BrowserState, TaskId } from "../../shared/ipc.ts";
import { log } from "../log/log.ts";
import { addressToUrl, isBrowsableUrl } from "./address.ts";
import { CdpBridge, type CdpBridgeHost, type CdpPage } from "./cdp-bridge.ts";
import { startCdpServer, type CdpServer } from "./cdp-server.ts";

const PARTITION = "persist:studio-browser";
/** 面板还没显示过时页面的大小：omp 在面板打开之前就能截图、排版。 */
const DEFAULT_BOUNDS = { x: 0, y: 0, width: 1024, height: 768 };
const VERSIONS = { chrome: process.versions.chrome, v8: process.versions.v8 };

export interface BrowserManagerDeps {
  window(): BrowserWindow | null;
  emitState(state: BrowserState): void;
  emitConnected(taskId: TaskId): void;
}

let browserSession: Session | null = null;

/** 面板的会话：拒绝一切权限请求（摄像头、通知、地理位置……），和应用自己的页面一样。 */
function getBrowserSession(): Session {
  if (browserSession !== null) return browserSession;
  const created = session.fromPartition(PARTITION);
  created.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  created.setPermissionCheckHandler(() => false);
  created.setDevicePermissionHandler(() => false);
  browserSession = created;
  return created;
}

function newTargetId(): string {
  return randomUUID().replace(/-/g, "").toUpperCase();
}

class ElectronPage implements CdpPage {
  readonly tabId = newTargetId();
  readonly pageId = newTargetId();
  readonly view: WebContentsView;
  #attached = false;
  #releasing = false;
  readonly #bridge: CdpBridge;

  constructor(view: WebContentsView, bridge: CdpBridge) {
    this.view = view;
    this.#bridge = bridge;
    const debug = view.webContents.debugger;
    debug.on("message", (_event, method, params, sessionId) =>
      bridge.pageEvent(method, params, sessionId || undefined),
    );
    debug.on("detach", () => {
      this.#attached = false;
      if (!this.#releasing) bridge.pageDetached(this);
    });
  }

  title(): string {
    return this.view.webContents.getTitle();
  }

  url(): string {
    return this.view.webContents.getURL();
  }

  send(method: string, params: Record<string, unknown>, sessionId: string | undefined): Promise<unknown> {
    const debug = this.view.webContents.debugger;
    if (!this.#attached) {
      debug.attach("1.3");
      this.#attached = true;
    }
    return debug.sendCommand(method, params, sessionId);
  }

  navigate(url: string): void {
    void this.view.webContents.loadURL(url).catch(() => {
      // 打不开（断网、证书错误）时页面自己显示错误页，状态由导航事件推给界面。
    });
  }

  release(): void {
    if (!this.#attached) return;
    this.#releasing = true;
    this.view.webContents.debugger.detach();
    this.#releasing = false;
    this.#attached = false;
  }

  /** 页面被销毁前调用：通知 CDP 客户端，再关掉 webContents。 */
  destroy(): void {
    this.#bridge.pageDestroyed(this);
    this.view.webContents.close();
  }
}

class TaskBrowser implements CdpBridgeHost {
  readonly bridge = new CdpBridge(this, VERSIONS);
  server: Promise<CdpServer> | null = null;
  #page: ElectronPage | null = null;
  #window: BrowserWindow | null = null;
  #bounds: BrowserBounds = DEFAULT_BOUNDS;
  readonly #taskId: TaskId;
  readonly #deps: BrowserManagerDeps;

  constructor(taskId: TaskId, deps: BrowserManagerDeps) {
    this.#taskId = taskId;
    this.#deps = deps;
  }

  page(create: boolean): ElectronPage | null {
    if (this.#page === null && create) this.#page = this.#create();
    return this.#page;
  }

  connected(): void {
    this.#deps.emitConnected(this.#taskId);
  }

  state(): BrowserState {
    const contents = this.#page?.view.webContents;
    return {
      taskId: this.#taskId,
      // 新页面先载入 about:blank（见 #create），地址栏不显示它。
      url: contents === undefined || contents.getURL() === "about:blank" ? "" : contents.getURL(),
      title: contents?.getTitle() ?? "",
      loading: contents?.isLoading() ?? false,
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
    };
  }

  /** bounds 是窗口内容区里的设备无关像素（已乘过应用页面的缩放）；null = 藏起来（仍在窗口里，omp 照样能截图）。 */
  place(bounds: BrowserBounds | null): void {
    const page = this.page(true)!;
    this.#attachTo(this.#deps.window());
    if (bounds !== null) {
      this.#bounds = bounds;
      page.view.setBounds(bounds);
    }
    page.view.setVisible(bounds !== null);
  }

  destroy(): void {
    const page = this.#page;
    this.#page = null;
    if (page === null) return;
    if (this.#window !== null && !this.#window.isDestroyed()) this.#window.contentView.removeChildView(page.view);
    this.#window = null;
    page.destroy();
  }

  /** 视图挂在主窗口上：隐藏的视图仍能被 CDP 截图，不挂在窗口上的截图会一直等（2026-10-28 实测，Electron 44）。 */
  #attachTo(window: BrowserWindow | null): void {
    const page = this.#page;
    if (page === null || window === null || window === this.#window) return;
    if (this.#window !== null && !this.#window.isDestroyed()) this.#window.contentView.removeChildView(page.view);
    window.contentView.addChildView(page.view);
    this.#window = window;
  }

  #create(): ElectronPage {
    const view = new WebContentsView({
      webPreferences: {
        session: getBrowserSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    const contents = view.webContents;
    // 面板藏起来时页面照常运行、渲染：omp 在后台操作、截图不受影响。
    contents.setBackgroundThrottling(false);
    view.setBounds(this.#bounds);
    view.setVisible(false);
    const page = new ElectronPage(view, this.bridge);
    contents.setWindowOpenHandler(({ url }) => {
      // 只有一个页面：新窗口在原页面里打开。
      if (isBrowsableUrl(url)) page.navigate(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => {
      if (!isBrowsableUrl(event.url)) event.preventDefault();
    });
    const changed = () => {
      if (this.#page !== page) return;
      this.bridge.pageInfoChanged();
      this.#deps.emitState(this.state());
    };
    contents.on("did-start-loading", changed);
    contents.on("did-stop-loading", changed);
    contents.on("did-navigate", changed);
    contents.on("did-navigate-in-page", changed);
    contents.on("page-title-updated", changed);
    contents.on("render-process-gone", (_event, details) => log.warn("browser page process gone", details.reason));
    this.#page = page;
    this.#attachTo(this.#deps.window());
    // 地址为空的目标 puppeteer 当作没初始化，`browser.targets()` 里没有它，omp 报 "No page targets available"
    // （2026-10-28 实测 omp 18.13.1）：先载入 about:blank，载完发 targetInfoChanged。
    // 紧接着就跳到别的地址时这次载入被打断（ERR_ABORTED），不算错。
    contents.loadURL("about:blank").catch((error: unknown) => {
      if (!String(error).includes("ERR_ABORTED")) log.warn("browser page failed to load about:blank", String(error));
    });
    return page;
  }
}

export class BrowserManager {
  readonly #browsers = new Map<TaskId, TaskBrowser>();
  readonly #deps: BrowserManagerDeps;

  constructor(deps: BrowserManagerDeps) {
    this.#deps = deps;
  }

  #browser(taskId: TaskId): TaskBrowser {
    let browser = this.#browsers.get(taskId);
    if (browser === undefined) {
      browser = new TaskBrowser(taskId, this.#deps);
      this.#browsers.set(taskId, browser);
    }
    return browser;
  }

  /** 给这个任务的 omp 的 CDP 地址（`browser.cdpUrl`）；第一次要时开口。 */
  async endpoint(taskId: TaskId): Promise<string> {
    const browser = this.#browser(taskId);
    browser.server ??= startCdpServer(browser.bridge, VERSIONS);
    return (await browser.server).url;
  }

  place(taskId: TaskId, bounds: BrowserBounds | null): BrowserState {
    const browser = this.#browser(taskId);
    const zoom = this.#deps.window()?.webContents.getZoomFactor() ?? 1;
    browser.place(
      bounds === null
        ? null
        : {
            x: Math.round(bounds.x * zoom),
            y: Math.round(bounds.y * zoom),
            width: Math.round(bounds.width * zoom),
            height: Math.round(bounds.height * zoom),
          },
    );
    return browser.state();
  }

  navigate(taskId: TaskId, text: string): void {
    const url = addressToUrl(text);
    if (url === null) throw new Error("只能打开 http / https 地址");
    this.#browser(taskId).page(true)!.navigate(url);
  }

  action(taskId: TaskId, action: BrowserAction): void {
    const contents = this.#browsers.get(taskId)?.page(false)?.view.webContents;
    if (contents === undefined) return;
    if (action === "back") contents.navigationHistory.goBack();
    else if (action === "forward") contents.navigationHistory.goForward();
    else if (action === "reload") contents.reload();
    else contents.stop();
  }

  /** 任务归档、删除：关页面和 CDP 口。 */
  async close(taskId: TaskId): Promise<void> {
    const browser = this.#browsers.get(taskId);
    if (browser === undefined) return;
    this.#browsers.delete(taskId);
    browser.destroy();
    const server = browser.server;
    if (server !== null) await (await server).close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#browsers.keys()].map((taskId) => this.close(taskId)));
  }
}
