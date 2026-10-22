// 会话开关类斜杠命令的参数判定（纯函数）：不带参数 / status → 打开菜单，带 on / off 等 → 直接执行。
// 发出去的永远是封闭的 TaskCommand，不把用户写的文字原样交给 omp。
import type { TaskCommand } from "../../../../shared/omp-output/index.ts";
import { presetNameUsable, presetRefUsable } from "../../../../shared/omp-output/toggles.ts";

export type ToggleSlashName =
  "skillful" | "extended-context" | "computer" | "advisor" | "browser" | "prewalk" | "modelpreset";

export type ToggleSlash =
  /** 打开会话开关菜单。 */
  | { kind: "menu" }
  /** `/computer on`：先确认再执行。 */
  | { kind: "confirmComputer" }
  | { kind: "run"; command: TaskCommand }
  /** `/modelpreset`、`/modelpreset list`、`/prewalk`：预设和 Prewalk 在模型选择器里。 */
  | { kind: "models" }
  /** 参数不认识：用法提示。 */
  | { kind: "usage"; usage: string };

const onOffNames = {
  skillful: "skillful",
  "extended-context": "extendedContext",
  computer: "computer",
  advisor: "advisor",
} as const;

export function resolveToggleSlash(name: ToggleSlashName, args: string): ToggleSlash {
  const words = args.trim() === "" ? [] : args.trim().split(/\s+/);
  const first = words[0]?.toLowerCase() ?? "";
  switch (name) {
    case "skillful":
    case "extended-context":
    case "computer":
    case "advisor": {
      const usage = `/${name} [on|off]`;
      if (words.length === 0 || (words.length === 1 && first === "status")) return { kind: "menu" };
      if (words.length !== 1 || (first !== "on" && first !== "off")) return { kind: "usage", usage };
      const on = first === "on";
      if (name === "computer" && on) return { kind: "confirmComputer" };
      return { kind: "run", command: { kind: "toggle", name: onOffNames[name], on } };
    }
    case "browser": {
      if (words.length === 0 || (words.length === 1 && first === "status")) return { kind: "menu" };
      if (words.length === 1 && (first === "visible" || first === "headless"))
        return { kind: "run", command: { kind: "browserMode", mode: first } };
      return { kind: "usage", usage: "/browser [visible|headless]" };
    }
    case "prewalk": {
      // Prewalk 在模型选择器里（能看到会从哪个模型换到哪个）。
      if (words.length === 0 || (words.length === 1 && first === "status")) return { kind: "models" };
      if (words.length === 1 && (first === "restart" || first === "off"))
        return { kind: "run", command: { kind: "prewalk", op: first } };
      return { kind: "usage", usage: "/prewalk [restart|off]" };
    }
    case "modelpreset": {
      if (words.length === 0 || (words.length === 1 && first === "list")) return { kind: "models" };
      const op = first === "save" || first === "switch" || first === "delete" ? first : null;
      // switch / delete 的名字可以含空格（omp 把后面的词用单个空格拼回去）；save 只收一个规范名字。
      const presetName = op === "save" ? words[1] : words.slice(1).join(" ");
      if (
        op !== null &&
        presetName !== undefined &&
        (op === "save"
          ? words.length === 2 && presetNameUsable(presetName)
          : words.length >= 2 && presetRefUsable(presetName))
      )
        return { kind: "run", command: { kind: "modelPreset", op, name: presetName } };
      return { kind: "usage", usage: "/modelpreset [list|save <name>|switch <name>|delete <name>]" };
    }
  }
}
