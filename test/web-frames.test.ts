// 防的是：应用页面里的子框架（文件预览的网页、回答里内嵌的网页）把自己换成别的东西——预览页面跳到外部网页（预览就成了联网的浏览器），
// 内嵌网页跳到 file: / studio-preview: / app:（读本机文件、借预览页面的源），或者从空框架直接载入 file:、javascript:。
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));
vi.mock("../src/main/ipc/events.ts", () => ({ emitEvent: () => undefined }));

const { frameNavigationAllowed } = await import("../src/main/window/web-frames.ts");

describe("frameNavigationAllowed", () => {
  it("预览网页只能留在预览网页和 about:blank / about:srcdoc", () => {
    const at = "studio-preview://token/";
    expect(frameNavigationAllowed(at, "studio-preview://other/")).toBe(true);
    expect(frameNavigationAllowed(at, "about:blank")).toBe(true);
    expect(frameNavigationAllowed(at, "https://example.com/")).toBe(false);
    expect(frameNavigationAllowed(at, "file:///C:/x.html")).toBe(false);
  });

  it("内嵌网页只能去别的网页", () => {
    const at = "http://127.0.0.1:1234/page.html";
    expect(frameNavigationAllowed(at, "https://example.com/next")).toBe(true);
    for (const target of ["file:///C:/x.html", "studio-preview://token/", "app://studio/index.html", "about:blank"])
      expect(frameNavigationAllowed(at, target)).toBe(false);
  });

  it("刚建的框架只能载入预览网页、网页或空白页", () => {
    for (const current of ["", "about:blank"]) {
      expect(frameNavigationAllowed(current, "studio-preview://token/")).toBe(true);
      expect(frameNavigationAllowed(current, "https://example.com/")).toBe(true);
      for (const target of ["file:///C:/x.html", "javascript:alert(1)", "data:text/html,hi", "app://studio/"])
        expect(frameNavigationAllowed(current, target)).toBe(false);
    }
  });
});
