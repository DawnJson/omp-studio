// 文件预览的网页：登记到主进程内存、拿 token，用完放手（window/preview-protocol.ts）。
import { limits, type HandlerGroup } from "../../shared/ipc.ts";
import { registerPreview, releasePreview } from "../window/preview-protocol.ts";
import { parseString } from "./validate.ts";

export const previewHandlers: HandlerGroup<"registerHtmlPreview" | "releaseHtmlPreview"> = {
  async registerHtmlPreview(html) {
    return registerPreview(parseString(html, "html", limits.htmlPreviewMaxChars, { allowEmpty: true }));
  },
  async releaseHtmlPreview(token) {
    releasePreview(parseString(token, "token", 64));
  },
};
