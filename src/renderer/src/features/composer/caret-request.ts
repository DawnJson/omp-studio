// 程序改了草稿文字（粘贴折叠、插入图片、删芯片）之后光标该落在哪：调用方登记（文字里的偏移），输入框在下一次布局里取走。
const requests = new Map<string, number>();

export function requestCaret(draftKey: string, textOffset: number): void {
  requests.set(draftKey, textOffset);
}

export function takeCaretRequest(draftKey: string): number | null {
  const offset = requests.get(draftKey) ?? null;
  requests.delete(draftKey);
  return offset;
}
