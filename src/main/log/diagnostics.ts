// "导出诊断信息"：把版本、系统、omp 状态、设置和最近几天的日志写成一个文本文件，用户附在 issue 里。
// 整份内容再过一遍脱敏（omp 路径、设置里可能有家目录）；日志本身写入时已经脱敏过。
import { app, BrowserWindow, dialog, shell } from "electron";
import { open, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ompManager } from "../omp-manager/index.ts";
import { getSettings } from "../settings/settings-store.ts";
import { localDay } from "./log.ts";
import { redactForLog, recentLogFiles } from "./instance.ts";

const LOG_DAYS = 3;
/** 每个日志文件只取末尾这么多，免得文件大到附不进 issue。 */
const LOG_TAIL_BYTES = 1024 * 1024;

async function tail(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    const text = buffer.toString("utf8", 0, bytesRead);
    if (size <= LOG_TAIL_BYTES) return text;
    // 截断处可能切在一行或一个多字节字符中间：丢掉第一行残行。
    return `…（前面省略）\n${text.slice(text.indexOf("\n") + 1)}`;
  } finally {
    await handle.close();
  }
}

async function diagnosticsText(): Promise<string> {
  const sections = [
    "# omp-studio diagnostics",
    `generated: ${new Date().toISOString()}`,
    `app: ${app.getVersion()} (packaged: ${app.isPackaged})`,
    `runtime: electron ${process.versions.electron}, chrome ${process.versions.chrome}, node ${process.versions.node}`,
    `os: ${process.platform} ${os.release()} ${process.arch}, locale ${app.getLocale()}`,
    "",
    "## omp",
    JSON.stringify(ompManager().status, null, 2),
    "",
    "## settings",
    JSON.stringify(getSettings(), null, 2),
  ];
  for (const file of recentLogFiles().slice(0, LOG_DAYS)) {
    sections.push("", `## ${path.basename(file)}`, await tail(file));
  }
  return redactForLog(sections.join("\n"));
}

/** 弹保存对话框写文件，写完在资源管理器里选中它。用户取消返回 false。 */
export async function exportDiagnostics(): Promise<boolean> {
  const window = BrowserWindow.getFocusedWindow();
  const options = {
    defaultPath: path.join(app.getPath("desktop"), `omp-studio-diagnostics-${localDay(new Date())}.txt`),
    filters: [{ name: "Text", extensions: ["txt"] }],
  };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, await diagnosticsText(), "utf8");
  shell.showItemInFolder(result.filePath);
  return true;
}
