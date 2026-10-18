// userData 下的小 JSON 文件：读（不存在返回 null）和先写临时文件再改名的原子写。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 文件不存在返回 null；内容不是合法 JSON 同样返回 null（损坏的偏好文件不该让应用起不来，下次保存会覆盖）。 */
export function readJsonFile(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error(`${file} 不是合法 JSON，按默认值处理`);
    return null;
  }
}

export function writeJsonFileAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  renameSync(temp, file);
}
