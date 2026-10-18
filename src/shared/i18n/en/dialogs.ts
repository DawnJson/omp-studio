import type { MessageEntry } from "../index.ts";
import type { dialogs as zhCN } from "../zh-CN/dialogs.ts";

export const dialogs = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
