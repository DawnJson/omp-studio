import type { MessageEntry } from "../index.ts";
import type { shell as zhCN } from "../zh-CN/shell.ts";

export const shell = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
