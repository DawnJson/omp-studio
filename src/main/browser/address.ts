// 地址栏的文字 -> 要打开的地址。只放行 http/https；不 import electron。

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** 带空格、或不像主机名（没有点也不是本机）的当搜索词交给 Bing；写了别的协议（file:、javascript: 等）返回 null。 */
export function addressToUrl(text: string): string | null {
  const value = text.trim();
  if (value === "") return null;
  if (!/\s/.test(value)) {
    if (LOCAL_HOST.test(value)) return new URL(`http://${value}`).href;
    // `host:port` 也会被当成协议，先排除它。
    if (SCHEME.test(value) && !/^[^:/]+:\d+(?:[/?#]|$)/.test(value)) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return null;
      }
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    }
    if (/^[^/?#]+\.[^/?#]+/.test(value)) {
      try {
        return new URL(`https://${value}`).href;
      } catch {
        // 不是合法主机名，当搜索词。
      }
    }
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

/** 页面里的跳转（链接、表单、window.open）放行的地址。 */
export function isBrowsableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === "about:blank";
}
