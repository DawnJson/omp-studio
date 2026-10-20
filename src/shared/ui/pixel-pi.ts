// omp-studio 的标志：omp 终端启动画面里的块字符 π（omp 18.12.2 实测），身后错开一个像素多一层同色淡影
// （"层叠"，仓库所有者 2026-10-20 选定：终端里的 π 只有一层，到了桌面上多一层）。
// 新任务页的大标志（renderer PixelLogo）、顶栏小标志（renderer Logo）、应用图标和托盘图标（scripts/make-icons.ts）共用这份数据。
// 坐标单位是"像素"：一格终端字符宽 1、高 2；"%" 是 ▒，画成半像素棋盘格。颜色是 omp 的原值（与主题无关）。

export interface PiCell {
  /** 左上角 x（像素） */
  x: number;
  /** 左上角 y（像素） */
  y: number;
  color: string;
  /** "#" 实块（1×2），"%" ▒（1×2 的半像素棋盘格） */
  kind: "#" | "%";
}

/** π 的 5 行 12 列（每行一格 = 2 个像素高）：null = 空。颜色逐格取自 omp 的输出。 */
const rows: readonly (readonly ([string, "#" | "%"] | null)[])[] = [
  [
    ["#f84fcc", "#"],
    ["#ef51d0", "#"],
    ["#e652d3", "#"],
    ["#dc54d7", "#"],
    ["#d356db", "#"],
    ["#ca58de", "#"],
    ["#c159e2", "#"],
    ["#b85be5", "#"],
    ["#af5de9", "#"],
    ["#a55fed", "#"],
    ["#9c60f0", "#"],
    ["#9362f4", "#"],
  ],
  [null, null, null, ["#c359e1", "#"], ["#ba5be5", "#"], null, null, ["#9e60ef", "#"], ["#9562f3", "#"]],
  [null, null, null, ["#aa5eeb", "#"], ["#a15fef", "#"], null, null, ["#7f72f2", "#"], ["#727ef0", "#"]],
  [null, null, null, ["#9065f4", "%"], ["#8270f2", "%"], null, null, ["#5a91ee", "#"], ["#4d9cec", "#"]],
  [null, null, null, null, null, null, null, ["#35afea", "#"], ["#28bae8", "#"]],
];

export const piCells: readonly PiCell[] = rows.flatMap((row, rowIndex) =>
  row.flatMap((cell, column) => (cell === null ? [] : [{ x: column, y: rowIndex * 2, color: cell[0], kind: cell[1] }])),
);

/** π 本身 12×10；加上往右下错开 1 像素的淡影，整个标志 13×11。 */
export const piWidth = 12;
export const piHeight = 10;
export const shadow = { dx: 1, dy: 1, opacity: 0.32 } as const;
export const markWidth = piWidth + shadow.dx;
export const markHeight = piHeight + shadow.dy;

/** 一格画成哪些矩形（x、y、宽、高，像素）：实块一整块，▒ 是 4 个半像素。 */
export function cellRects(cell: PiCell): [number, number, number, number][] {
  if (cell.kind === "#") return [[cell.x, cell.y, 1, 2]];
  return [0, 0.5, 1, 1.5].map((dy) => [cell.x + (dy % 1), cell.y + dy, 0.5, 0.5]);
}
