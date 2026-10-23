// OSC 7：omp 在启动和 `/move`、`/wt` 换了会话目录之后发 `ESC ] 7 ; file://<主机名><pathToFileURL(cwd).pathname> BEL`
// （title-generator.ts；真实 omp 18.12.6 实测：Windows 上是 `file://DESKTOP-X/C:/Users/me/omp%20work/%E7%9B%AE%E5%BD%95%20two`，
// 空格和中文都按 UTF-8 百分号编码，盘符前有一个 `/`）。纯函数：URI → 本机路径；认不出为 null。

/** `file://host/path` → 本机绝对路径。win32：`/C:/a%20b` → `C:\a b`；没有盘符且主机名不是本机的当成 UNC（`\\host\path`）。 */
export function cwdFromFileUri(uri: string, platform: string): string | null {
  const match = /^file:\/\/([^/]*)(\/.*)$/.exec(uri);
  if (!match) return null;
  const host = match[1] as string;
  let pathname: string;
  try {
    pathname = decodeURIComponent(match[2] as string);
  } catch {
    return null;
  }
  if (platform !== "win32") return pathname;
  if (/^\/[A-Za-z]:/.test(pathname)) return pathname.slice(1).replaceAll("/", "\\");
  const rooted = pathname.replaceAll("/", "\\");
  return host === "" || host.toLowerCase() === "localhost" ? rooted : `\\\\${host}${rooted}`;
}
