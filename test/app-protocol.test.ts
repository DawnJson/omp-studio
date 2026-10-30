import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// userData 带空格和中文：拼出来的背景图路径要原样落在 backdrops 目录里。
const hoisted = vi.hoisted(() => ({ userData: "C:\\Users\\someone\\AppData\\Roaming\\omp studio 数据" }));

vi.mock("electron", () => ({
  net: {},
  protocol: {},
  app: { getPath: () => hoisted.userData },
  nativeTheme: { themeSource: "system" },
}));
vi.mock("../src/main/ipc/events.ts", () => ({ emitEvent: vi.fn() }));
vi.mock("../src/main/window/main-window.ts", () => ({ getMainWindow: () => null, isAppUrl: () => false }));

const { resolveAppFile } = await import("../src/main/window/app-protocol.ts");

const backdrop = `${"ab12".repeat(16)}.png`;

// 防的是：渲染进程（或被注入的页面）用 app:// 读出 out/renderer 之外的本机文件。
describe("resolveAppFile", () => {
  it("入口和资源映射到 renderer 目录内", () => {
    const index = resolveAppFile("app://studio/index.html");
    expect(index && path.basename(index)).toBe("index.html");
    expect(resolveAppFile("app://studio/")).toBe(index);
    expect(resolveAppFile("app://studio/assets/a.js")).not.toBeNull();
  });

  it.each([
    "app://studio/%2e%2e/%2e%2e/package.json",
    "app://studio/..%5C..%5Cpackage.json",
    "app://studio/assets/..%2f..%2f..%2fpackage.json",
    "app://studio/C:%5CWindows%5Cwin.ini",
    "app://other/index.html",
    "file:///C:/Windows/win.ini",
  ])("%s 不会指到 renderer 目录之外", (url) => {
    // URL 解析会把 %2e%2e 折叠成根下的路径（仍在目录内）；要么拒绝，要么必须落在 renderer 目录里。
    const file = resolveAppFile(url);
    if (file !== null)
      expect(file.startsWith(path.dirname(resolveAppFile("app://studio/index.html") ?? "") + path.sep)).toBe(true);
  });

  it("其他主机和协议被拒绝", () => {
    expect(resolveAppFile("app://other/index.html")).toBeNull();
    expect(resolveAppFile("file:///C:/Windows/win.ini")).toBeNull();
  });

  it("@backdrop/<sha256>.<扩展名> 映射到 userData/backdrops 里的那个文件", () => {
    expect(resolveAppFile(`app://studio/@backdrop/${backdrop}`)).toBe(
      path.join(hoisted.userData, "backdrops", backdrop),
    );
    expect(resolveAppFile(`app://studio/@backdrop/${backdrop.replace(".png", ".jpeg")}`)).not.toBeNull();
  });

  it.each([
    "app://studio/@backdrop/settings.json",
    `app://studio/@backdrop/${backdrop}.exe`,
    `app://studio/@backdrop/${backdrop.toUpperCase()}`,
    `app://studio/@backdrop/sub/${backdrop}`,
    `app://studio/@backdrop/..%2f${backdrop}`,
    "app://studio/@backdrop/..%2fsettings.json",
    "app://studio/@backdrop/..%5Csettings.json",
    `app://studio/@backdrop/%2e%2e%2f..%2f${backdrop}`,
    "app://studio/@backdrop/",
  ])("%s 不是 backdrops 里合规的文件名：拒绝", (url) => {
    expect(resolveAppFile(url)).toBeNull();
  });

  it("@backdrop/../ 被 URL 解析折叠后落回 renderer 目录，读不到 userData", () => {
    const file = resolveAppFile("app://studio/@backdrop/../settings.json");
    expect(file).toBe(path.join(path.dirname(resolveAppFile("app://studio/index.html") ?? ""), "settings.json"));
    expect(file?.startsWith(hoisted.userData)).toBe(false);
  });
});
