// 导出 HTML 对话框里的默认文件名：`<任务标题>-<日期>.html`。标题是用户或模型写的任意文本，要变成各平台都合法的文件名。

const FALLBACK = "omp-session";
const MAX_TITLE_CHARS = 80;
const ILLEGAL = '<>:"/\\|?*';
/** Windows 保留设备名（不分大小写、带不带扩展名都不能当文件名）。 */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** 把任务标题变成文件名主干：去掉路径分隔符和 Windows 非法字符、控制字符，折叠空白，去首尾的点和空格，限长；剩不下东西时用 `omp-session`。 */
export function sanitizeFileStem(title: string): string {
  const cleaned = [...title]
    .map((char) => (char.charCodeAt(0) < 0x20 || char === "\u007f" || ILLEGAL.includes(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  // 按码点截断，不把代理对劈开；截断后可能又露出结尾空白或点。
  const stem = [...cleaned]
    .slice(0, MAX_TITLE_CHARS)
    .join("")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (stem === "") return FALLBACK;
  return RESERVED.test(stem) ? `${stem}_` : stem;
}

function localDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `<标题>-<本地日期>.html`。 */
export function exportFileName(title: string, now: Date): string {
  return `${sanitizeFileStem(title)}-${localDay(now)}.html`;
}
