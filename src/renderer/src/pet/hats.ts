// 宠物的帽子（稀有度决定能戴哪些，shared/pet/model.ts 的 hatMinRarity）：像素画，和宠物同一种格子大小（不放大），戴在头顶正中。
// 字符同 sprites.ts：'.' 透明，其余按 palette 上色；o 是深色描边，亮面在左、暗面在右，和宠物的光照一致。
// lift = 帽子底边离头顶多高（光环浮在头上，其余压住头顶那行轮廓）。
import type { Hat } from "../../../shared/pet/model.ts";

export interface HatDef {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
  lift: number;
}

export const hatSprites: Readonly<Record<Exclude<Hat, "none">, HatDef>> = {
  crown: {
    rows: [
      ".o.....o.....o.",
      "oyo...oyo...oyo",
      "oyyo.oyryo.oyyo",
      "oyyyoyyyyyoyyyo",
      "owyyyyyyyyyyydo",
      "ooooooooooooooo",
      "owyryybbbyyrydo",
      "odddddddddddddo",
      "ooooooooooooooo",
    ],
    palette: { o: "#3b2400", y: "#ffd23f", w: "#fff2a8", d: "#c98a00", r: "#e8443a", b: "#3aa0ff" },
    lift: 0,
  },
  tophat: {
    rows: [
      "...ooooooo...",
      "..owaaaaado..",
      "..owaaaaado..",
      "..owaaaaado..",
      "..owaaaaado..",
      "..orrrrrrro..",
      "..oRRRRRRRo..",
      "..owaaaaado..",
      "ooooooooooooo",
      "owaaaaaaaaado",
      "ooooooooooooo",
    ],
    palette: { o: "#0d0d12", a: "#2c2c3a", w: "#4a4a60", d: "#1c1c26", r: "#d6403a", R: "#8f241f" },
    lift: 0,
  },
  propeller: {
    rows: [
      ".ooooo.o.ooooo.",
      "orrrrroyobbbbbo",
      ".ooooo.o.ooooo.",
      ".......o.......",
      "....ooooooo....",
      "...oyygggbbo...",
      "..oyyygggbbbo..",
      "..ooooooooooo..",
    ],
    palette: { o: "#2a2a2a", r: "#e74c3c", b: "#3498db", y: "#f1c40f", g: "#2ecc71" },
    lift: 0,
  },
  halo: {
    rows: ["...ooooooooo...", ".ooyyyyyyyyyoo.", "oyy.........yyo", ".ooyyyyyyyyyoo.", "...ooooooooo..."],
    palette: { o: "#c99a00", y: "#fff06a" },
    lift: 3,
  },
  wizard: {
    rows: [
      ".......o.......",
      "......owo......",
      "......owdo.....",
      ".....owado.....",
      ".....owydo.....",
      "....owaaado....",
      "....owaaado....",
      "...owaayaado...",
      "...owaaaaado...",
      "..owaaaaaaado..",
      "ooooooooooooooo",
      "owaaaaaaaaaaado",
      "ooooooooooooooo",
    ],
    palette: { o: "#1a0f45", a: "#5b3fd6", w: "#8a73ff", d: "#3d27a8", y: "#ffd23f" },
    lift: 0,
  },
  beanie: {
    rows: [
      "......ooo......",
      ".....owwwo.....",
      "......ooo......",
      "....ooooooo....",
      "...orrrrrrro...",
      "..orhrrrrrrdo..",
      ".orhrrrrrrrrdo.",
      "ooooooooooooooo",
      "owcwcwcwcwcwcwo",
      "ooooooooooooooo",
    ],
    palette: { o: "#5a120c", r: "#e74c3c", h: "#ff8a7a", d: "#b02a1c", w: "#ffffff", c: "#f4d6d2" },
    lift: 0,
  },
  tinyduck: {
    rows: [
      "...ooo.....",
      "..oyyyo....",
      "..oyeybbo..",
      "..oyyyooo..",
      "oooyyyyyyo.",
      "oyyywwyyyyo",
      ".oyyyyyyyo.",
      "..ooooooo..",
    ],
    palette: { o: "#7a5a00", y: "#ffd23f", e: "#222222", b: "#ff9f1a", w: "#f0b400" },
    lift: 0,
  },
};
