// 生成的文件（node scripts/pet-sprites.ts <美术目录>），不要手改：每张像素画的眼睛方框和头顶（48×48 格坐标）。
import type { Species } from "../../../shared/pet/model.ts";
import type { SpriteMeta, SpriteName } from "./sprites.ts";

export const spriteMeta: Readonly<Record<Species, Readonly<Record<SpriteName, SpriteMeta>>>> = {
  pi: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 16, y: 33, w: 6, h: 6 },
        { x: 24, y: 33, w: 7, h: 6 },
      ],
      head: { x: 23, y: 26 },
    },
    child: {
      eyes: [
        { x: 16, y: 24, w: 7, h: 7 },
        { x: 27, y: 24, w: 7, h: 7 },
      ],
      head: { x: 25, y: 20 },
    },
    teen: {
      eyes: [
        { x: 18, y: 19, w: 5, h: 6 },
        { x: 26, y: 19, w: 6, h: 6 },
      ],
      head: { x: 25, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 16, y: 14, w: 7, h: 6 },
        { x: 27, y: 14, w: 6, h: 6 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 17, y: 16, w: 5, h: 5 },
        { x: 25, y: 16, w: 5, h: 5 },
      ],
      head: { x: 23, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 17, y: 17, w: 5, h: 5 },
        { x: 25, y: 17, w: 5, h: 5 },
      ],
      head: { x: 23, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 16, y: 14, w: 7, h: 8 },
        { x: 28, y: 14, w: 7, h: 8 },
      ],
      head: { x: 25, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 16, y: 10, w: 7, h: 6 },
        { x: 27, y: 10, w: 6, h: 6 },
      ],
      head: { x: 24, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 16, y: 13, w: 6, h: 5 },
        { x: 26, y: 12, w: 6, h: 6 },
      ],
      head: { x: 24, y: 9 },
    },
  },
  duck: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 19, y: 34, w: 4, h: 4 },
        { x: 25, y: 34, w: 4, h: 4 },
      ],
      head: { x: 24, y: 26 },
    },
    child: {
      eyes: [
        { x: 19, y: 28, w: 4, h: 4 },
        { x: 26, y: 28, w: 3, h: 4 },
      ],
      head: { x: 24, y: 20 },
    },
    teen: {
      eyes: [
        { x: 20, y: 23, w: 3, h: 4 },
        { x: 26, y: 23, w: 3, h: 4 },
      ],
      head: { x: 24, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 20, y: 18, w: 2, h: 3 },
        { x: 25, y: 18, w: 3, h: 3 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 20, y: 16, w: 3, h: 4 },
        { x: 25, y: 16, w: 3, h: 4 },
      ],
      head: { x: 24, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 20, y: 14, w: 3, h: 3 },
        { x: 25, y: 14, w: 3, h: 3 },
      ],
      head: { x: 24, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 18, y: 18, w: 3, h: 3 },
        { x: 23, y: 18, w: 4, h: 3 },
      ],
      head: { x: 22, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 19, y: 17, w: 4, h: 3 },
        { x: 24, y: 17, w: 4, h: 3 },
      ],
      head: { x: 23, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 20, y: 21, w: 3, h: 3 },
        { x: 25, y: 21, w: 2, h: 3 },
      ],
      head: { x: 23, y: 12 },
    },
  },
  cat: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 18, y: 35, w: 5, h: 5 },
        { x: 25, y: 35, w: 5, h: 5 },
      ],
      head: { x: 24, y: 27 },
    },
    child: {
      eyes: [
        { x: 16, y: 29, w: 5, h: 4 },
        { x: 23, y: 29, w: 5, h: 4 },
      ],
      head: { x: 22, y: 21 },
    },
    teen: {
      eyes: [
        { x: 16, y: 23, w: 5, h: 5 },
        { x: 22, y: 23, w: 4, h: 5 },
      ],
      head: { x: 21, y: 16 },
    },
    "adult-a": {
      eyes: [
        { x: 20, y: 19, w: 5, h: 4 },
        { x: 26, y: 19, w: 5, h: 4 },
      ],
      head: { x: 25, y: 12 },
    },
    "final-a": {
      eyes: [
        { x: 19, y: 14, w: 5, h: 5 },
        { x: 25, y: 14, w: 6, h: 5 },
      ],
      head: { x: 25, y: 7 },
    },
    "awakened-a": {
      eyes: [
        { x: 20, y: 18, w: 4, h: 4 },
        { x: 26, y: 18, w: 4, h: 4 },
      ],
      head: { x: 25, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 14, y: 18, w: 5, h: 5 },
        { x: 20, y: 18, w: 5, h: 5 },
      ],
      head: { x: 19, y: 11 },
    },
    "final-b": {
      eyes: [
        { x: 13, y: 14, w: 5, h: 5 },
        { x: 20, y: 14, w: 5, h: 5 },
      ],
      head: { x: 19, y: 7 },
    },
    "awakened-b": {
      eyes: [
        { x: 19, y: 20, w: 5, h: 4 },
        { x: 25, y: 20, w: 4, h: 4 },
      ],
      head: { x: 24, y: 14 },
    },
  },
  owl: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 20, y: 34, w: 4, h: 4 },
        { x: 25, y: 34, w: 4, h: 4 },
      ],
      head: { x: 24, y: 27 },
    },
    child: {
      eyes: [
        { x: 20, y: 29, w: 4, h: 4 },
        { x: 25, y: 29, w: 4, h: 4 },
      ],
      head: { x: 24, y: 21 },
    },
    teen: {
      eyes: [
        { x: 19, y: 23, w: 4, h: 4 },
        { x: 24, y: 23, w: 4, h: 4 },
      ],
      head: { x: 23, y: 18 },
    },
    "adult-a": {
      eyes: [
        { x: 18, y: 19, w: 4, h: 5 },
        { x: 25, y: 19, w: 4, h: 5 },
      ],
      head: { x: 23, y: 14 },
    },
    "final-a": {
      eyes: [
        { x: 18, y: 19, w: 5, h: 5 },
        { x: 25, y: 19, w: 4, h: 5 },
      ],
      head: { x: 23, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 16, w: 4, h: 4 },
        { x: 25, y: 16, w: 4, h: 4 },
      ],
      head: { x: 24, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 19, y: 19, w: 4, h: 5 },
        { x: 25, y: 19, w: 5, h: 5 },
      ],
      head: { x: 24, y: 13 },
    },
    "final-b": {
      eyes: [
        { x: 18, y: 17, w: 5, h: 5 },
        { x: 25, y: 17, w: 4, h: 5 },
      ],
      head: { x: 23, y: 10 },
    },
    "awakened-b": {
      eyes: [
        { x: 19, y: 18, w: 4, h: 4 },
        { x: 25, y: 18, w: 4, h: 4 },
      ],
      head: { x: 24, y: 6 },
    },
  },
  ghost: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 17, y: 32, w: 6, h: 6 },
        { x: 25, y: 32, w: 5, h: 6 },
      ],
      head: { x: 23, y: 26 },
    },
    child: {
      eyes: [
        { x: 19, y: 25, w: 4, h: 6 },
        { x: 24, y: 25, w: 5, h: 5 },
      ],
      head: { x: 24, y: 20 },
    },
    teen: {
      eyes: [
        { x: 19, y: 20, w: 5, h: 5 },
        { x: 25, y: 20, w: 4, h: 5 },
      ],
      head: { x: 24, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 20, y: 16, w: 5, h: 5 },
        { x: 27, y: 16, w: 4, h: 5 },
      ],
      head: { x: 25, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 17, y: 18, w: 5, h: 5 },
        { x: 23, y: 18, w: 4, h: 5 },
      ],
      head: { x: 22, y: 8 },
    },
    "awakened-a": {
      eyes: [
        { x: 20, y: 12, w: 4, h: 5 },
        { x: 25, y: 12, w: 4, h: 5 },
      ],
      head: { x: 24, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 17, y: 16, w: 6, h: 6 },
        { x: 25, y: 16, w: 6, h: 6 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 18, y: 18, w: 5, h: 5 },
        { x: 25, y: 18, w: 5, h: 5 },
      ],
      head: { x: 24, y: 7 },
    },
    "awakened-b": {
      eyes: [
        { x: 19, y: 19, w: 4, h: 5 },
        { x: 25, y: 19, w: 4, h: 5 },
      ],
      head: { x: 24, y: 5 },
    },
  },
  robot: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 20, y: 36, w: 3, h: 3 },
        { x: 24, y: 36, w: 4, h: 3 },
      ],
      head: { x: 24, y: 26 },
    },
    child: {
      eyes: [
        { x: 20, y: 30, w: 4, h: 3 },
        { x: 25, y: 30, w: 3, h: 4 },
      ],
      head: { x: 24, y: 20 },
    },
    teen: {
      eyes: [
        { x: 20, y: 23, w: 3, h: 3 },
        { x: 24, y: 23, w: 3, h: 3 },
      ],
      head: { x: 23, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 19, y: 19, w: 3, h: 3 },
        { x: 23, y: 19, w: 3, h: 3 },
      ],
      head: { x: 22, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 21, y: 15, w: 2, h: 3 },
        { x: 25, y: 15, w: 2, h: 3 },
      ],
      head: { x: 24, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 20, y: 11, w: 3, h: 3 },
        { x: 24, y: 11, w: 3, h: 3 },
      ],
      head: { x: 23, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 21, y: 20, w: 3, h: 4 },
        { x: 25, y: 20, w: 3, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 20, y: 16, w: 4, h: 4 },
        { x: 25, y: 16, w: 5, h: 4 },
      ],
      head: { x: 25, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 18, y: 12, w: 5, h: 5 },
        { x: 25, y: 12, w: 6, h: 5 },
      ],
      head: { x: 24, y: 0 },
    },
  },
  axolotl: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 17, y: 33, w: 4, h: 5 },
        { x: 25, y: 33, w: 5, h: 5 },
      ],
      head: { x: 23, y: 29 },
    },
    child: {
      eyes: [
        { x: 15, y: 27, w: 5, h: 5 },
        { x: 24, y: 27, w: 5, h: 5 },
      ],
      head: { x: 22, y: 22 },
    },
    teen: {
      eyes: [
        { x: 15, y: 22, w: 5, h: 5 },
        { x: 24, y: 22, w: 5, h: 5 },
      ],
      head: { x: 22, y: 17 },
    },
    "adult-a": {
      eyes: [
        { x: 18, y: 16, w: 4, h: 5 },
        { x: 26, y: 16, w: 4, h: 5 },
      ],
      head: { x: 24, y: 13 },
    },
    "final-a": {
      eyes: [
        { x: 19, y: 13, w: 4, h: 4 },
        { x: 27, y: 13, w: 4, h: 4 },
      ],
      head: { x: 25, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 9, w: 3, h: 4 },
        { x: 26, y: 9, w: 4, h: 4 },
      ],
      head: { x: 24, y: 1 },
    },
    "adult-b": {
      eyes: [
        { x: 15, y: 17, w: 5, h: 5 },
        { x: 24, y: 17, w: 5, h: 5 },
      ],
      head: { x: 22, y: 13 },
    },
    "final-b": {
      eyes: [
        { x: 15, y: 14, w: 5, h: 5 },
        { x: 24, y: 14, w: 4, h: 5 },
      ],
      head: { x: 21, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 17, y: 9, w: 5, h: 5 },
        { x: 25, y: 9, w: 5, h: 5 },
      ],
      head: { x: 23, y: 0 },
    },
  },
  fox: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 18, y: 35, w: 4, h: 5 },
        { x: 25, y: 35, w: 4, h: 5 },
      ],
      head: { x: 23, y: 26 },
    },
    child: {
      eyes: [
        { x: 15, y: 28, w: 4, h: 4 },
        { x: 22, y: 28, w: 4, h: 4 },
      ],
      head: { x: 20, y: 21 },
    },
    teen: {
      eyes: [
        { x: 16, y: 23, w: 4, h: 4 },
        { x: 22, y: 23, w: 3, h: 4 },
      ],
      head: { x: 20, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 17, y: 19, w: 4, h: 4 },
        { x: 23, y: 19, w: 3, h: 4 },
      ],
      head: { x: 21, y: 11 },
    },
    "final-a": {
      eyes: [
        { x: 19, y: 16, w: 3, h: 4 },
        { x: 25, y: 16, w: 4, h: 4 },
      ],
      head: { x: 24, y: 6 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 20, w: 4, h: 4 },
        { x: 25, y: 20, w: 4, h: 4 },
      ],
      head: { x: 24, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 15, y: 19, w: 4, h: 4 },
        { x: 21, y: 18, w: 4, h: 5 },
      ],
      head: { x: 20, y: 11 },
    },
    "final-b": {
      eyes: [
        { x: 17, y: 18, w: 4, h: 4 },
        { x: 23, y: 18, w: 4, h: 4 },
      ],
      head: { x: 22, y: 6 },
    },
    "awakened-b": {
      eyes: [
        { x: 19, y: 20, w: 4, h: 4 },
        { x: 25, y: 20, w: 4, h: 4 },
      ],
      head: { x: 24, y: 0 },
    },
  },
  sprout: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 19, y: 36, w: 3, h: 4 },
        { x: 26, y: 36, w: 3, h: 4 },
      ],
      head: { x: 24, y: 26 },
    },
    child: {
      eyes: [
        { x: 18, y: 31, w: 3, h: 4 },
        { x: 25, y: 31, w: 4, h: 4 },
      ],
      head: { x: 23, y: 20 },
    },
    teen: {
      eyes: [
        { x: 12, y: 27, w: 3, h: 5 },
        { x: 18, y: 27, w: 4, h: 5 },
      ],
      head: { x: 17, y: 18 },
    },
    "adult-a": {
      eyes: [
        { x: 10, y: 21, w: 3, h: 4 },
        { x: 15, y: 21, w: 3, h: 4 },
      ],
      head: { x: 14, y: 11 },
    },
    "final-a": {
      eyes: [
        { x: 12, y: 16, w: 3, h: 4 },
        { x: 17, y: 16, w: 3, h: 4 },
      ],
      head: { x: 16, y: 9 },
    },
    "awakened-a": {
      eyes: [
        { x: 12, y: 23, w: 3, h: 3 },
        { x: 16, y: 23, w: 3, h: 3 },
      ],
      head: { x: 15, y: 4 },
    },
    "adult-b": {
      eyes: [
        { x: 17, y: 22, w: 3, h: 3 },
        { x: 22, y: 22, w: 5, h: 3 },
      ],
      head: { x: 22, y: 11 },
    },
    "final-b": {
      eyes: [
        { x: 7, y: 19, w: 4, h: 4 },
        { x: 13, y: 20, w: 5, h: 3 },
      ],
      head: { x: 12, y: 10 },
    },
    "awakened-b": {
      eyes: [
        { x: 16, y: 20, w: 3, h: 4 },
        { x: 21, y: 21, w: 5, h: 3 },
      ],
      head: { x: 21, y: 5 },
    },
  },
  moth: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 17, y: 36, w: 4, h: 4 },
        { x: 23, y: 36, w: 4, h: 4 },
      ],
      head: { x: 22, y: 26 },
    },
    child: {
      eyes: [
        { x: 14, y: 30, w: 4, h: 5 },
        { x: 20, y: 30, w: 4, h: 5 },
      ],
      head: { x: 19, y: 20 },
    },
    teen: {
      eyes: [
        { x: 19, y: 24, w: 4, h: 4 },
        { x: 25, y: 24, w: 3, h: 4 },
      ],
      head: { x: 23, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 19, y: 21, w: 4, h: 5 },
        { x: 25, y: 21, w: 4, h: 5 },
      ],
      head: { x: 24, y: 11 },
    },
    "final-a": {
      eyes: [
        { x: 19, y: 14, w: 4, h: 4 },
        { x: 24, y: 14, w: 4, h: 4 },
      ],
      head: { x: 23, y: 6 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 17, w: 4, h: 4 },
        { x: 25, y: 17, w: 4, h: 4 },
      ],
      head: { x: 24, y: 6 },
    },
    "adult-b": {
      eyes: [
        { x: 20, y: 22, w: 4, h: 3 },
        { x: 27, y: 22, w: 4, h: 3 },
      ],
      head: { x: 25, y: 11 },
    },
    "final-b": {
      eyes: [
        { x: 19, y: 17, w: 4, h: 4 },
        { x: 25, y: 17, w: 4, h: 4 },
      ],
      head: { x: 24, y: 7 },
    },
    "awakened-b": {
      eyes: [
        { x: 19, y: 23, w: 4, h: 3 },
        { x: 25, y: 23, w: 4, h: 3 },
      ],
      head: { x: 24, y: 13 },
    },
  },
  penguin: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 18, y: 34, w: 4, h: 4 },
        { x: 25, y: 34, w: 4, h: 4 },
      ],
      head: { x: 23, y: 26 },
    },
    child: {
      eyes: [
        { x: 18, y: 29, w: 4, h: 4 },
        { x: 25, y: 29, w: 4, h: 4 },
      ],
      head: { x: 23, y: 20 },
    },
    teen: {
      eyes: [
        { x: 19, y: 25, w: 4, h: 3 },
        { x: 25, y: 25, w: 3, h: 3 },
      ],
      head: { x: 23, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 20, y: 21, w: 3, h: 3 },
        { x: 25, y: 21, w: 3, h: 3 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 19, y: 17, w: 4, h: 3 },
        { x: 25, y: 17, w: 3, h: 3 },
      ],
      head: { x: 23, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 15, w: 3, h: 3 },
        { x: 25, y: 15, w: 3, h: 3 },
      ],
      head: { x: 23, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 18, y: 22, w: 4, h: 4 },
        { x: 24, y: 22, w: 4, h: 4 },
      ],
      head: { x: 23, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 16, y: 18, w: 3, h: 4 },
        { x: 22, y: 18, w: 3, h: 4 },
      ],
      head: { x: 20, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 16, y: 20, w: 3, h: 3 },
        { x: 21, y: 20, w: 3, h: 3 },
      ],
      head: { x: 20, y: 7 },
    },
  },
  hamster: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 19, y: 36, w: 4, h: 4 },
        { x: 25, y: 36, w: 4, h: 4 },
      ],
      head: { x: 24, y: 26 },
    },
    child: {
      eyes: [
        { x: 15, y: 31, w: 4, h: 4 },
        { x: 22, y: 31, w: 4, h: 4 },
      ],
      head: { x: 20, y: 20 },
    },
    teen: {
      eyes: [
        { x: 15, y: 26, w: 4, h: 3 },
        { x: 22, y: 26, w: 4, h: 3 },
      ],
      head: { x: 20, y: 18 },
    },
    "adult-a": {
      eyes: [
        { x: 16, y: 22, w: 4, h: 4 },
        { x: 23, y: 22, w: 4, h: 4 },
      ],
      head: { x: 21, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 16, y: 18, w: 5, h: 4 },
        { x: 24, y: 18, w: 5, h: 4 },
      ],
      head: { x: 22, y: 9 },
    },
    "awakened-a": {
      eyes: [
        { x: 17, y: 22, w: 4, h: 4 },
        { x: 23, y: 22, w: 4, h: 4 },
      ],
      head: { x: 22, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 16, y: 23, w: 4, h: 4 },
        { x: 24, y: 23, w: 5, h: 4 },
      ],
      head: { x: 22, y: 13 },
    },
    "final-b": {
      eyes: [
        { x: 13, y: 20, w: 4, h: 4 },
        { x: 21, y: 20, w: 5, h: 4 },
      ],
      head: { x: 19, y: 11 },
    },
    "awakened-b": {
      eyes: [
        { x: 14, y: 21, w: 4, h: 4 },
        { x: 21, y: 21, w: 4, h: 4 },
      ],
      head: { x: 19, y: 7 },
    },
  },
  turtle: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 17, y: 37, w: 5, h: 4 },
        { x: 25, y: 37, w: 5, h: 4 },
      ],
      head: { x: 23, y: 26 },
    },
    child: {
      eyes: [
        { x: 18, y: 34, w: 4, h: 4 },
        { x: 26, y: 34, w: 4, h: 4 },
      ],
      head: { x: 24, y: 20 },
    },
    teen: {
      eyes: [
        { x: 18, y: 33, w: 4, h: 4 },
        { x: 25, y: 33, w: 4, h: 4 },
      ],
      head: { x: 23, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 18, y: 30, w: 5, h: 4 },
        { x: 26, y: 30, w: 4, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 18, y: 30, w: 4, h: 4 },
        { x: 26, y: 30, w: 4, h: 4 },
      ],
      head: { x: 24, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 18, y: 29, w: 5, h: 4 },
        { x: 26, y: 29, w: 4, h: 4 },
      ],
      head: { x: 24, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 18, y: 24, w: 4, h: 4 },
        { x: 26, y: 24, w: 4, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 18, y: 24, w: 4, h: 4 },
        { x: 25, y: 24, w: 4, h: 4 },
      ],
      head: { x: 23, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 19, y: 26, w: 4, h: 4 },
        { x: 25, y: 26, w: 4, h: 4 },
      ],
      head: { x: 24, y: 8 },
    },
  },
  mushroom: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 21, y: 38, w: 4, h: 4 },
        { x: 26, y: 38, w: 3, h: 4 },
      ],
      head: { x: 25, y: 26 },
    },
    child: {
      eyes: [
        { x: 19, y: 31, w: 4, h: 5 },
        { x: 24, y: 31, w: 4, h: 5 },
      ],
      head: { x: 23, y: 20 },
    },
    teen: {
      eyes: [
        { x: 19, y: 28, w: 5, h: 5 },
        { x: 25, y: 29, w: 4, h: 4 },
      ],
      head: { x: 24, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 19, y: 26, w: 5, h: 4 },
        { x: 25, y: 26, w: 4, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 20, y: 26, w: 3, h: 3 },
        { x: 24, y: 26, w: 3, h: 3 },
      ],
      head: { x: 23, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 21, y: 26, w: 3, h: 3 },
        { x: 25, y: 26, w: 4, h: 3 },
      ],
      head: { x: 25, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 20, y: 25, w: 4, h: 4 },
        { x: 24, y: 25, w: 4, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 20, y: 28, w: 3, h: 4 },
        { x: 24, y: 28, w: 3, h: 4 },
      ],
      head: { x: 23, y: 10 },
    },
    "awakened-b": {
      eyes: [
        { x: 20, y: 25, w: 4, h: 3 },
        { x: 24, y: 25, w: 4, h: 3 },
      ],
      head: { x: 24, y: 3 },
    },
  },
  capybara: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 17, y: 33, w: 4, h: 5 },
        { x: 26, y: 33, w: 4, h: 5 },
      ],
      head: { x: 23, y: 27 },
    },
    child: {
      eyes: [
        { x: 17, y: 26, w: 4, h: 5 },
        { x: 27, y: 26, w: 4, h: 5 },
      ],
      head: { x: 24, y: 21 },
    },
    teen: {
      eyes: [
        { x: 17, y: 25, w: 4, h: 4 },
        { x: 27, y: 25, w: 3, h: 4 },
      ],
      head: { x: 23, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 17, y: 21, w: 4, h: 4 },
        { x: 27, y: 21, w: 4, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 15, y: 14, w: 4, h: 5 },
        { x: 28, y: 14, w: 4, h: 5 },
      ],
      head: { x: 23, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 15, y: 10, w: 4, h: 5 },
        { x: 28, y: 10, w: 5, h: 5 },
      ],
      head: { x: 24, y: 0 },
    },
    "adult-b": {
      eyes: [
        { x: 18, y: 23, w: 3, h: 4 },
        { x: 27, y: 23, w: 4, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 18, y: 18, w: 4, h: 4 },
        { x: 28, y: 18, w: 4, h: 4 },
      ],
      head: { x: 25, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 15, y: 14, w: 4, h: 5 },
        { x: 27, y: 14, w: 4, h: 5 },
      ],
      head: { x: 23, y: 0 },
    },
  },
  drake: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 18, y: 34, w: 4, h: 5 },
        { x: 25, y: 34, w: 5, h: 5 },
      ],
      head: { x: 24, y: 27 },
    },
    child: {
      eyes: [
        { x: 18, y: 28, w: 4, h: 4 },
        { x: 25, y: 28, w: 4, h: 4 },
      ],
      head: { x: 23, y: 22 },
    },
    teen: {
      eyes: [
        { x: 19, y: 23, w: 4, h: 4 },
        { x: 25, y: 23, w: 4, h: 4 },
      ],
      head: { x: 24, y: 16 },
    },
    "adult-a": {
      eyes: [
        { x: 20, y: 18, w: 3, h: 4 },
        { x: 25, y: 18, w: 4, h: 4 },
      ],
      head: { x: 24, y: 12 },
    },
    "final-a": {
      eyes: [
        { x: 20, y: 16, w: 4, h: 4 },
        { x: 25, y: 16, w: 4, h: 4 },
      ],
      head: { x: 24, y: 10 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 13, w: 4, h: 4 },
        { x: 24, y: 13, w: 4, h: 4 },
      ],
      head: { x: 23, y: 5 },
    },
    "adult-b": {
      eyes: [
        { x: 19, y: 19, w: 4, h: 4 },
        { x: 25, y: 19, w: 3, h: 4 },
      ],
      head: { x: 23, y: 13 },
    },
    "final-b": {
      eyes: [
        { x: 19, y: 15, w: 4, h: 4 },
        { x: 25, y: 15, w: 3, h: 4 },
      ],
      head: { x: 23, y: 9 },
    },
    "awakened-b": {
      eyes: [
        { x: 20, y: 19, w: 3, h: 3 },
        { x: 25, y: 19, w: 3, h: 3 },
      ],
      head: { x: 24, y: 11 },
    },
  },
  ember: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 15, y: 33, w: 4, h: 5 },
        { x: 22, y: 33, w: 4, h: 5 },
      ],
      head: { x: 20, y: 26 },
    },
    child: {
      eyes: [
        { x: 17, y: 26, w: 3, h: 4 },
        { x: 23, y: 26, w: 3, h: 4 },
      ],
      head: { x: 21, y: 20 },
    },
    teen: {
      eyes: [
        { x: 19, y: 24, w: 3, h: 4 },
        { x: 24, y: 24, w: 4, h: 4 },
      ],
      head: { x: 23, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 19, y: 20, w: 4, h: 4 },
        { x: 25, y: 20, w: 3, h: 4 },
      ],
      head: { x: 23, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 20, y: 15, w: 3, h: 5 },
        { x: 25, y: 16, w: 3, h: 4 },
      ],
      head: { x: 24, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 13, w: 4, h: 3 },
        { x: 25, y: 12, w: 3, h: 4 },
      ],
      head: { x: 23, y: 1 },
    },
    "adult-b": {
      eyes: [
        { x: 19, y: 19, w: 4, h: 3 },
        { x: 24, y: 19, w: 4, h: 3 },
      ],
      head: { x: 23, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 20, y: 17, w: 3, h: 3 },
        { x: 24, y: 17, w: 4, h: 3 },
      ],
      head: { x: 24, y: 5 },
    },
    "awakened-b": {
      eyes: [
        { x: 21, y: 20, w: 2, h: 3 },
        { x: 25, y: 20, w: 2, h: 3 },
      ],
      head: { x: 24, y: 10 },
    },
  },
  mecha: {
    egg: { eyes: null, head: { x: 23, y: 30 } },
    baby: {
      eyes: [
        { x: 19, y: 34, w: 4, h: 4 },
        { x: 24, y: 34, w: 4, h: 4 },
      ],
      head: { x: 23, y: 26 },
    },
    child: {
      eyes: [
        { x: 20, y: 27, w: 3, h: 4 },
        { x: 25, y: 27, w: 3, h: 4 },
      ],
      head: { x: 24, y: 20 },
    },
    teen: {
      eyes: [
        { x: 20, y: 22, w: 3, h: 3 },
        { x: 25, y: 22, w: 3, h: 3 },
      ],
      head: { x: 24, y: 15 },
    },
    "adult-a": {
      eyes: [
        { x: 19, y: 17, w: 4, h: 4 },
        { x: 25, y: 17, w: 3, h: 4 },
      ],
      head: { x: 23, y: 10 },
    },
    "final-a": {
      eyes: [
        { x: 19, y: 12, w: 4, h: 4 },
        { x: 25, y: 12, w: 4, h: 4 },
      ],
      head: { x: 24, y: 5 },
    },
    "awakened-a": {
      eyes: [
        { x: 19, y: 15, w: 4, h: 4 },
        { x: 25, y: 15, w: 4, h: 4 },
      ],
      head: { x: 24, y: 7 },
    },
    "adult-b": {
      eyes: [
        { x: 20, y: 17, w: 3, h: 3 },
        { x: 25, y: 17, w: 4, h: 3 },
      ],
      head: { x: 24, y: 10 },
    },
    "final-b": {
      eyes: [
        { x: 20, y: 14, w: 3, h: 4 },
        { x: 25, y: 14, w: 3, h: 4 },
      ],
      head: { x: 24, y: 7 },
    },
    "awakened-b": {
      eyes: [
        { x: 20, y: 12, w: 3, h: 3 },
        { x: 25, y: 12, w: 3, h: 3 },
      ],
      head: { x: 24, y: 5 },
    },
  },
};
