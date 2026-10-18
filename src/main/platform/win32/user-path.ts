// 读写当前用户的 PATH（HKCU\Environment\Path）并广播 WM_SETTINGCHANGE。设计见 docs/architecture/omp-install.md "写入用户 PATH"。
// 不用 reg.exe / setx / PowerShell：setx 会展开 %VAR% 并丢掉 REG_EXPAND_SZ，PowerShell 是 shell。
// 只做一种变换：去掉已有的同一目录，再把它放到最前面；值的类型照原样写回。
import { loadWin32, win32Constants } from "./ffi.ts";

export interface UserPathOptions {
  /** HKCU 下的子键，默认 `Environment`。测试用临时子键，不碰真实用户 PATH。 */
  subKey?: string;
  /** 值名，默认 `Path`。 */
  valueName?: string;
}

export interface UserPathValue {
  /** 注册表里的原始字符串（`%VAR%` 未展开）；没有这个值时为 null。 */
  raw: string | null;
  type: number;
}

const {
  HKEY_CURRENT_USER,
  KEY_QUERY_VALUE,
  KEY_SET_VALUE,
  KEY_CREATE_SUB_KEY,
  REG_SZ,
  REG_EXPAND_SZ,
  ERROR_SUCCESS,
  ERROR_FILE_NOT_FOUND,
} = win32Constants;

/** 展开 `%VAR%`，变量名不区分大小写（Windows）；没有定义的变量原样保留，和系统一致。 */
function expandVariables(text: string): string {
  return text.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(process.env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
    return (key && process.env[key]) || whole;
  });
}

/** 比较目录用的规范形式：展开变量、去引号和尾部分隔符、不区分大小写。 */
function normalizeDir(dir: string): string {
  return expandVariables(dir.trim().replace(/^"(.*)"$/, "$1"))
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function splitEntries(raw: string): string[] {
  return raw.split(";").filter((entry) => entry.trim() !== "");
}

export function pathContains(raw: string | null, dir: string): boolean {
  const wanted = normalizeDir(dir);
  return splitEntries(raw ?? "").some((entry) => normalizeDir(entry) === wanted);
}

export function pathStartsWith(raw: string | null, dir: string): boolean {
  const first = splitEntries(raw ?? "")[0];
  return first !== undefined && normalizeDir(first) === normalizeDir(dir);
}

/** 把 dir 放到最前面，去掉已有的同一目录；其余条目逐字保留（包括 `%VAR%`）。空条目会被丢掉。 */
export function prependToPath(raw: string | null, dir: string): string {
  const wanted = normalizeDir(dir);
  return [dir, ...splitEntries(raw ?? "").filter((entry) => normalizeDir(entry) !== wanted)].join(";");
}

function decode(data: Buffer): string {
  return data.toString("utf16le").replace(/\0+$/, "");
}

function encode(text: string): Buffer {
  return Buffer.from(text + "\0", "utf16le");
}

export function readUserPath(options: UserPathOptions = {}): UserPathValue {
  const { advapi32 } = loadWin32();
  const { status, key } = advapi32.RegOpenKeyExW(HKEY_CURRENT_USER, options.subKey ?? "Environment", KEY_QUERY_VALUE);
  if (status === ERROR_FILE_NOT_FOUND) return { raw: null, type: REG_EXPAND_SZ };
  if (status !== ERROR_SUCCESS) throw new Error(`RegOpenKeyExW failed (${status})`);
  try {
    const value = advapi32.RegQueryValueExW(key, options.valueName ?? "Path");
    if (value.status === ERROR_FILE_NOT_FOUND) return { raw: null, type: REG_EXPAND_SZ };
    if (value.status !== ERROR_SUCCESS || value.data === null)
      throw new Error(`RegQueryValueExW failed (${value.status})`);
    return { raw: decode(value.data), type: value.type };
  } finally {
    advapi32.RegCloseKey(key);
  }
}

export interface AddToUserPathResult {
  /** false = 已经在最前面，没有写也没有广播。 */
  changed: boolean;
  /** 写之前的原始值，调用方可以备份；原来没有这个值时为 null。 */
  previous: string | null;
  /** 广播 WM_SETTINGCHANGE 是否成功；超时不算写入失败。 */
  broadcast: Promise<boolean>;
}

/**
 * 把 dir 放到用户 PATH 最前面，原值类型照旧（原来没有就用 REG_EXPAND_SZ）。
 * `onBeforeWrite` 在真正写之前拿到原值，用来备份（写坏用户 PATH 的风险对策）。
 */
export function addToUserPath(
  dir: string,
  options: UserPathOptions & { onBeforeWrite?: (previous: string | null) => void } = {},
): AddToUserPathResult {
  const current = readUserPath(options);
  if (pathStartsWith(current.raw, dir))
    return { changed: false, previous: current.raw, broadcast: Promise.resolve(true) };
  options.onBeforeWrite?.(current.raw);
  const type =
    current.raw === null || (current.type !== REG_SZ && current.type !== REG_EXPAND_SZ) ? REG_EXPAND_SZ : current.type;
  const { advapi32, user32 } = loadWin32();
  const opened = advapi32.RegCreateKeyExW(
    HKEY_CURRENT_USER,
    options.subKey ?? "Environment",
    KEY_QUERY_VALUE | KEY_SET_VALUE | KEY_CREATE_SUB_KEY,
  );
  if (opened.status !== ERROR_SUCCESS) throw new Error(`RegCreateKeyExW failed (${opened.status})`);
  try {
    const status = advapi32.RegSetValueExW(
      opened.key,
      options.valueName ?? "Path",
      type,
      encode(prependToPath(current.raw, dir)),
    );
    if (status !== ERROR_SUCCESS) throw new Error(`RegSetValueExW failed (${status})`);
  } finally {
    advapi32.RegCloseKey(opened.key);
  }
  // 广播不阻塞主线程；结果只用来在需要时告诉用户"已打开的终端要重开"，失败不影响已写入的 PATH。
  const broadcast = user32.broadcastSettingChangeAsync("Environment", 5000).then(
    (result) => result !== 0,
    () => false,
  );
  return { changed: true, previous: current.raw, broadcast };
}
