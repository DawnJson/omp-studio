// 宠物的帽子（稀有度决定能戴哪些，shared/pet/model.ts 的 hatMinRarity）：像素画，戴在头顶正中。
// 字符同 sprites.ts：'.' 透明，其余按 palette 上色。lift = 帽子底边离头顶多高（光环浮在头上，其余压住头顶那行轮廓）。
import type { Hat } from "../../../shared/pet/model.ts";

export interface HatDef {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
  lift: number;
}

export const hatSprites: Readonly<Record<Exclude<Hat, "none">, HatDef>> = {
  crown: {
    rows: ["o..o.o..o", "oaoaoaoao", "oaaabaaao", "ooooooooo"],
    palette: { o: "#6b4500", a: "#ffd23f", b: "#e8443a" },
    lift: 0,
  },
  tophat: {
    rows: ["..ooooo..", "..oaaao..", "..oaaao..", "..obbbo..", "ooooooooo"],
    palette: { o: "#111114", a: "#2e2e38", b: "#c0392b" },
    lift: 0,
  },
  propeller: {
    rows: ["aaaobbb", "...o...", ".ocdco.", "occccco"],
    palette: { o: "#2a2a2a", a: "#e74c3c", b: "#3498db", c: "#f1c40f", d: "#2ecc71" },
    lift: 0,
  },
  halo: {
    rows: [".ooooo.", "o.....o", ".ooooo."],
    palette: { o: "#ffe066" },
    lift: 2,
  },
  wizard: {
    rows: ["....o....", "...oao...", "...oaao..", "..oabaao.", "..oaaaao.", "ooooooooo"],
    palette: { o: "#22145a", a: "#5b3fd6", b: "#ffd23f" },
    lift: 0,
  },
  beanie: {
    rows: ["...b...", ".ooooo.", "oaaaaao", "occccco"],
    palette: { o: "#7a1a12", a: "#e74c3c", b: "#ffffff", c: "#f4d6d2" },
    lift: 0,
  },
  tinyduck: {
    rows: [".oo..", "oada.", "oaaab", ".ooo."],
    palette: { o: "#7a5a00", a: "#ffd23f", b: "#ff9f1a", d: "#222222" },
    lift: 0,
  },
};
