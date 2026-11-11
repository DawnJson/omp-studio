// 宠物的像素画（docs/design/spec/4.32-pet.md）：物种 × 阶段的底图（shared/pet/sprites.ts）+ 眼睛表情 + 帽子 + 状态小标记。
// 坐标单位是像素格；外层 viewBox 在 16×16 的画布四周留出帽子和标记的位置。动画全在 pet.css（按 data-mood 切换，3 帧 steps），
// 减少动效时停在第一帧。颜色是物种自己的固定色，状态标记用主题的状态色。
import { memo, type ReactNode } from "react";
import type { Bones, EyeStyle, Mood, Stage } from "../../../shared/pet/model.ts";
import { SPRITE_SIZE, sprites, type SpriteDef } from "../../../shared/pet/sprites.ts";
import { hatSprites } from "./hats.ts";

/** viewBox：左右各留 3 格，上面留 7 格（帽子、标记），下面不留（站在底边）。 */
export const VIEW = { x: -3, y: -7, width: SPRITE_SIZE + 6, height: SPRITE_SIZE + 7 } as const;
const EYE_COLOR = "#1b1424";

interface Cell {
  x: number;
  y: number;
  char: string;
}

function cells(rows: readonly string[]): Cell[] {
  return rows.flatMap((row, y) => [...row].map((char, x) => ({ x, y, char }))).filter((cell) => cell.char !== ".");
}

/** 头顶：最上面一行有像素的行，以及那一行的水平中点。 */
function headTop(sprite: SpriteDef): { y: number; centerX: number } {
  const y = sprite.rows.findIndex((row) => /[^.]/.test(row));
  const row = sprite.rows[y]!;
  const first = row.search(/[^.]/);
  const last = row.replace(/\.+$/, "").length - 1;
  return { y, centerX: (first + last + 1) / 2 };
}

function Pixels({
  list,
  palette,
  dx = 0,
  dy = 0,
}: {
  list: Cell[];
  palette: Readonly<Record<string, string>>;
  dx?: number;
  dy?: number;
}) {
  return list.map((cell) => (
    <rect key={`${cell.x}-${cell.y}`} x={cell.x + dx} y={cell.y + dy} width={1} height={1} fill={palette[cell.char]} />
  ));
}

/** 睁眼：按骨里的眼睛样式画在这一格里。 */
function openEye(x: number, y: number, style: EyeStyle): ReactNode {
  switch (style) {
    case "dot":
      return <rect x={x} y={y} width={1} height={1} fill={EYE_COLOR} />;
    case "tall":
      return <rect x={x + 0.15} y={y - 0.35} width={0.7} height={1.35} fill={EYE_COLOR} />;
    case "sleepy":
      return <rect x={x} y={y + 0.45} width={1} height={0.55} fill={EYE_COLOR} />;
    case "spark":
      return (
        <>
          <rect x={x} y={y} width={1} height={1} fill={EYE_COLOR} />
          <rect x={x + 0.12} y={y + 0.12} width={0.36} height={0.36} fill="#ffffff" />
        </>
      );
  }
}

/** 某个表情下一只眼睛的样子；blink = 闭眼帧（只在 idle / running 用，见 pet.css 的眨眼动画）。 */
function eye(x: number, y: number, mood: Mood, style: EyeStyle, blink: boolean): ReactNode {
  if (mood === "error")
    return (
      <g stroke={EYE_COLOR} strokeWidth={0.28} strokeLinecap="square">
        <line x1={x + 0.1} y1={y + 0.1} x2={x + 0.9} y2={y + 0.9} />
        <line x1={x + 0.9} y1={y + 0.1} x2={x + 0.1} y2={y + 0.9} />
      </g>
    );
  if (mood === "done")
    return (
      <polyline
        points={`${x},${y + 0.85} ${x + 0.5},${y + 0.25} ${x + 1},${y + 0.85}`}
        fill="none"
        stroke={EYE_COLOR}
        strokeWidth={0.3}
      />
    );
  if (blink) return <rect x={x} y={y + 0.4} width={1} height={0.25} fill={EYE_COLOR} />;
  if (mood === "waiting")
    return (
      <>
        <rect x={x + 0.1} y={y - 0.3} width={0.8} height={1.3} fill={EYE_COLOR} />
        <rect x={x + 0.2} y={y - 0.15} width={0.3} height={0.3} fill="#ffffff" />
      </>
    );
  return openEye(x, y, style);
}

/** 头上的状态小标记：等你 = "!"，跑着 = 汗珠，出错 = 小乌云，刚跑完 = 两颗星。 */
function Mark({ mood, top, right }: { mood: Mood; top: number; right: number }) {
  const x = right + 1;
  const y = top - 3;
  switch (mood) {
    case "waiting":
      return (
        <g className="pet-mark" fill="var(--st-waiting)">
          <rect x={x} y={y - 1} width={1} height={3} />
          <rect x={x} y={y + 2.5} width={1} height={1} />
        </g>
      );
    case "running":
      return (
        <g className="pet-mark" fill="#6ec6ff">
          <rect x={x} y={y + 2} width={1} height={1} />
          <rect x={x + 0.25} y={y + 1.4} width={0.5} height={0.6} />
        </g>
      );
    case "error":
      return (
        <g className="pet-mark">
          <rect x={x - 1} y={y} width={3} height={1} fill="#8d8d99" />
          <rect x={x - 1.5} y={y + 0.6} width={4} height={1} fill="#a9a9b4" />
          <rect x={x + 0.3} y={y + 2} width={0.4} height={0.9} fill="var(--st-error)" />
        </g>
      );
    case "done":
      return (
        <g className="pet-mark" fill="#ffd23f">
          {[
            [x, y],
            [x - SPRITE_SIZE / 2 - 2, y + 1],
          ].map(([sx, sy]) => (
            <g key={`${sx}`}>
              <rect x={sx! + 0.33} y={sy!} width={0.34} height={1} />
              <rect x={sx!} y={sy! + 0.33} width={1} height={0.34} />
            </g>
          ))}
        </g>
      );
    case "idle":
      return null;
  }
}

interface PetSpriteProps {
  bones: Bones;
  stage: Stage;
  mood: Mood;
  label: string;
}

export const PetSprite = memo(function PetSprite({ bones, stage, mood, label }: PetSpriteProps) {
  const sprite = sprites[bones.species][stage];
  const all = cells(sprite.rows);
  const body = all.filter((cell) => cell.char !== "e");
  const eyes = all.filter((cell) => cell.char === "e");
  const head = headTop(sprite);
  const rightEdge = Math.max(...body.map((cell) => cell.x));
  // 眼睛格本身没有底色：铺上左边那格的颜色（闭眼、半睁时露出来的是脸）。
  const eyeBase = (cell: Cell) => {
    const left = sprite.rows[cell.y]![cell.x - 1];
    return sprite.palette[(left === undefined || left === "." || left === "e" ? "a" : left) as "a"];
  };
  const hat = bones.hat === "none" || stage === "egg" ? null : hatSprites[bones.hat];
  const hatWidth = hat ? Math.max(...hat.rows.map((row) => row.length)) : 0;
  return (
    <svg
      className="pet-sprite"
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      data-mood={mood}
      data-stage={stage}
      data-shiny={bones.shiny || undefined}
      data-testid="pet-sprite"
    >
      <g className="pet-body">
        <g className="pet-pixels">
          <Pixels list={body} palette={sprite.palette} />
          {eyes.map((cell) => (
            <rect key={`b${cell.x}`} x={cell.x} y={cell.y} width={1} height={1} fill={eyeBase(cell)} />
          ))}
          {hat && (
            <Pixels
              list={cells(hat.rows)}
              palette={hat.palette}
              dx={Math.round(head.centerX - hatWidth / 2)}
              dy={head.y - hat.rows.length + 1 - hat.lift}
            />
          )}
        </g>
        <g className="pet-eyes-open">
          {eyes.map((cell) => (
            <g key={cell.x}>{eye(cell.x, cell.y, mood, bones.eye, false)}</g>
          ))}
        </g>
        <g className="pet-eyes-blink">
          {eyes.map((cell) => (
            <g key={cell.x}>{eye(cell.x, cell.y, mood, bones.eye, true)}</g>
          ))}
        </g>
      </g>
      <Mark mood={mood} top={head.y} right={rightEdge} />
    </svg>
  );
});
