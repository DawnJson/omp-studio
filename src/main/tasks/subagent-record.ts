// 一个子代理的完整记录缓存：get_subagent_messages 按字节续读（fromByte），已读的部分留在主进程，
// 运行中的子代理每次刷新只读新增的字节；渲染进程再按绝对序号只取它还没有的条目（SubagentDetail.from）。
import { trimSubagentMessages } from "./subagent-tracker.ts";

/** get_subagent_messages 一页之内读不完时最多续读的页数。 */
const MAX_PAGES = 200;

export interface RecordPage<T> {
  messages: T[];
  nextByte: number;
  /** fromByte 超过了文件大小，从头读了。 */
  reset: boolean;
}

export interface RecordSlice<T> {
  messages: T[];
  from: number;
  total: number;
  truncated: boolean;
}

export class SubagentRecord<T> {
  #messages: T[] = [];
  /** 被丢掉的最早条数（保留上限），绝对序号 = dropped + 数组下标。 */
  #dropped = 0;
  #nextByte = 0;

  /** 读到文件末尾。fetch 的 fromByte 在第一次读（还没有缓存）时是 undefined。 */
  async refresh(fetchPage: (fromByte: number | undefined) => Promise<RecordPage<T>>): Promise<void> {
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = this.#nextByte;
      const result = await fetchPage(from > 0 ? from : undefined);
      if (result.reset) {
        this.#messages = [];
        this.#dropped = 0;
      }
      this.#messages.push(...result.messages);
      this.#nextByte = result.nextByte;
      if (!result.reset && result.nextByte <= from) break;
    }
    const trimmed = trimSubagentMessages(this.#messages);
    this.#dropped += this.#messages.length - trimmed.messages.length;
    this.#messages = trimmed.messages;
  }

  /** since = 调用方已有的条数（绝对序号）；它在缓存之后（记录被重置过）或在被丢掉的部分里时，从缓存最早的一条给起。 */
  slice(since: number | undefined): RecordSlice<T> {
    const total = this.#dropped + this.#messages.length;
    const from = since === undefined || since > total ? this.#dropped : Math.max(since, this.#dropped);
    return {
      messages: this.#messages.slice(from - this.#dropped),
      from,
      total,
      truncated: this.#dropped > 0,
    };
  }
}
