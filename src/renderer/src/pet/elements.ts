// 物种的属性（shared/pet/model.ts 的 speciesElement）在宠物身上的样子：身边冒的小粒子、身体外面那圈光的颜色。
// 粒子是 3×3 的像素小图，字符同 hats.ts：'.' 透明，其余按 palette 上色。
// 越养越有气势（所有者定，2026-11-19）：每 5 级变一档，Lv5 起冒粒子、到 Lv30 共 6 颗，之后身体外面一圈光每 5 级更亮一点。
import type { Element } from "../../../shared/pet/model.ts";

export interface ElementLook {
  /** 光圈的颜色。 */
  glow: string;
  particle: { rows: readonly string[]; palette: Readonly<Record<string, string>> };
}

export const elementLooks: Readonly<Record<Element, ElementLook>> = {
  psychic: { glow: "#ff6bd6", particle: { rows: [".a.", "aba", ".a."], palette: { a: "#ff6bd6", b: "#ffd6f5" } } },
  water: { glow: "#4fb3ff", particle: { rows: [".a.", "aba", ".a."], palette: { a: "#4fb3ff", b: "#e8f6ff" } } },
  dark: { glow: "#7a5cff", particle: { rows: ["aa.", "a..", "aa."], palette: { a: "#b9a6ff" } } },
  ghost: { glow: "#a98bff", particle: { rows: [".a.", "aaa", "a.a"], palette: { a: "#d9ccff" } } },
  steel: { glow: "#9fc4d8", particle: { rows: ["a.a", ".b.", "a.a"], palette: { a: "#9fc4d8", b: "#ffffff" } } },
  fairy: { glow: "#ff9ec8", particle: { rows: ["a.a", ".b.", "a.a"], palette: { a: "#ff9ec8", b: "#fff2f8" } } },
  fire: { glow: "#ff7a2f", particle: { rows: [".a.", "aba", ".a."], palette: { a: "#ff7a2f", b: "#ffd23f" } } },
  grass: { glow: "#5fd068", particle: { rows: [".aa", "aa.", "b.."], palette: { a: "#5fd068", b: "#2e8b3a" } } },
  bug: { glow: "#c6e05a", particle: { rows: ["a.a", ".b.", "..."], palette: { a: "#e8f59a", b: "#8aa82c" } } },
  ice: { glow: "#8fe3ff", particle: { rows: ["a.a", ".a.", "a.a"], palette: { a: "#dff7ff" } } },
  electric: { glow: "#3fe0d0", particle: { rows: [".a", "a.", ".a"], palette: { a: "#3fe0d0" } } },
  rock: { glow: "#c9a46a", particle: { rows: ["ab", "bb"], palette: { a: "#e0c48f", b: "#a07a45" } } },
  poison: { glow: "#b45cff", particle: { rows: [".a.", "aba", ".a."], palette: { a: "#b45cff", b: "#e6c8ff" } } },
  normal: { glow: "#f2d29a", particle: { rows: ["a.a", ".a.", "..."], palette: { a: "#fff1d0" } } },
  dragon: { glow: "#4fd1ff", particle: { rows: [".a.", "aba", ".a."], palette: { a: "#4fd1ff", b: "#fff6c8" } } },
};

/** 等级对应的气势：粒子几颗（0–6），光圈多强（0 = 没有，到 1）。 */
export function auraOf(level: number): { particles: number; glow: number } {
  const step = Math.floor(level / 5);
  return { particles: Math.min(6, step), glow: step <= 6 ? 0 : (step - 6) / 13 };
}
