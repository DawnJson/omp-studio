// 输入框草稿的持久化（userData/drafts.json）：切任务、重启应用都不丢字。只存文字，图片不存（太大）。
// key 是任务 id 或 `new:<projectId>`（空状态里的草稿）；渲染进程传来的都当不可信，限长限量。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";
import { parseString } from "./validate.ts";

const maxDrafts = 300;
const maxChars = 200_000;

let cache: Map<string, string> | null = null;
let writing: Promise<void> = Promise.resolve();

const file = () => path.join(app.getPath("userData"), "drafts.json");

async function load(): Promise<Map<string, string>> {
  if (cache) return cache;
  try {
    const raw: unknown = JSON.parse(await readFile(file(), "utf8"));
    cache = new Map(
      Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value] as [string, string]] : [],
      ),
    );
  } catch (error) {
    // 只有文件不存在才是"还没有草稿"；其它错误（EBUSY…）抛给调用方，免得下一次保存把原文件覆盖成空的。
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    cache = new Map();
  }
  return cache;
}

function persist(drafts: Map<string, string>): Promise<void> {
  const snapshot = JSON.stringify(Object.fromEntries(drafts));
  // 串行写，先写临时文件再改名。一次失败不连累后面的写入；这次的错误返回给 saveDraft，由调用方看到。
  const run = writing.then(() => writeFileAtomic(file(), snapshot, "draft"));
  writing = run.catch(() => {});
  return run;
}

export const draftHandlers: HandlerGroup<"getDrafts" | "saveDraft"> = {
  async getDrafts() {
    return Object.fromEntries(await load());
  },

  async saveDraft(key, text) {
    const k = parseString(key, "key", 220);
    const value = parseString(text, "text", maxChars, { allowEmpty: true });
    const drafts = await load();
    if (value === "") drafts.delete(k);
    else {
      if (!drafts.has(k) && drafts.size >= maxDrafts) throw new Error("too many drafts");
      drafts.set(k, value);
    }
    await persist(drafts);
  },
};
