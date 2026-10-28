import type { MessageEntry } from "../index.ts";
import type { browser as zhCN } from "../zh-CN/browser.ts";

export const browser = {
  panelLabel: "Browser",
  toggle: "Browser",
  close: "Close the browser",
  resize: "Resize the panel",
  back: "Back",
  forward: "Forward",
  reload: "Reload",
  stop: "Stop loading",
  address: "Address",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
