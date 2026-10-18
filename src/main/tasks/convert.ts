// wire 类型 ↔ ipc.ts 契约类型的小转换。
import type { ModelOption, PromptImage, RestoredDraft } from "../../shared/ipc.ts";
import type { AgentMessage, ImageContent, ModelInfo, RestoredQueuedMessage } from "../../shared/omp-wire/rpc-wire.generated.ts";

export function toModelOption(info: ModelInfo): ModelOption {
  return {
    key: { provider: info.provider, modelId: info.id },
    name: info.name,
    contextWindow: info.contextWindow,
    reasoning: info.reasoning,
    acceptsImages: info.input.includes("image"),
  };
}

const imageMimeTypes: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** 只保留契约认的四种图片；omp 给的其它类型（理论上不会有）丢掉，不假装转换。 */
export function toPromptImages(images: ImageContent[] | undefined): PromptImage[] | undefined {
  const kept = (images ?? []).flatMap((image) => (imageMimeTypes.includes(image.mimeType) ? [{ mimeType: image.mimeType as PromptImage["mimeType"], data: image.data }] : []));
  return kept.length > 0 ? kept : undefined;
}

export function toRestoredDraft(message: RestoredQueuedMessage): RestoredDraft {
  const images = toPromptImages(message.images);
  return images ? { text: message.text, images } : { text: message.text };
}

/** 会话标题：首条用户消息的第一行，截到 60 个字符。 */
export function titleFromPrompt(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  return Array.from(firstLine.trim()).slice(0, 60).join("");
}

/** 历史里第一条用户消息的文本（字符串或文本块拼接）；没有返回空串。 */
export function firstUserText(messages: AgentMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  }
  return "";
}
