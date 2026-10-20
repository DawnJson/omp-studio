import type { MessageEntry } from "../index.ts";
import type { preview as zhCN } from "../zh-CN/preview.ts";

export const preview = {
  title: "File preview",
  close: "Close preview",
  open: "Open with default app",
  reveal: "Show in folder",
  modePreview: "Preview",
  modeSource: "Source",
  mode: "View mode",
  runScripts: "Run scripts",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Fit to pane",
  loading: "Reading…",
  missing: "File not found: {path}",
  binary: "This is a binary file and can't be previewed.",
  tooLarge: "File is too large to preview ({size}).",
  readFailed: "Failed to read: {message}",
  imageAlt: "Image preview: {name}",
  htmlTitle: "Web page preview: {name}",
  resize: "Resize preview",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
