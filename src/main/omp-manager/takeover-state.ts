// "问过没有"的记录：userData/omp-studio-state.json（照 Tern 的 state.json `offered`）。
// 接管询问按 exe 路径记，用户换了一个新的自装 omp 会再问一次。
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../tasks/atomic-write.ts";

type TakeoverAnswer = "accepted" | "declined";

export interface OmpStudioState {
  takeover: Record<string, TakeoverAnswer>;
}

/** Windows 的路径不区分大小写，记录用小写作键。 */
export function takeoverKey(exePath: string): string {
  return process.platform === "win32" ? exePath.toLowerCase() : exePath;
}

export async function readState(file: string): Promise<OmpStudioState> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { takeover: {} };
    throw error;
  }
  const json: unknown = JSON.parse(text);
  const state: OmpStudioState = { takeover: {} };
  if (typeof json !== "object" || json === null) return state;
  const takeover = "takeover" in json ? json.takeover : null;
  if (typeof takeover === "object" && takeover !== null) {
    for (const [key, value] of Object.entries(takeover))
      if (value === "accepted" || value === "declined") state.takeover[key] = value;
  }
  return state;
}

export async function writeState(file: string, state: OmpStudioState): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(state, null, 2), `omp-studio-${process.pid}`);
}
