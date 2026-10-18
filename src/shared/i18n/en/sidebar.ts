import type { MessageEntry } from "../index.ts";
import type { sidebar as zhCN } from "../zh-CN/sidebar.ts";

export const sidebar = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
