// 浏览器面板地址栏的文字 -> 打开的地址（src/main/browser/address.ts）。
import { describe, expect, it } from "vitest";
import { addressToUrl } from "../src/main/browser/address.ts";

describe("addressToUrl", () => {
  it.each([
    ["example.com", "https://example.com/"],
    ["example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://example.com", "http://example.com/"],
    ["localhost:5173", "http://localhost:5173/"],
    ["127.0.0.1:8080/x", "http://127.0.0.1:8080/x"],
    ["  https://example.com  ", "https://example.com/"],
  ])("%s -> %s", (text, url) => {
    expect(addressToUrl(text)).toBe(url);
  });

  it("带空格或不像地址的当搜索词", () => {
    expect(addressToUrl("electron webcontentsview")).toBe("https://www.bing.com/search?q=electron%20webcontentsview");
    expect(addressToUrl("hello")).toBe("https://www.bing.com/search?q=hello");
  });

  it("别的协议打不开", () => {
    expect(addressToUrl("file:///C:/Windows/win.ini")).toBeNull();
    expect(addressToUrl("javascript:alert(1)")).toBeNull();
    expect(addressToUrl("")).toBeNull();
  });
});
