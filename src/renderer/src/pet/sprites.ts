// 宠物的像素画（docs/architecture/pet.md「像素画」）：每个物种 10 张 48×48 透明 PNG（sprites/<物种>/），
// 成年、完全体、觉醒分稳健（-a）和捣蛋（-b）两条路线。眼睛方框、头顶位置在 sprite-meta.ts（scripts/pet-sprites.ts 生成）。
import type { Branch, Species, Stage } from "../../../shared/pet/model.ts";
import { spriteMeta } from "./sprite-meta.ts";

/** 每张都是 48 × 48 格，宠物站在最底行、水平居中。 */
export const SPRITE_SIZE = 48;

export type SpriteName = "egg" | "baby" | "child" | "teen" | `${"adult" | "final" | "awakened"}-${"a" | "b"}`;

export interface EyeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteMeta {
  /** 两只眼睛的方框（左、右）；蛋没有眼睛为 null。 */
  eyes: readonly [EyeBox, EyeBox] | readonly EyeBox[] | null;
  /** 头顶正中（帽子、头上标记的位置）。 */
  head: { x: number; y: number };
}

const urls = import.meta.glob<string>("./sprites/*/*.png", { query: "?url", import: "default", eager: true });

function spriteName(stage: Stage, branch: Branch | null): SpriteName {
  if (stage === "egg" || stage === "baby" || stage === "child" || stage === "teen") return stage;
  return `${stage}-${branch === "mischief" ? "b" : "a"}`;
}

export function spriteOf(species: Species, stage: Stage, branch: Branch | null): SpriteMeta & { url: string } {
  const name = spriteName(stage, branch);
  return { ...spriteMeta[species][name], url: urls[`./sprites/${species}/${name}.png`]! };
}
