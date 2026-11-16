// 复制 / 剪切输入框里带附件的选区：
// - 系统剪贴板放占位符文字，外加 HTML（图片内联成 <img>）；选区里正好一张图片时再放这张图（PNG），别的软件能直接粘出图片。
// - studio 自己记下这次复制的草稿片段（文字 + 引用到的图片、文件、大段粘贴）。粘贴回任一输入框时，剪贴板里的文字还是这次复制的，
//   就把整段连同附件插回去，而不是只插占位符文字（2026-11-15 所有者：输入框有图片时复制不会复制图片）。
import { draftFragment, type Draft, type DraftImage } from "./composer-tokens.ts";

let copied: { plain: string; fragment: Draft } | null = null;

/** Windows 剪贴板里的换行是 \r\n，比较前统一。 */
const sameText = (a: string, b: string) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

/** 剪贴板文字还是上次从输入框复制的那段时，返回那段草稿（含附件）；否则 null。 */
export function copiedFragment(plain: string): Draft | null {
  return copied !== null && sameText(copied.plain, plain) ? copied.fragment : null;
}

const imagePattern = /\[Image #([1-9]\d*)(?:,[^\]\n]*)?\]/g;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function fragmentHtml(fragment: Draft): string {
  let html = "";
  let cursor = 0;
  for (const match of fragment.text.matchAll(imagePattern)) {
    const image = fragment.images[Number(match[1]) - 1];
    if (image === undefined) continue;
    html += escapeHtml(fragment.text.slice(cursor, match.index));
    html += `<img src="data:${image.mimeType};base64,${image.data}">`;
    cursor = match.index + match[0].length;
  }
  html += escapeHtml(fragment.text.slice(cursor));
  return html.replace(/\n/g, "<br>");
}

async function pngBlob(image: DraftImage): Promise<Blob> {
  const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: image.mimeType }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * 记下这次复制，并把带图片的内容写进系统剪贴板（异步，覆盖 copy 事件里同步写的纯文字）。
 * 写失败（极少见）时剪贴板里仍是 copy 事件写的占位符文字，studio 内粘贴照样带附件；失败原因抛给调用方报出来。
 */
export async function rememberCopy(draft: Draft, plain: string): Promise<void> {
  const fragment = draftFragment(draft, plain);
  copied = { plain, fragment };
  if (fragment.images.length === 0) return;
  const parts: Record<string, Blob | Promise<Blob>> = {
    "text/plain": new Blob([plain], { type: "text/plain" }),
    "text/html": new Blob([fragmentHtml(fragment)], { type: "text/html" }),
  };
  if (fragment.images.length === 1) parts["image/png"] = pngBlob(fragment.images[0]!);
  await navigator.clipboard.write([new ClipboardItem(parts)]);
}
