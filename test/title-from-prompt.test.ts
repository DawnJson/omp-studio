import { describe, expect, it } from "vitest";
import { titleFromPrompt } from "../src/main/tasks/convert.ts";

describe("titleFromPrompt", () => {
  it("超过 60 个字符：截断处有省略号，看得出被截过（不是半截 [Ima）", () => {
    const title = titleFromPrompt(`${"Describe the color of this image in one short sentence."} [Image #1]`);
    expect(Array.from(title)).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("60 个字符以内原样保留；只取第一行非空行", () => {
    expect(titleFromPrompt("\n  修一下登录页  \n第二行")).toBe("修一下登录页");
  });
});
