// 会话文件里助手回复的 ```svg 源码，按签名（shared/tsp/figures.ts）索引：TSP 里 omp 只发它栅格化好的 PNG，
// 渲染进程拿签名来要源码，自己按 studio 的主题画。只读会话文件。
import { figureSignature, splitSvgFences } from "../../shared/tsp/figures.ts";
import { isRecord } from "../../shared/type-guards.ts";
import type { SessionEntryConsumer, SessionFileEntry } from "./session-file-reader.ts";

/** 同一个签名对应不同的图（两条回复文字一样、图不一样）：分不清是哪条，不给。 */
const AMBIGUOUS = null;

export class SessionFigureIndex implements SessionEntryConsumer {
  #bySignature = new Map<string, readonly string[] | typeof AMBIGUOUS>();

  entry(entry: SessionFileEntry): void {
    if (entry["type"] !== "message" || !isRecord(entry["message"])) return;
    const message = entry["message"];
    if (message["role"] !== "assistant" || !Array.isArray(message["content"])) return;
    for (const block of message["content"]) {
      if (!isRecord(block) || block["type"] !== "text" || typeof block["text"] !== "string") continue;
      if (!block["text"].includes("```svg") && !block["text"].includes("~~~svg")) continue;
      const { segments, svgs } = splitSvgFences(block["text"]);
      if (svgs.length === 0) continue;
      const signature = figureSignature(segments);
      const previous = this.#bySignature.get(signature);
      if (previous === undefined) this.#bySignature.set(signature, svgs);
      else if (previous !== AMBIGUOUS && previous.join("\u0000") !== svgs.join("\u0000"))
        this.#bySignature.set(signature, AMBIGUOUS);
    }
  }

  reset(): void {
    this.#bySignature.clear();
  }

  /** 这段文字里的 svg 源码（按出现顺序）；会话文件里没有、或对应了不同的图时为 null。 */
  find(signature: string): readonly string[] | null {
    return this.#bySignature.get(signature) ?? null;
  }
}
