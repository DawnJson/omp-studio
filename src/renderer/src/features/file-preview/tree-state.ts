// 文件树按树根目录记住的状态：展开的目录、光标所在的行、滚动位置。只在内存；面板关了、切走任务再回来仍在。
// 键是目录路径：同一个文件夹里的任务共用一份（文件夹数有限，不随任务删除清理）。

export interface TreeMemory {
  expanded: ReadonlySet<string>;
  active: string | null;
  scrollTop: number;
}

const memory = new Map<string, TreeMemory>();

export function treeMemory(key: string): TreeMemory {
  let entry = memory.get(key);
  if (entry === undefined) {
    entry = { expanded: new Set(), active: null, scrollTop: 0 };
    memory.set(key, entry);
  }
  return entry;
}
