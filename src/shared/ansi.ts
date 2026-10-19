// 去掉终端转义序列（颜色、光标、OSC 标题/超链接）。omp 的斜杠命令输出和 `omp config` 文本都带 ANSI，进界面前要先清掉。
// 只放纯函数：不碰 Node/DOM。
// eslint-disable-next-line no-control-regex
const ansi = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ansi, "");
}
