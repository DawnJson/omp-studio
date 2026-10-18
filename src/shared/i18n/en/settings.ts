import type { MessageEntry } from "../index.ts";
import type { settings as zhCN } from "../zh-CN/settings.ts";

export const settings = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
