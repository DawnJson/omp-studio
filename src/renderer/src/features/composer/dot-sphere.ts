// "正在思考"的立体点阵球：3×3×3 魔方去掉中心的 26 个格点，各自推到球面上；
// 像拧魔方一样，每次随机把一层（沿 x/y/z 的某一片）转 90°，转完接着拧下一层，整个球同时慢慢自转。
// 90° 转动把格点映射回格点，所以拧完之后点仍落在这 26 个位置上，只是互换了。

type Vec = [number, number, number];
type Axis = 0 | 1 | 2;

interface Move {
  axis: Axis;
  layer: -1 | 0 | 1;
  dir: 1 | -1;
  start: number;
}

/** 一次转动的时长、两次转动之间的停顿、整球自转一圈的时长（毫秒）。 */
const turnMs = 420;
const pauseMs = 140;
const spinMs = 7000;
/** 视线俯角：略微从上往下看，前后层才分得开。 */
const tilt = (-24 * Math.PI) / 180;
/** 球半径，以 16×16 的 viewBox 为单位。 */
const radius = 6.2;

export const dotCount = 26;

/** 一个点画出来的样子：viewBox 里的位置，半径和不透明度随远近变化（近大远小、近实远淡）。 */
export interface DotFrame {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

function lattice(): Vec[] {
  const points: Vec[] = [];
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x !== 0 || y !== 0 || z !== 0) points.push([x, y, z]);
  return points;
}

function rotate(v: Vec, axis: Axis, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = v;
  if (axis === 0) return [x, y * c - z * s, y * s + z * c];
  if (axis === 1) return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class DotSphere {
  #points = lattice();
  #move: Move | null = null;
  #lastAxis: Axis | null = null;
  #nextAt = 0;
  #random: () => number;

  constructor(random: () => number = Math.random) {
    this.#random = random;
  }

  /** 时间 `now`（毫秒，单调递增）时每个点的样子；顺序固定，和 `dotCount` 个元素一一对应。 */
  frame(now: number): DotFrame[] {
    this.#advance(now);
    const move = this.#move;
    const angle = move === null ? 0 : easeInOut(Math.min(1, (now - move.start) / turnMs)) * (Math.PI / 2) * move.dir;
    const spin = ((now % spinMs) / spinMs) * Math.PI * 2;
    return this.#points.map((point) => {
      let v = point;
      if (move !== null && point[move.axis] === move.layer) v = rotate(v, move.axis, angle);
      const length = Math.hypot(v[0], v[1], v[2]);
      v = [(v[0] / length) * radius, (v[1] / length) * radius, (v[2] / length) * radius];
      v = rotate(rotate(v, 1, spin), 0, tilt);
      const depth = (v[2] + radius) / (2 * radius);
      return { x: 8 + v[0], y: 8 - v[1], r: 0.45 + 0.6 * depth, opacity: 0.15 + 0.85 * depth ** 1.5 };
    });
  }

  #advance(now: number): void {
    const move = this.#move;
    if (move !== null && now - move.start >= turnMs) {
      // 这一层转到位：格点换成转完之后的整数坐标。
      this.#points = this.#points.map((point) =>
        point[move.axis] === move.layer
          ? (rotate(point, move.axis, (Math.PI / 2) * move.dir).map(Math.round) as Vec)
          : point,
      );
      this.#move = null;
      this.#lastAxis = move.axis;
      this.#nextAt = now + pauseMs;
    }
    if (this.#move === null && now >= this.#nextAt) this.#move = this.#nextMove(now);
  }

  /** 随机挑一层，不和上一次拧同一根轴（否则看起来像只拧了一下又拧回去）。 */
  #nextMove(now: number): Move {
    const axes = ([0, 1, 2] as const).filter((axis) => axis !== this.#lastAxis);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(this.#random() * items.length)] as T;
    return { axis: pick(axes), layer: pick([-1, 0, 1] as const), dir: pick([1, -1] as const), start: now };
  }
}
