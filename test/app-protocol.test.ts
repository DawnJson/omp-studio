import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: {}, protocol: {} }));

const { resolveAppFile } = await import("../src/main/window/app-protocol.ts");

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
    if (file !== null) expect(file.startsWith(path.dirname(resolveAppFile("app://studio/index.html") ?? "") + path.sep)).toBe(true);
  });

  it("其他主机和协议被拒绝", () => {
    expect(resolveAppFile("app://other/index.html")).toBeNull();
    expect(resolveAppFile("file:///C:/Windows/win.ini")).toBeNull();
  });
});
