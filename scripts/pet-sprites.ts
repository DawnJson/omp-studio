// 把画好的宠物像素画收进仓库（docs/architecture/pet.md「像素画」）：node scripts/pet-sprites.ts <美术目录>
// 美术目录下每个物种一个子目录，里面的 48/ 是 48×48 的透明 PNG（egg、baby、child、teen，adult/final/awakened 各 -a、-b）
// 和 meta.json（每张的眼睛方框、头顶）。PNG 复制到 src/renderer/src/pet/sprites/<物种>/，元数据合成 sprite-meta.ts。
// 缺物种、缺图、成年起没认出眼睛都直接报错：宠物窗口按这些数据画眼睛和帽子。
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { speciesList } from "../src/shared/pet/model.ts";

const SPRITE_NAMES = [
  "egg",
  "baby",
  "child",
  "teen",
  "adult-a",
  "final-a",
  "awakened-a",
  "adult-b",
  "final-b",
  "awakened-b",
] as const;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const isBox = (value: unknown): value is Box =>
  typeof value === "object" &&
  value !== null &&
  ["x", "y", "w", "h"].every((key) => Number.isInteger((value as Record<string, unknown>)[key]));

const source = process.argv[2];
if (source === undefined) throw new Error("用法：node scripts/pet-sprites.ts <美术目录>");
const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "src", "renderer", "src", "pet", "sprites");
rmSync(target, { recursive: true, force: true });

const entries: string[] = [];
for (const species of speciesList) {
  const from = path.join(source, species, "48");
  const meta = JSON.parse(readFileSync(path.join(from, "meta.json"), "utf8")) as Record<
    string,
    { eyes: unknown; head: unknown }
  >;
  mkdirSync(path.join(target, species), { recursive: true });
  const lines: string[] = [];
  for (const name of SPRITE_NAMES) {
    const entry = meta[name];
    if (entry === undefined) throw new Error(`${species}/${name}：meta.json 里没有`);
    const eyes = entry.eyes;
    if (name === "egg" ? eyes !== null : !(Array.isArray(eyes) && eyes.length === 2 && eyes.every(isBox)))
      throw new Error(
        `${species}/${name}：眼睛应该${name === "egg" ? "没有" : "恰好两只"}，实际是 ${JSON.stringify(eyes)}`,
      );
    const head = entry.head as { x: number; y: number };
    if (!Number.isInteger(head.x) || !Number.isInteger(head.y)) throw new Error(`${species}/${name}：头顶坐标不对`);
    copyFileSync(path.join(from, `${name}.png`), path.join(target, species, `${name}.png`));
    const box = (b: Box) => `{ x: ${b.x}, y: ${b.y}, w: ${b.w}, h: ${b.h} }`;
    const eyesText = eyes === null ? "null" : `[${(eyes as Box[]).map(box).join(", ")}]`;
    lines.push(`    "${name}": { eyes: ${eyesText}, head: { x: ${head.x}, y: ${head.y} } },`);
  }
  entries.push(`  ${species}: {\n${lines.join("\n")}\n  },`);
}

writeFileSync(
  path.join(root, "src", "renderer", "src", "pet", "sprite-meta.ts"),
  [
    "// 生成的文件（node scripts/pet-sprites.ts <美术目录>），不要手改：每张像素画的眼睛方框和头顶（48×48 格坐标）。",
    'import type { Species } from "../../../shared/pet/model.ts";',
    'import type { SpriteMeta, SpriteName } from "./sprites.ts";',
    "",
    "export const spriteMeta: Readonly<Record<Species, Readonly<Record<SpriteName, SpriteMeta>>>> = {",
    ...entries,
    "};",
    "",
  ].join("\n"),
);
console.log(`${speciesList.length} 个物种 × ${SPRITE_NAMES.length} 张 → ${path.relative(root, target)}`);
