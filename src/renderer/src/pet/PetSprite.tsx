// 宠物的像素画（docs/design/spec/4.32-pet.md）：物种 × 阶段 × 路线的 48×48 PNG（sprites.ts）+ 眼睛表情 + 帽子 + 状态小标记
// + 属性气势（elements.ts：粒子、光圈）+ 进化动画。坐标单位是像素格；viewBox 在 48×48 的画布四周留出帽子、标记、粒子的位置。
// 眼睛画在 PNG 里：表情、眨眼、看光标时先用眼睛旁边的脸色盖住眼睛方框（sprite-meta.ts），再在上面画出这一刻的眼睛。
// 动画全在 pet.css，减少动效时停在第一帧。颜色是物种自己的固定色，状态标记用主题的状态色。
import { memo, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import {
  speciesElement,
  type Bones,
  type Branch,
  type Mood,
  type PetGaze,
  type Stage,
} from "../../../shared/pet/model.ts";
import { auraOf, elementLooks } from "./elements.ts";
import { hatSprites, type HatDef } from "./hats.ts";
import { SPRITE_SIZE, spriteOf, type EyeBox } from "./sprites.ts";

/** viewBox：左右各留 6 格，上面留 14 格（帽子、标记），下面不留（站在底边）。宠物窗口里画成 3 像素一格。 */
const VIEW = { x: -6, y: -14, width: SPRITE_SIZE + 12, height: SPRITE_SIZE + 14 } as const;

/** 这一形态戴的帽子（蛋不戴）。 */
function hatOf(bones: Bones, stage: Stage): HatDef | null {
  return bones.hat === "none" || stage === "egg" ? null : hatSprites[bones.hat];
}

/** 帽子顶边的 y（格）：帽子和宠物同一种格子大小，底边压在头顶那行（光环再往上浮 lift 格）。 */
const hatTop = (headY: number, hat: HatDef) => headY - (hat.rows.length - 1 + hat.lift);

/**
 * 这一形态头顶（戴帽子时是帽子顶）在宠物框里的高度（0 = 框顶，1 = 框底）。气泡、爱心、彩纸、升级提示按它贴着放
 * （PetApp 的 --pet-head）：蛋和幼年个子矮，按框顶放会离得很远。
 */
export function headRatio(bones: Bones, stage: Stage, branch: Branch | null): number {
  const headY = spriteOf(bones.species, stage, branch).head.y;
  const hat = hatOf(bones, stage);
  return ((hat === null ? headY : hatTop(headY, hat)) - VIEW.y) / VIEW.height;
}

/** 不透明像素的外框（格，右、下不含）。 */
interface CellBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 能点的范围比宠物身子（加帽子）四周多出的格数：2 格 = 窗口里 6px。 */
const HIT_MARGIN = 2;

const opaqueCache = new Map<string, CellBox>();

function opaqueBounds(image: HTMLImageElement): CellBox {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const box = { left: SPRITE_SIZE, top: SPRITE_SIZE, right: 0, bottom: 0 };
  for (let y = 0; y < SPRITE_SIZE; y += 1)
    for (let x = 0; x < SPRITE_SIZE; x += 1) {
      if (data[(y * SPRITE_SIZE + x) * 4 + 3]! < 128) continue;
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x + 1);
      box.bottom = Math.max(box.bottom, y + 1);
    }
  return box.right === 0 ? { left: 0, top: 0, right: SPRITE_SIZE, bottom: SPRITE_SIZE } : box;
}

/**
 * 宠物能点（接住鼠标）的范围在宠物框里的位置（百分比）：身子的不透明像素加帽子的外框，四周再多 HIT_MARGIN 格。
 * 宠物框为了帽子、标记、粒子四周留了很多透明的地方，整个框都接住鼠标会挡住宠物旁边的窗口（2026-11-26 所有者提）。
 * PNG 还没读到时先按整张 48×48 算。
 */
export function usePetHitBox(bones: Bones, stage: Stage, branch: Branch | null): CSSProperties {
  const sprite = spriteOf(bones.species, stage, branch);
  const [, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (opaqueCache.has(sprite.url)) return;
    let live = true;
    const image = new Image();
    image.addEventListener("load", () => {
      opaqueCache.set(sprite.url, opaqueBounds(image));
      if (live) setLoaded(sprite.url);
    });
    image.src = sprite.url;
    return () => {
      live = false;
    };
  }, [sprite.url]);
  const body = opaqueCache.get(sprite.url) ?? { left: 0, top: 0, right: SPRITE_SIZE, bottom: SPRITE_SIZE };
  const hat = hatOf(bones, stage);
  // 帽子和 PetSprite 里画的位置一致：左边从头顶 x 往左 hatWidth / 2（取整）开始，宽 hatWidth 格。
  const hatWidth = hat === null ? 0 : Math.max(...hat.rows.map((row) => row.length));
  const hatLeft = sprite.head.x - Math.floor(hatWidth / 2);
  const box =
    hat === null
      ? body
      : {
          left: Math.min(body.left, hatLeft),
          top: Math.min(body.top, hatTop(sprite.head.y, hat)),
          right: Math.max(body.right, hatLeft + hatWidth),
          bottom: body.bottom,
        };
  const left = Math.max(VIEW.x, box.left - HIT_MARGIN);
  const top = Math.max(VIEW.y, box.top - HIT_MARGIN);
  const right = Math.min(VIEW.x + VIEW.width, box.right + HIT_MARGIN);
  const bottom = Math.min(VIEW.y + VIEW.height, box.bottom + HIT_MARGIN);
  const pct = (value: number, size: number) => `${(value / size) * 100}%`;
  return {
    left: pct(left - VIEW.x, VIEW.width),
    top: pct(top - VIEW.y, VIEW.height),
    width: pct(right - left, VIEW.width),
    height: pct(bottom - top, VIEW.height),
  };
}

/** 宠物窗口自己加的一阵子表情：被摸（开心）、被拖着（><）。 */
export type PetFace = "happy" | "dragged" | null;

type EyeShape = "open" | "closed" | "happy" | "cross" | "squint";

/** 眼睛方框盖什么颜色（眼睛周围最多的那种脸色）、用什么颜色画（眼睛里最深的那种）。 */
interface EyeColors {
  lid: string;
  ink: string;
}

const eyeColorCache = new Map<string, readonly EyeColors[]>();

function hex(data: Uint8ClampedArray, index: number): string {
  return `#${[data[index]!, data[index + 1]!, data[index + 2]!].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** 从 PNG 里取每只眼睛的脸色和墨色。 */
function sampleEyeColors(image: HTMLImageElement, eyes: readonly EyeBox[]): EyeColors[] {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const at = (x: number, y: number) => (y * SPRITE_SIZE + x) * 4;
  const luma = (index: number) => data[index]! * 0.3 + data[index + 1]! * 0.59 + data[index + 2]! * 0.11;
  return eyes.map((box) => {
    const counts = new Map<string, number>();
    for (let y = box.y - 1; y <= box.y + box.h; y += 1)
      for (let x = box.x - 1; x <= box.x + box.w; x += 1) {
        const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
        if (inside || x < 0 || y < 0 || x >= SPRITE_SIZE || y >= SPRITE_SIZE) continue;
        const index = at(x, y);
        if (data[index + 3]! < 128 || luma(index) < 60) continue;
        const color = hex(data, index);
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
    let ink = at(box.x, box.y);
    for (let y = box.y; y < box.y + box.h; y += 1)
      for (let x = box.x; x < box.x + box.w; x += 1) if (luma(at(x, y)) < luma(ink)) ink = at(x, y);
    const lid = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#ffffff";
    return { lid, ink: hex(data, ink) };
  });
}

/** PNG 加载好后取眼睛颜色（同一张图只取一次）；取到之前返回 null，这时只显示 PNG 本身的眼睛。 */
function useEyeColors(url: string, eyes: readonly EyeBox[] | null): readonly EyeColors[] | null {
  // 记着是哪张图的颜色：换图后、新图取到之前不拿旧图的颜色去盖新图的眼睛。
  const [loaded, setLoaded] = useState<{ url: string; colors: readonly EyeColors[] } | null>(null);
  useEffect(() => {
    if (eyes === null || eyeColorCache.has(url)) return;
    let live = true;
    const image = new Image();
    image.addEventListener("load", () => {
      const colors = sampleEyeColors(image, eyes);
      eyeColorCache.set(url, colors);
      if (live) setLoaded({ url, colors });
    });
    image.src = url;
    return () => {
      live = false;
    };
  }, [url, eyes]);
  if (eyes === null) return null;
  return eyeColorCache.get(url) ?? (loaded?.url === url ? loaded.colors : null);
}

/** 一只眼睛的某种形状，画在方框里（left = 画面左边那只，>< 的朝向不同）。 */
function eyePixels(box: EyeBox, shape: Exclude<EyeShape, "open">, left: boolean): [number, number][] {
  const { x, y, w, h } = box;
  const mid = y + Math.floor(h / 2);
  const cells: [number, number][] = [];
  switch (shape) {
    case "closed":
      for (let i = 0; i < w; i += 1) cells.push([x + i, mid]);
      break;
    case "happy":
      for (let i = 0; i < w; i += 1) cells.push([x + i, mid - Math.min(i, w - 1 - i)]);
      break;
    case "cross": {
      const n = Math.min(w, h);
      const top = y + Math.floor((h - n) / 2);
      for (let i = 0; i < n; i += 1) cells.push([x + i, top + i], [x + n - 1 - i, top + i]);
      break;
    }
    case "squint":
      for (let r = 0; r < h; r += 1) {
        const step = Math.min(r, h - 1 - r, w - 1);
        cells.push([left ? x + step : x + w - 1 - step, y + r]);
      }
      break;
  }
  return cells;
}

/** 盖住原来的眼睛、画上新形状。 */
function DrawnEye({
  box,
  colors,
  shape,
  left,
}: {
  box: EyeBox;
  colors: EyeColors;
  shape: Exclude<EyeShape, "open">;
  left: boolean;
}) {
  return (
    <>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={colors.lid} />
      {eyePixels(box, shape, left).map(([cx, cy]) => (
        <rect key={`${cx}-${cy}`} x={cx} y={cy} width={1} height={1} fill={colors.ink} />
      ))}
    </>
  );
}

/** 看向光标：盖住原来的眼睛，把 PNG 里那块眼睛整块挪一格。 */
function LookingEye({
  box,
  colors,
  url,
  gaze,
  clipId,
}: {
  box: EyeBox;
  colors: EyeColors;
  url: string;
  gaze: PetGaze;
  clipId: string;
}) {
  return (
    <>
      <clipPath id={clipId}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} />
      </clipPath>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={colors.lid} />
      <g transform={`translate(${gaze.x} ${gaze.y})`}>
        <image href={url} width={SPRITE_SIZE} height={SPRITE_SIZE} clipPath={`url(#${clipId})`} className="pet-png" />
      </g>
    </>
  );
}

function pixelArt(rows: readonly string[], palette: Readonly<Record<string, string>>): ReactNode {
  return rows.flatMap((row, y) =>
    [...row].map((char, x) =>
      char === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[char]} />,
    ),
  );
}

/** 头上的状态小标记（坐标按 3 格一点画）：等你 = "!"，跑着 = 汗珠，出错 = 小乌云，刚跑完 = 两颗星，睡着 = Z。 */
function Mark({ mood }: { mood: Mood }) {
  switch (mood) {
    case "waiting":
      return (
        <g className="pet-mark" fill="var(--st-waiting)">
          <rect x={0} y={-1} width={1} height={3} />
          <rect x={0} y={2.5} width={1} height={1} />
        </g>
      );
    case "running":
      return (
        <g className="pet-mark pet-mark-dots" fill="#6ec6ff">
          {[0, 1, 2].map((index) => (
            <rect key={index} x={index * 1.1 - 1} y={2.2} width={0.7} height={0.7} />
          ))}
        </g>
      );
    case "error":
      return (
        <g className="pet-mark">
          <rect x={-1} y={0} width={3} height={1} fill="#8d8d99" />
          <rect x={-1.5} y={0.6} width={4} height={1} fill="#a9a9b4" />
          <rect x={0.3} y={2} width={0.4} height={0.9} fill="var(--st-error)" />
        </g>
      );
    case "done":
      return (
        <g className="pet-mark" fill="#ffd23f">
          {[
            [0, 0],
            [-7, 1],
          ].map(([sx, sy]) => (
            <g key={sx}>
              <rect x={sx! + 0.33} y={sy!} width={0.34} height={1} />
              <rect x={sx!} y={sy! + 0.33} width={1} height={0.34} />
            </g>
          ))}
        </g>
      );
    case "sleeping":
      return (
        <g className="pet-mark pet-mark-sleep">
          <g transform="scale(0.67)">{pixelArt(["oooo", "..o.", ".o..", "oooo"], { o: "#c9d6ff" })}</g>
          <g transform="translate(2.4 -2.2) scale(0.45)">
            {pixelArt(["oooo", "..o.", ".o..", "oooo"], { o: "#c9d6ff" })}
          </g>
        </g>
      );
    case "idle":
      return null;
  }
}

interface PetSpriteProps {
  bones: Bones;
  stage: Stage;
  branch: Branch | null;
  mood: Mood;
  level: number;
  label: string;
  gaze: PetGaze;
  face: PetFace;
  /** 正在进化：从哪个阶段、路线变过来（pet.css 的进化动画，约 2 秒）。 */
  evolvingFrom: { stage: Stage; branch: Branch | null } | null;
}

function eyeShape(mood: Mood, face: PetFace): EyeShape {
  if (face === "dragged") return "squint";
  if (face === "happy" || mood === "done") return "happy";
  if (mood === "error") return "cross";
  if (mood === "sleeping") return "closed";
  return "open";
}

export const PetSprite = memo(function PetSprite({
  bones,
  stage,
  branch,
  mood,
  level,
  label,
  gaze,
  face,
  evolvingFrom,
}: PetSpriteProps) {
  const id = useId();
  const sprite = spriteOf(bones.species, stage, branch);
  const colors = useEyeColors(sprite.url, sprite.eyes);
  const element = elementLooks[speciesElement[bones.species]];
  const aura = auraOf(level);
  const shape = eyeShape(mood, face);
  const looking = shape === "open" && (gaze.x !== 0 || gaze.y !== 0);
  const blinks = shape === "open" && (mood === "idle" || mood === "running");
  const hat = hatOf(bones, stage);
  /** 帽子左半边的宽度（格）：帽子按头顶的 x 居中。 */
  const hatHalf = hat === null ? 0 : Math.floor(Math.max(...hat.rows.map((row) => row.length)) / 2);
  const eyes =
    colors === null || sprite.eyes === null ? [] : sprite.eyes.map((box, index) => ({ box, colors: colors[index]! }));
  const from = evolvingFrom === null ? null : spriteOf(bones.species, evolvingFrom.stage, evolvingFrom.branch);
  return (
    <svg
      className="pet-sprite"
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      data-mood={mood}
      data-stage={stage}
      data-branch={branch ?? undefined}
      data-shiny={bones.shiny || undefined}
      data-evolving={from !== null || undefined}
      data-testid="pet-sprite"
      style={{ "--pet-glow": element.glow, "--pet-glow-strength": aura.glow } as CSSProperties}
    >
      <g className="pet-art" data-glow={aura.glow > 0 || undefined}>
        <g className="pet-pixels">
          <image href={sprite.url} width={SPRITE_SIZE} height={SPRITE_SIZE} className="pet-png" />
          {eyes.length > 0 &&
            (shape !== "open" ? (
              <g data-eyes={shape}>
                {eyes.map(({ box, colors: eyeColors }, index) => (
                  <DrawnEye key={index} box={box} colors={eyeColors} shape={shape} left={index === 0} />
                ))}
              </g>
            ) : (
              <>
                {looking && (
                  <g className="pet-eyes-open" data-eyes="looking">
                    {eyes.map(({ box, colors: eyeColors }, index) => (
                      <LookingEye
                        key={index}
                        box={box}
                        colors={eyeColors}
                        url={sprite.url}
                        gaze={gaze}
                        clipId={`${id}-eye${index}`}
                      />
                    ))}
                  </g>
                )}
                {blinks && (
                  <g className="pet-eyes-blink">
                    {eyes.map(({ box, colors: eyeColors }, index) => (
                      <DrawnEye key={index} box={box} colors={eyeColors} shape="closed" left={index === 0} />
                    ))}
                  </g>
                )}
              </>
            ))}
          {hat !== null && (
            <g transform={`translate(${sprite.head.x - hatHalf} ${hatTop(sprite.head.y, hat)})`}>
              {pixelArt(hat.rows, hat.palette)}
            </g>
          )}
        </g>
      </g>
      {Array.from({ length: aura.particles }, (_, index) => (
        <g
          key={index}
          className="pet-particle"
          style={{ "--i": index } as CSSProperties}
          transform={`translate(${6 + ((index * 29) % 36)} ${SPRITE_SIZE - 10 - ((index * 17) % 18)})`}
        >
          {pixelArt(element.particle.rows, element.particle.palette)}
        </g>
      ))}
      {from !== null && (
        <g className="pet-evolve" aria-hidden="true">
          <image href={from.url} width={SPRITE_SIZE} height={SPRITE_SIZE} className="pet-png pet-evolve-from" />
          <image href={sprite.url} width={SPRITE_SIZE} height={SPRITE_SIZE} className="pet-png pet-evolve-to" />
        </g>
      )}
      {/* 标记贴在头（戴帽子时是帽子）的右上方；头高的形态（觉醒）最高放到 -7，"!" 和 Z 的顶都还在画布里。 */}
      <g
        transform={`translate(${sprite.head.x + Math.max(8, hatHalf + 3)} ${Math.max((hat === null ? sprite.head.y : hatTop(sprite.head.y, hat)) - 6, -7)}) scale(3)`}
      >
        <Mark mood={mood} />
      </g>
    </svg>
  );
});
