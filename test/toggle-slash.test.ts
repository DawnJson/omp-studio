// 会话开关类斜杠命令：不带参数 / status 打开菜单，带参数直接执行；发出去的永远是封闭的 TaskCommand，文字由 taskCommandText 拼。
import { describe, expect, it } from "vitest";
import { parseTaskCommand, taskCommandText } from "../src/shared/omp-output/index.ts";
import { resolveToggleSlash } from "../src/renderer/src/features/session-toggles/toggle-slash.ts";

function text(name: Parameters<typeof resolveToggleSlash>[0], args: string): string | null {
  const resolved = resolveToggleSlash(name, args);
  return resolved.kind === "run" ? taskCommandText(parseTaskCommand(resolved.command)) : null;
}

describe("resolveToggleSlash", () => {
  it.each(["skillful", "extended-context", "computer", "advisor"] as const)(
    "/%s：无参数和 status 开菜单，on / off 执行",
    (name) => {
      expect(resolveToggleSlash(name, "")).toEqual({ kind: "menu" });
      expect(resolveToggleSlash(name, "status")).toEqual({ kind: "menu" });
      if (name !== "computer") {
        expect(text(name, "on")).toBe(`/${name} on`);
        expect(text(name, "OFF")).toBe(`/${name} off`);
      }
      expect(resolveToggleSlash(name, "maybe")).toEqual({ kind: "usage", usage: `/${name} [on|off]` });
      expect(resolveToggleSlash(name, "on now")).toMatchObject({ kind: "usage" });
    },
  );

  it("/computer on 先确认（owner 决定）；/computer off 直接执行", () => {
    expect(resolveToggleSlash("computer", "on")).toEqual({ kind: "confirmComputer" });
    expect(text("computer", "off")).toBe("/computer off");
  });

  it("/browser、/prewalk", () => {
    expect(resolveToggleSlash("browser", "")).toEqual({ kind: "menu" });
    expect(text("browser", "headless")).toBe("/browser headless");
    expect(text("browser", "visible")).toBe("/browser visible");
    expect(resolveToggleSlash("browser", "fullscreen")).toMatchObject({ kind: "usage" });
    expect(resolveToggleSlash("prewalk", "")).toEqual({ kind: "menu" });
    expect(text("prewalk", "restart")).toBe("/prewalk restart");
    expect(text("prewalk", "off")).toBe("/prewalk off");
    expect(resolveToggleSlash("prewalk", "on")).toMatchObject({ kind: "usage" });
  });

  it("/modelpreset：无参数和 list 开模型选择器；save / switch / delete 带一个可用的名字", () => {
    expect(resolveToggleSlash("modelpreset", "")).toEqual({ kind: "models" });
    expect(resolveToggleSlash("modelpreset", "list")).toEqual({ kind: "models" });
    expect(text("modelpreset", "save cheap")).toBe("/modelpreset save cheap");
    expect(text("modelpreset", "switch deep-1")).toBe("/modelpreset switch deep-1");
    expect(text("modelpreset", "delete old")).toBe("/modelpreset delete old");
    expect(text("modelpreset", "switch my preset")).toBe("/modelpreset switch my preset");
    expect(text("modelpreset", "delete my   preset")).toBe("/modelpreset delete my preset");
    expect(resolveToggleSlash("modelpreset", "save")).toMatchObject({ kind: "usage" });
    expect(resolveToggleSlash("modelpreset", "save two words")).toMatchObject({ kind: "usage" });
    expect(resolveToggleSlash("modelpreset", "save bad/name")).toMatchObject({ kind: "usage" });
  });
});
