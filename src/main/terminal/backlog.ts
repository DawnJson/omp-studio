// 终端输出的有界回放缓冲：面板隐藏或渲染进程重载后重新打开时，用它还原屏幕。
// 只留最近 capChars 个字符。为了不在每次追加时都复制整段，超过 2 倍上限才裁剪，读取时再收紧到上限。

/** 裁剪点后面找换行的范围：从行首开始回放，避免把一个转义序列从中间切开后在屏幕上留下乱码。 */
const LINE_START_SEARCH = 2048;

export class Backlog {
  readonly #cap: number;
  #text = "";

  constructor(capChars: number) {
    this.#cap = capChars;
  }

  append(data: string): void {
    this.#text += data;
    if (this.#text.length > this.#cap * 2) this.#text = this.#trimmed();
  }

  snapshot(): string {
    return this.#text.length > this.#cap ? this.#trimmed() : this.#text;
  }

  #trimmed(): string {
    let start = this.#text.length - this.#cap;
    const newline = this.#text.indexOf("\n", start);
    if (newline !== -1 && newline - start < LINE_START_SEARCH) {
      start = newline + 1;
    } else {
      // 找不到换行：至少别从代理对中间切开。
      const code = this.#text.charCodeAt(start);
      if (code >= 0xdc00 && code <= 0xdfff) start += 1;
    }
    return this.#text.slice(start);
  }
}
