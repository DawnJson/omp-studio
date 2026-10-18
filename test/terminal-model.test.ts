import { describe, expect, it } from "vitest";
import {
  buildTerminalPalette,
  chunkInput,
  clampTerminalHeight,
  cwdLabel,
  luminance,
  parseColor,
  type PaletteToken,
} from "../src/shared/ui/terminal-model.ts";

describe("clampTerminalHeight", () => {
  it("夹在 120 和主区 70% 之间", () => {
    expect(clampTerminalHeight(50, 1000)).toBe(120);
    expect(clampTerminalHeight(5000, 1000)).toBe(700);
    expect(clampTerminalHeight(300, 1000)).toBe(300);
  });
  it("主区很矮时最小值优先", () => {
    expect(clampTerminalHeight(300, 100)).toBe(120);
  });
});

describe("chunkInput", () => {
  it("按上限分段，拼回原文", () => {
    const chunks = chunkInput("abcdefghij", 4);
    expect(chunks).toEqual(["abcd", "efgh", "ij"]);
  });
  it("不切开代理对", () => {
    const chunks = chunkInput("ab😀cd", 3);
    expect(chunks.join("")).toBe("ab😀cd");
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(3);
    expect(chunks[0]).toBe("ab");
  });
  it("空串没有分段", () => {
    expect(chunkInput("", 4)).toEqual([]);
  });
});

describe("cwdLabel", () => {
  it("取最后一段，两种分隔符都认", () => {
    expect(cwdLabel("C:\\Users\\me\\项目 目录")).toBe("项目 目录");
    expect(cwdLabel("/home/me/proj/")).toBe("proj");
    expect(cwdLabel("C:\\")).toBe("C:");
    expect(cwdLabel("/")).toBe("/");
  });
});

describe("终端配色", () => {
  it("解析 hex / rgb / rgba", () => {
    expect(parseColor("#0b7a66")).toEqual({ r: 11, g: 122, b: 102, a: 1 });
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.2)")).toEqual({ r: 1, g: 2, b: 3, a: 0.2 });
    expect(parseColor("color(srgb 1 0 0)")).toBeNull();
  });

  const light: Record<PaletteToken, string> = {
    "--bg-sunken": "#f1f4f3",
    "--text": "#111816",
    "--text-2": "#4b5652",
    "--text-3": "#5f6a66",
    "--accent": "#0b7a66",
    "--selection-bg": "rgba(11, 122, 102, 0.2)",
    "--st-error": "#b42e2e",
    "--st-waiting-text": "#8e5a00",
    "--syn-string": "#2f7d3e",
    "--syn-func": "#2557c7",
    "--syn-keyword": "#6d3fd0",
    "--syn-type": "#0f7c80",
  };
  const dark: Record<PaletteToken, string> = {
    ...light,
    "--bg-sunken": "#0e1211",
    "--text": "#e6ecea",
    "--text-2": "#a3afab",
    "--text-3": "#7f8b87",
    "--accent": "#3fcbae",
    "--st-error": "#f27373",
    "--st-waiting-text": "#f0b545",
    "--syn-string": "#9bd39b",
    "--syn-func": "#8fb8ff",
    "--syn-keyword": "#c4a7ff",
    "--syn-type": "#7fd1d1",
  };

  const contrast = (a: string, b: string) => {
    const la = luminance(parseColor(a)!);
    const lb = luminance(parseColor(b)!);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  it("深浅两套里除黑色外的前景色在底色上都有足够对比度", () => {
    for (const tokens of [light, dark]) {
      const palette = buildTerminalPalette((token) => tokens[token]);
      for (const name of [
        "foreground",
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
        "white",
        "brightBlack",
      ] as const) {
        expect(contrast(palette[name], palette.background), name).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("黑色两端随主题翻转：浅色里黑是深色字，深色里黑是比底色略亮的灰", () => {
    const l = buildTerminalPalette((token) => light[token]);
    const d = buildTerminalPalette((token) => dark[token]);
    expect(luminance(parseColor(l.black)!)).toBeLessThan(0.1);
    expect(luminance(parseColor(d.black)!)).toBeGreaterThan(luminance(parseColor(d.background)!));
  });

  it("读不出来的 token 用中性灰，不抛错", () => {
    const palette = buildTerminalPalette(() => "not-a-color");
    expect(palette.red).toBe("rgb(128, 128, 128)");
  });
});
