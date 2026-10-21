// 文件树按任务（或草稿）记住的状态：展开的目录、光标所在的行、滚动位置。只在内存；面板关了、切走任务再回来仍在。
import type { TerminalKey } from "../../../../shared/ipc.ts";

export interface TreeMemory {
  expanded: ReadonlySet<string>;
  active: string | null;
  scrollTop: number;
}

const memory = new Map<TerminalKey, TreeMemory>();

export function treeMemory(key: TerminalKey): TreeMemory {
  let entry = memory.get(key);
  if (entry === undefined) {
    entry = { expanded: new Set(), active: null, scrollTop: 0 };
    memory.set(key, entry);
  }
  return entry;
}
