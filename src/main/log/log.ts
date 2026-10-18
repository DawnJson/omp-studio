// 主进程日志：写 <userData>/logs/main-<本地日期>.log，按天换文件，保留最近 RETAIN_DAYS 天。
// 每一行写之前过一遍脱敏（家目录、用户名、key/token、带签名的 URL 参数），规则见 src/main/AGENTS.md "日志和路径脱敏"。
// 这个文件不 import electron：单元测试和被测模块（installer.ts 等）可以直接用 `log`；
// 应用启动时 instance.ts 用 setLogger() 接上真正的文件，之前（和测试里）只打到控制台。
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { formatWithOptions } from "node:util";

export const RETAIN_DAYS = 14;
const FILE_PATTERN = /^main-(\d{4}-\d{2}-\d{2})\.log$/;

export type LogLevel = "info" | "warn" | "error";

export interface RedactContext {
  home: string;
  user: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 返回脱敏函数。家目录（反斜杠、正斜杠、JSON 转义的双反斜杠三种写法，不分大小写）换成 `~`，剩下的用户名换成 `<user>`。 */
export function createRedactor({ home, user }: RedactContext): (text: string) => string {
  const homeForms = [...new Set([home, home.replaceAll("\\", "/"), home.replaceAll("\\", "\\\\")])].filter(
    (form) => form.length > 0,
  );
  const homePattern = homeForms.length > 0 ? new RegExp(homeForms.map(escapeRegExp).join("|"), "gi") : null;
  // 太短的用户名（如 "a"）会误伤普通单词，只换路径里的。
  const userPattern =
    user.length >= 3 ? new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(user)}(?![A-Za-z0-9])`, "gi") : null;
  return (text) => {
    let out = text;
    if (homePattern) out = out.replace(homePattern, "~");
    if (userPattern) out = out.replace(userPattern, "<user>");
    return out
      .replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]*/g, "$1?<redacted>")
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 <redacted>")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-<redacted>")
      .replace(
        /\b([A-Za-z_-]*(?:api[_-]?key|token|secret|password|authorization)[A-Za-z_-]*)(["']?\s*[:=]\s*["']?)(?!<redacted>|Bearer\s|Basic\s)[^\s"',;&]+/gi,
        "$1$2<redacted>",
      );
  };
}

/** 本地日期 YYYY-MM-DD：日志按用户所在时区的自然日换文件。 */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface LoggerOptions {
  dir: string;
  redact: (text: string) => string;
  now?: () => Date;
  /** 开发时同时打到控制台。 */
  mirror?: boolean;
}

export class Logger {
  readonly dir: string;
  #redact: (text: string) => string;
  #now: () => Date;
  #mirror: boolean;
  #day = "";

  constructor(options: LoggerOptions) {
    this.dir = options.dir;
    this.#redact = options.redact;
    this.#now = options.now ?? (() => new Date());
    this.#mirror = options.mirror ?? false;
  }

  write(level: LogLevel, message: string, details: unknown[]): void {
    const now = this.#now();
    const day = localDay(now);
    const text = this.#redact(
      formatWithOptions({ colors: false, depth: 4, breakLength: Infinity }, message, ...details),
    );
    const line = `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`;
    if (this.#mirror) console[level](line.trimEnd());
    try {
      if (day !== this.#day) {
        mkdirSync(this.dir, { recursive: true });
        // 先记下日期：清理旧文件失败（被占用）时这一天不再反复重试，日志照写。
        this.#day = day;
        this.#prune(now);
      }
      appendFileSync(path.join(this.dir, `main-${day}.log`), line, "utf8");
    } catch (error) {
      // 写日志失败不能让应用跟着失败；打到控制台，开发时能看见。
      console.error("failed to write log", error);
    }
  }

  /** 当前和之前的日志文件，按日期从新到旧。 */
  files(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => FILE_PATTERN.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(this.dir, name));
  }

  #prune(now: Date): void {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - (RETAIN_DAYS - 1));
    const oldest = localDay(cutoff);
    for (const file of this.files()) {
      const day = FILE_PATTERN.exec(path.basename(file))?.[1];
      // 不用 rmSync：Node 24.13 在 Windows 上遇到非 ASCII 路径（userData 在中文用户名下）时静默不删。
      if (day !== undefined && day < oldest) unlinkSync(file);
    }
  }
}

let current: Logger | null = null;

export function setLogger(logger: Logger | null): void {
  current = logger;
}

export function currentLogger(): Logger | null {
  return current;
}

function write(level: LogLevel, message: string, details: unknown[]): void {
  if (current) current.write(level, message, details);
  else console[level](message, ...details);
}

export const log = {
  info: (message: string, ...details: unknown[]) => write("info", message, details),
  warn: (message: string, ...details: unknown[]) => write("warn", message, details),
  error: (message: string, ...details: unknown[]) => write("error", message, details),
};
