// 带图片的一句话：用 omp 自己的"粘贴图片路径"附件（和 Tern 一样，消息里是 omp 的 `#N` 图片占位、用户气泡里是图片），
// 不再在文字后面加 `@"路径"` 提及（那样 omp 用 read 工具读图，对话里多出 "Read <路径> (image)" 行）。
// omp 18.12.6 实测（fixtures/tsp/image-attach.jsonl，docs/architecture/composer-attachments.md「发图片」）：
// - 往 pty 写一次括号粘贴，内容是带引号的绝对路径，omp 读文件、挂成待发送图片：输入框上方出现 `omp.composer.chip`
//   （里面一个 `image` 节点，blob 当场用 `b` 发来），光标处插入占位（图标 + ` #N `）；文件不存在时只弹一条状态 toast "Image not found at …"。
// - `send` 事件会先清空草稿（含待发送图片）再提交，图片丢掉；`action submit` 提交输入框里现有的草稿，图片保留。
//   所以草稿在 omp 的输入框里按顺序重建：文字段用 `edit` 追加到末尾，图片在它在文字里的位置粘贴，最后 `action submit`；
//   运行中同样是插话，`/queue <文字>` 同样排队、图片跟着走；只有图片没有文字也能提交。
import type { TspDocument } from "./document.ts";
import { findNode, nodeRole } from "./document.ts";
import type { TspComposerEditor } from "./session-tree.ts";
import type { TspEvent } from "./tsp.generated.ts";

const CHIP_ROLE = "omp.composer.chip";
/** studio 输入框发出的图片占位符（composer-tokens.ts 的 `[Image #N, WxH]`，队列撤回的没有尺寸）。 */
const IMAGE_MARKER = /\[Image #([1-9]\d*)(?:,[^\]\n]*)?\]/g;

export type ImagePastePart = { kind: "text"; text: string } | { kind: "image"; index: number };

/**
 * 发出去的文字（图片占位符 `[Image #N, …]` 的 N 是第几张图）拆成在 omp 输入框里依次做的几步：文字段、第几张图。
 * omp 的占位自带一个尾随空格，所以图片后面那段文字开头的一个空格去掉；编号超出图片数的占位符原样当文字；
 * 文字没引用到的图片接在最后。
 */
export function imagePasteParts(text: string, imageCount: number): ImagePastePart[] {
  const parts: ImagePastePart[] = [];
  const referenced = new Set<number>();
  const pushText = (chunk: string): void => {
    const trimmed = parts.at(-1)?.kind === "image" && chunk.startsWith(" ") ? chunk.slice(1) : chunk;
    if (trimmed !== "") parts.push({ kind: "text", text: trimmed });
  };
  let cursor = 0;
  for (const match of text.matchAll(IMAGE_MARKER)) {
    const index = Number(match[1]) - 1;
    if (index >= imageCount) continue;
    pushText(text.slice(cursor, match.index));
    parts.push({ kind: "image", index });
    referenced.add(index);
    cursor = match.index + match[0].length;
  }
  pushText(text.slice(cursor));
  for (let index = 0; index < imageCount; index += 1) {
    if (!referenced.has(index)) parts.push({ kind: "image", index });
  }
  return parts;
}

/** 在 omp 输入框末尾追加 `text` 的 `edit` 事件（光标停在末尾，下一张图粘贴在那里）。 */
export function appendEditorEvent(editor: TspComposerEditor, text: string): TspEvent {
  const len = editor.text.length;
  return { ev: "edit", sf: editor.sf, id: editor.id, from: len, to: len, text, cursor: len + text.length, len };
}

/** 往 pty 写的括号粘贴：路径加双引号（可能带空格），用正斜杠：omp 把反斜杠当转义，`\(` 这类会丢掉反斜杠（实测）。 */
export function imagePasteKeys(file: string): string {
  return `\x1b[200~"${file.replaceAll("\\", "/")}"\x1b[201~`;
}

/** omp 输入框上方挂着的待发送图片数（dock 里带 `image` 子节点的 `omp.composer.chip`）。 */
export function pendingImageCount(doc: TspDocument): number {
  let count = 0;
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    for (const node of surface.nodes.values()) {
      if (nodeRole(node) === CHIP_ROLE && findNode(surface, (child) => child.k === "image", node.id) !== null)
        count += 1;
    }
  }
  return count;
}
