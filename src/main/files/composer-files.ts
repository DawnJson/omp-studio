// 输入框的文件附件登记（路径不可信，也不给渲染进程）：拖入 / 粘贴 / 选择器拿到的路径在这里校验并换成不透明的 id，
// 渲染进程只拿 id + 名字 + 大小；发送时凭 id 换回路径（tsp-runner 的 sendPrompt）。
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { limits, type ComposerFile } from "../../shared/ipc.ts";

const maxRegistered = 500;
const registry = new Map<string, string>();

/** 绝对路径、不含 `"`（会破坏 @"…" 提及）、确实是普通文件才登记；其余原样返回（目录、不存在、相对路径…）。 */
export async function registerComposerFiles(
  paths: readonly string[],
): Promise<{ files: ComposerFile[]; rest: string[] }> {
  const files: ComposerFile[] = [];
  const rest: string[] = [];
  for (const candidate of paths.slice(0, limits.promptMaxFiles)) {
    const info =
      path.isAbsolute(candidate) && !candidate.includes('"') ? await stat(candidate).catch(() => null) : null;
    if (!info?.isFile()) {
      rest.push(candidate);
      continue;
    }
    const id = randomUUID();
    registry.set(id, candidate);
    if (registry.size > maxRegistered) registry.delete(registry.keys().next().value!);
    files.push({ id, name: path.basename(candidate), size: info.size });
  }
  return { files, rest };
}

/** id → 路径（顺序同 ids）；没登记过的 id、已经不存在的文件 reject（发送失败，草稿会放回去）。 */
export async function resolveComposerFiles(ids: readonly string[]): Promise<string[]> {
  return Promise.all(
    ids.map(async (id) => {
      const file = registry.get(id);
      if (file === undefined) throw new Error("the attached file is no longer available");
      if (!(await stat(file).catch(() => null))?.isFile())
        throw new Error(`the attached file is gone: ${path.basename(file)}`);
      return file;
    }),
  );
}
