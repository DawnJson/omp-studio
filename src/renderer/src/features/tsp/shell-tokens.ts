// tool 头里 `targetKind: "command"` 的一行 shell 命令：切成 程序词 / 选项 / 字符串 / 变量 / 运算符 / 普通文字（纯函数）。
// 不是完整的 shell 解析，只为着色；规范（Work/tool Target）列的就是这几类。

export type ShellTokenKind = "cmd" | "flag" | "str" | "var" | "op" | "text";

export interface ShellToken {
  kind: ShellTokenKind;
  text: string;
}

const TOKEN =
  /(\s+)|('(?:[^']*)'?|"(?:\\.|[^"\\])*"?)|(\$\{[^}]*\}?|\$[A-Za-z_][A-Za-z0-9_]*|\$[?!#@*$0-9])|(\|\||&&|;;|\d?>>?(?:&\d)?|<<?|[|;&<>()])|(--?[A-Za-z0-9][\w-]*(?:=\S*)?)|([^\s'"$|;&<>()]+)/y;

export function tokenizeCommand(source: string): ShellToken[] {
  const out: ShellToken[] = [];
  // 每个管道段 / 命令的第一个词是程序词。
  let expectCommand = true;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) {
      out.push({ kind: "text", text: source.slice(at) });
      break;
    }
    const [text, space, str, variable, op, flag, word] = match;
    if (space !== undefined) out.push({ kind: "text", text: space });
    else if (str !== undefined) {
      out.push({ kind: "str", text: str });
      expectCommand = false;
    } else if (variable !== undefined) {
      out.push({ kind: "var", text: variable });
      expectCommand = false;
    } else if (op !== undefined) {
      out.push({ kind: "op", text: op });
      expectCommand = /^(\|\||&&|;;|;|\||&|\()$/.test(op);
    } else if (flag !== undefined && !expectCommand) {
      out.push({ kind: "flag", text: flag });
    } else if (word !== undefined || flag !== undefined) {
      const w = word ?? flag ?? text ?? "";
      // VAR=value 这样的前置赋值不算程序词。
      const assignment = expectCommand && /^[A-Za-z_]\w*=/.test(w);
      out.push({ kind: expectCommand && !assignment ? "cmd" : "text", text: w });
      if (!assignment) expectCommand = false;
    }
  }
  return out;
}
