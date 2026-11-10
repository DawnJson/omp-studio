import { describe, expect, it, vi } from "vitest";
import {
  previewResponse,
  registerPreview,
  releaseAllPreviews,
  releasePreview,
} from "../src/main/window/preview-protocol.ts";

vi.mock("electron", () => ({ net: {}, protocol: {}, app: { getPath: () => "C:\\Users\\someone\\AppData" } }));

const get = (url: string, method = "GET") => previewResponse(new Request(url, { method }));

// 防的是：猜到 / 留着旧地址就能读到别的预览网页，以及页面的 CSP 被放宽（能联网、能被别的页面嵌入）。
describe("studio-preview 协议", () => {
  it("已登记的 token 返回网页，带固定 CSP", async () => {
    const token = registerPreview("<h1>hi</h1>");
    const response = get(`studio-preview://${token}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>hi</h1>");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; " +
        "font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; " +
        "frame-ancestors app://studio",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    releasePreview(token);
  });

  it("token 是随机 UUID，每次不同", () => {
    const a = registerPreview("");
    const b = registerPreview("");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    releaseAllPreviews();
  });

  it("不认识的 token 404", () => {
    expect(get("studio-preview://00000000-0000-4000-8000-000000000000/").status).toBe(404);
  });

  it("放手后同一地址 404；全部清掉后也 404", () => {
    const released = registerPreview("<p>a</p>");
    releasePreview(released);
    expect(get(`studio-preview://${released}/`).status).toBe(404);
    const cleared = registerPreview("<p>b</p>");
    releaseAllPreviews();
    expect(get(`studio-preview://${cleared}/`).status).toBe(404);
  });

  it("子路径、非 GET 404", () => {
    const token = registerPreview("<p>c</p>");
    expect(get(`studio-preview://${token}/other.html`).status).toBe(404);
    expect(get(`studio-preview://${token}/`, "POST").status).toBe(404);
    releasePreview(token);
  });
});
