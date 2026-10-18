// 终端 IPC 的参数校验（纯函数，不 import electron，单元测试直接用）。渲染进程传来的一切都不可信。
import { limits } from "../../shared/ipc.ts";

export interface TerminalSize {
  cols: number;
  rows: number;
}

function parseDimension(value: unknown, name: string): number {
  const [min, max] = limits.terminalSizeRange;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} 必须是 ${min}–${max} 的整数`);
  }
  return value;
}

export function parseTerminalSize(cols: unknown, rows: unknown): TerminalSize {
  return { cols: parseDimension(cols, "cols"), rows: parseDimension(rows, "rows") };
}

/** 键盘输入：字符串，可以为空以外的任意内容（控制字符、转义序列都是合法输入），只限长度。 */
export function parseTerminalInput(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("data 必须是字符串");
  if (value.length === 0) throw new TypeError("data 不能为空");
  if (value.length > limits.terminalInputMaxChars)
    throw new TypeError(`data 超过 ${limits.terminalInputMaxChars} 个字符`);
  return value;
}
