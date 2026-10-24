// 文件树按任务（或草稿）记住的状态：展开的目录、光标所在的行、滚动位置。只在内存；面板关了、切走任务再回来仍在。
import type { TerminalKey } from "../../../../shared/ipc.ts";

export interface TreeMemory {
  expanded: ReadonlySet<string>;
  active: string | null;
  scrollTop: number;
}

const memory = new Map<TerminalKey, TreeMemory>();

// 任务删除：丢掉它的树和它各个额外根的树（键 = 任务 id，或 rootMemoryKey 拼的 `${id}\0root${n}`）。草稿页的键按项目，不随任务走。
if (typeof window !== "undefined" && "studio" in window) {
  window.studio.onTaskRemoved((taskId) => {
    for (const key of Array.from(memory.keys())) {
      if (key === taskId || key.startsWith(`${taskId}\u0000root`)) memory.delete(key);
    }
  });
}

export function treeMemory(key: TerminalKey): TreeMemory {
  let entry = memory.get(key);
  if (entry === undefined) {
    entry = { expanded: new Set(), active: null, scrollTop: 0 };
    memory.set(key, entry);
  }
  return entry;
}
