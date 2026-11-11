// 等级装饰（docs/design/spec/4.32-pet.md「装饰」）：完全体（Lv30）以后每 10 级解锁一件，画在精灵四周留出的边上，攒着不换掉。
// 字符同 sprites.ts：'.' 透明，其余按 palette 上色。x / y 是左上角在 16×16 画布里的格子坐标（可以落在 viewBox 留的边上）。
// behind = 画在身体后面（草丛：只从身体没盖住的地方露出来）。className 给 pet.css 挂小动画。
export interface DecorDef {
  level: number;
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
  x: number;
  y: number;
  behind?: boolean;
  className?: string;
}

export const decorations: readonly DecorDef[] = [
  // Lv40：左脚边一朵小花。
  {
    level: 40,
    rows: [".p.", "pyp", ".g.", ".g."],
    palette: { p: "#ff7eb6", y: "#ffd23f", g: "#4caf50" },
    x: -3,
    y: 12,
  },
  // Lv50：右脚边一个小蘑菇。
  { level: 50, rows: [".r.", "rwr", ".w."], palette: { r: "#e53935", w: "#f5f0e6" }, x: 16, y: 13 },
  // Lv60：左上方一只蝴蝶，慢慢上下飘。
  {
    level: 60,
    rows: ["bkb", "b.b"],
    palette: { b: "#6ec6ff", k: "#2e2e38" },
    x: -3,
    y: -6,
    className: "pet-decor-float",
  },
  // Lv70：脚下一片草丛（身体后面）。
  {
    level: 70,
    rows: ["..g.....g....g..", ".ggg..g.ggg..ggg"],
    palette: { g: "#5fb760" },
    x: 0,
    y: 14,
    behind: true,
  },
  // Lv80：左边一颗一闪一闪的星星。
  {
    level: 80,
    rows: [".s.", "sss", ".s."],
    palette: { s: "#ffd23f" },
    x: -3,
    y: -2,
    className: "pet-decor-twinkle",
  },
];

/** Lv90：身体外面描一圈金边；Lv99（满级）金边换成会流动的彩虹色，属性卡名字前加 ★。 */
export const OUTLINE_LEVEL = 90;
export const OUTLINE_COLOR = "#ffd23f";
