// 主进程日志：写 <userData>/logs/main-<本地日期>.log，按天换文件，保留最近 RETAIN_DAYS 天。
// 每一行写之前过一遍脱敏（家目录、用户名、key/token、带签名的 URL 参数），规则见 docs/architecture/security.md「日志和脱敏」。
// 写盘是异步的：行先进队列，同一时间只有一个 appendFile 在途，在途期间来的行攒成一批、下一次一起写，顺序不变。
// 退出前（window/shutdown.ts）等 flush()；进程直接退出时（app.exit 等）instance.ts 在 exit 事件里 flushSync() 写掉还没开始写的行。
// 这个文件不 import electron：单元测试和被测模块（installer.ts 等）可以直接用 `log`；
// 应用启动时 instance.ts 用 setLogger() 接上真正的文件，之前（和测试里）只打到控制台。
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { appendFile } from "node:fs/promises";
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

/**
 * 返回脱敏函数。家目录换成 `~`，剩下的用户名换成 `<user>`，都不分大小写。
 * 家目录认四种写法：反斜杠、正斜杠、JSON 转义的双反斜杠、百分号编码（ESM 栈里的 `file:///C:/Users/Zhang%20San/...`）。
 */
export function createRedactor({ home, user }: RedactContext): (text: string) => string {
  const slashed = home.replaceAll("\\", "/");
  const homeForms = [...new Set([home, slashed, home.replaceAll("\\", "\\\\"), encodeURI(slashed)])].filter(
    (form) => form.length > 0,
  );
  const homePattern = homeForms.length > 0 ? new RegExp(homeForms.map(escapeRegExp).join("|"), "gi") : null;
  // 太短的 ASCII 用户名（如 "a"）会误伤普通单词，只换路径里的；非 ASCII 的（如两个字的中文名）不会误伤，照换。
  const userForms = [...new Set([user, encodeURIComponent(user)])];
  const userPattern =
    user.length >= 3 || /[^ -~]/.test(user)
      ? new RegExp(`(?<![A-Za-z0-9])(?:${userForms.map(escapeRegExp).join("|")})(?![A-Za-z0-9])`, "gi")
      : null;
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

interface PendingBatch {
  day: string;
  text: string;
}

export class Logger {
  readonly dir: string;
  #redact: (text: string) => string;
  #now: () => Date;
  #mirror: boolean;
  #day = "";
  /** 还没开始写的行，按日期分批（跨零点时最后一批换文件）。 */
  #queue: PendingBatch[] = [];
  #draining: Promise<void> | null = null;

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
    const last = this.#queue.at(-1);
    if (last?.day === day) last.text += line;
    else this.#queue.push({ day, text: line });
    this.#draining ??= this.#drain();
  }

  /** 等队列里的行全部写完（退出前调用）。 */
  async flush(): Promise<void> {
    while (this.#draining) await this.#draining;
  }

  /** 进程马上要退出、等不了异步写时：同步写掉还没开始写的行（在途的那一批由它自己写完或丢失）。 */
  flushSync(): void {
    for (let batch = this.#queue.shift(); batch; batch = this.#queue.shift()) {
      try {
        this.#openDay(batch.day);
        appendFileSync(this.#file(batch.day), batch.text, "utf8");
      } catch (error) {
        console.error("failed to write log", error);
      }
    }
  }

  async #drain(): Promise<void> {
    // 先让出一次：同一段同步代码里接连写的行并成一批；也保证 #draining 在这里置空之前已经赋值。
    await Promise.resolve();
    for (let batch = this.#queue.shift(); batch; batch = this.#queue.shift()) {
      try {
        this.#openDay(batch.day);
        await appendFile(this.#file(batch.day), batch.text, "utf8");
      } catch (error) {
        // 写日志失败不能让应用跟着失败；打到控制台，开发时能看见。
        console.error("failed to write log", error);
      }
    }
    this.#draining = null;
  }

  #file(day: string): string {
    return path.join(this.dir, `main-${day}.log`);
  }

  /** 一天第一次写：建目录、删过期文件（每天一次，同步做）。 */
  #openDay(day: string): void {
    if (day === this.#day) return;
    mkdirSync(this.dir, { recursive: true });
    // 先记下日期：清理旧文件失败（被占用）时这一天不再反复重试，日志照写。
    this.#day = day;
    this.#prune(day);
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
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
      .map((name) => path.join(this.dir, name));
  }

  #prune(today: string): void {
    const [year, month, date] = today.split("-").map(Number);
    const cutoff = new Date(year!, month! - 1, date! - (RETAIN_DAYS - 1));
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

/** 等日志全部写盘（退出流程的最后一步）。 */
export function flushLog(): Promise<void> {
  return current?.flush() ?? Promise.resolve();
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
