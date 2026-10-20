// TSP 的命名图标（规范 Data/icon 的 207 个名字和别名表）→ 本地线性图标集（16×16、stroke 取 currentColor）。
// 规范里的名字没有对应画法的，在 SUBSTITUTE 里指向意思最近的一个；完全不认识的名字不画（规范：未知名字画空盒）。
import { memo } from "react";

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const FILE = "M4.5 2.5h4l3 3v8h-7v-11ZM8.5 2.5v3h3";
const EYE =
  "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z";
const RAYS = "M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1";
const LAYERS = "M8 2.5 14 6 8 9.5 2 6 8 2.5ZM2 9l6 3.5L14 9";

/** 画法：每个名字一串 path 数据。 */
const PATHS: Record<string, readonly string[]> = {
  check: ["m3.5 8.5 3 3 6-7"],
  x: ["m4 4 8 8M12 4l-8 8"],
  "x-circle": [circle(8, 8, 5.5), "m6 6 4 4m0-4-4 4"],
  warn: ["M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.2v.1"],
  info: [circle(8, 8, 5.5), "M8 7.5V11M8 5.2v.1"],
  help: [circle(8, 8, 5.5), "M6.3 6.3a1.8 1.8 0 1 1 2.5 1.7c-.5.3-.8.6-.8 1.2M8 11.3v.1"],
  clock: [circle(8, 8, 5.5), "M8 5v3.2l2 1.3"],
  timer: [circle(8, 9, 5), "M8 6.5V9l1.6 1M6.5 2h3"],
  "slash-circle": [circle(8, 8, 5.5), "m4.2 11.8 7.6-7.6"],
  stop: ["M4.5 4.5h7v7h-7z"],
  play: ["M5 3.5v9l7-4.5z"],
  pause: ["M5.5 3.5v9M10.5 3.5v9"],
  plus: ["M8 3.5v9M3.5 8h9"],
  minus: ["M3.5 8h9"],
  chev: ["M3.5 6 8 10.5 12.5 6"],
  "chev-r": ["M6 3.5 10.5 8 6 12.5"],
  "chev-up": ["M3.5 10 8 5.5 12.5 10"],
  "arrow-up": ["M8 13V3.5M4 7.5l4-4 4 4"],
  "arrow-down": ["M8 3v9.5M4 8.5l4 4 4-4"],
  "arrow-left": ["M13 8H3.5M7.5 4l-4 4 4 4"],
  "arrow-right": ["M3 8h9.5M8.5 4l4 4-4 4"],
  "corner-down-right": ["M3.5 3.5V8a2 2 0 0 0 2 2h7M9.5 7l3 3-3 3"],
  expand: ["M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"],
  shrink: ["M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"],
  more: ["M3.5 8v.1M8 8v.1M12.5 8v.1"],
  grip: ["M6 4v.1M10 4v.1M6 8v.1M10 8v.1M6 12v.1M10 12v.1"],
  copy: ["M5.5 5.5h7v8h-7z", "M10.5 3.5v-.2a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v7.2a1 1 0 0 0 1 1h.2"],
  doc: ["M4.5 2.5h5l3 3v8h-8zM9.5 2.5v3h3M6 8.5h4M6 11h4"],
  file: [FILE],
  "file-code": [FILE, "m6.8 8.8-1.3 1.2 1.3 1.2m2.4-2.4 1.3 1.2-1.3 1.2"],
  "file-plus": [FILE, "M8 8v3M6.5 9.5h3"],
  "file-image": [FILE, "m5.5 12 2-2 1.5 1.5 1-1 1.5 1.5"],
  files: ["M6.5 4.5h5l2 2v7h-7z", "M4.5 11.5v-9h4"],
  folder: [
    "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z",
  ],
  "folder-open": [
    "M2 11.5V4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v1.5M2.5 13l1.5-5.5h10.500L12.500 13z",
  ],
  "folder-plus": [
    "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z",
    "M8 7.5v3M6.5 9h3",
  ],
  "folder-minus": [
    "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z",
    "M6.5 9h3",
  ],
  pen: ["m3 13 .8-3L10.5 3.3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L6 12.2 3 13Z"],
  search: [circle(7, 7, 4), "m10 10 3.5 3.5"],
  globe: [circle(8, 8, 5.5), "M2.5 8h11M8 2.5c-2 2-2 9 0 11M8 2.5c2 2 2 9 0 11"],
  terminal: ["m3 4.5 3.5 3.5L3 11.5M8 12h5"],
  code: ["m5.5 5-3 3 3 3m5-6 3 3-3 3"],
  braces: [
    "M6 3H5a1 1 0 0 0-1 1v2a1.5 1.5 0 0 1-1.5 1.5A1.5 1.5 0 0 1 4 9v3a1 1 0 0 0 1 1h1M10 3h1a1 1 0 0 1 1 1v2a1.5 1.5 0 0 0 1.5 1.5A1.5 1.5 0 0 0 12 9v3a1 1 0 0 1-1 1h-1",
  ],
  list: ["M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4v.1M2.5 8v.1M2.5 12v.1"],
  "list-checks": ["m2.5 4 1 1 2-2M2.5 10l1 1 2-2M8 4.5h5.5M8 10.5h5.5"],
  users: [
    circle(6, 5.5, 2),
    "M2.5 13c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5M10.5 3.7a2 2 0 0 1 0 3.6M11.5 9.7c1.2.4 2 1.600 2 3.300",
  ],
  user: [circle(8, 5.5, 2.5), "M3 13.5c0-2.500 2.200-4 5-4s5 1.500 5 4"],
  sparkle: ["M8 2.5 9.300 6.700 13.500 8 9.300 9.300 8 13.500 6.700 9.300 2.500 8l4.200-1.300z"],
  lightbulb: [
    "M6 12.5h4M6.500 14h3M8 2a4 4 0 0 0-2.200 7.300c.4.300.7.800.7 1.300v.4h3v-.4c0-.5.3-1 .7-1.300A4 4 0 0 0 8 2Z",
  ],
  branch: [
    circle(4.5, 3.5, 1.5),
    circle(4.5, 12.5, 1.5),
    circle(11.5, 6, 1.5),
    "M4.5 5v6M11.5 7.5c0 2.500-3 2.500-7 3",
  ],
  commit: [circle(8, 8, 2.5), "M2 8h3.500M10.500 8H14"],
  merge: [circle(4.5, 3.5, 1.5), circle(4.5, 12.5, 1.5), circle(11.5, 10, 1.5), "M4.5 5v6M4.5 5c0 3 7 1.500 7 3.500"],
  diff: ["M4 2.5h5.500l3 3v8H4z", "M8.250 6.250v3.500M6.500 8h3.500M6.500 11.500h3.500"],
  history: ["M2.500 8a5.500 5.500 0 1 0 1.700-4M2.500 3v3h3M8 5v3.200l2 1.300"],
  undo: ["M3.500 6h6a3.500 3.500 0 0 1 0 7H6M3.500 6 6 3.500M3.500 6 6 8.500"],
  redo: ["M12.500 6h-6a3.500 3.500 0 0 0 0 7H10M12.500 6 10 3.500M12.500 6 10 8.500"],
  rewind: ["M8 4v8L2.500 8 8 4ZM13.500 4v8L8 8l5.500-4Z"],
  send: ["M2.500 8 13.500 2.500 10 13.500 8 9 2.500 8ZM8 9l5.500-6.500"],
  open: ["M7 3.500H4a1 1 0 0 0-1 1v7.500a1 1 0 0 0 1 1h7.500a1 1 0 0 0 1-1V9M9.500 2.500h4v4M13.500 2.500l-6 6"],
  download: ["M8 2.500v8M4.500 7l3.500 3.500L11.500 7M3 13.500h10"],
  link: [
    "M6.500 9.500a2.500 2.500 0 0 0 3.500 0l2-2a2.500 2.500 0 0 0-3.500-3.500l-.8.8M9.500 6.500a2.500 2.500 0 0 0-3.500 0l-2 2A2.500 2.500 0 0 0 7.500 12l.8-.8",
  ],
  key: [circle(5.5, 10.5, 2.5), "m7.300 8.700 5.200-5.200M10.500 5.500l1.500 1.500"],
  lock: ["M4 7h8v6.500H4zM5.500 7V5a2.500 2.500 0 0 1 5 0v2"],
  shield: ["M8 2 3.500 3.800v3.600c0 3 2 5 4.500 6.100 2.500-1.100 4.500-3.100 4.500-6.100V3.800L8 2Z"],
  "shield-alert": [
    "M8 2 3.500 3.800v3.600c0 3 2 5 4.500 6.100 2.500-1.100 4.500-3.100 4.500-6.100V3.800L8 2ZM8 6v2.500M8 10.500v.1",
  ],
  gear: [circle(8, 8, 2), RAYS],
  sliders: [
    "M2.500 4.500H9M12 4.500h1.500M2.500 8H4M7 8h6.500M2.500 11.500H10M13 11.500h.5",
    circle(10.5, 4.5, 1.2),
    circle(5.5, 8, 1.2),
    circle(11.5, 11.5, 1.2),
  ],
  hash: ["M6 2.500 5 13.500M11 2.500 10 13.500M3 6h10.500M2.500 10H13"],
  tag: [
    "M2.500 8.500V3.500a1 1 0 0 1 1-1h5l5 5a1 1 0 0 1 0 1.400l-4.600 4.600a1 1 0 0 1-1.400 0L2.500 8.500ZM5.500 5.500v.1",
  ],
  layers: [LAYERS],
  database: [
    "M3 4.500c0-1.200 2.200-2 5-2s5 .8 5 2-2.200 2-5 2-5-.8-5-2ZM3 4.500v7c0 1.200 2.200 2 5 2s5-.8 5-2v-7M3 8c0 1.200 2.200 2 5 2s5-.8 5-2",
  ],
  server: ["M3 3h10v4H3zM3 9h10v4H3zM5.500 5v.1M5.500 11v.1"],
  cpu: [
    "M5 5h6v6H5zM6.500 2.500V5M9.500 2.500V5M6.500 11v2.500M9.500 11v2.500M2.500 6.500H5M2.500 9.500H5M11 6.500h2.500M11 9.500h2.500",
  ],
  wrench: [
    "M10.500 2.500a3.500 3.500 0 0 0-3 4.800L2.800 12a1.400 1.400 0 0 0 2 2l4.700-4.700a3.500 3.500 0 0 0 4.800-3l-2.200 2.200-1.800-.5-.5-1.800 2.200-2.200Z",
  ],
  brain: [
    "M6 3a2 2 0 0 0-2 2 2 2 0 0 0-1 3.500A2.500 2.500 0 0 0 4.500 12 2 2 0 0 0 8 13V4a2 2 0 0 0-2-1ZM10 3a2 2 0 0 1 2 2 2 2 0 0 1 1 3.500A2.500 2.500 0 0 1 11.500 12 2 2 0 0 1 8 13",
  ],
  bolt: ["M9 2 3.500 9H8l-1 5 5.500-7H8l1-5Z"],
  flame: [
    "M8 14a4 4 0 0 0 4-4c0-2.500-2-3.500-2.500-6C7.500 5 6 6 6 8c-.8-.5-1-1.500-1-2C3.500 7 4 8.500 4 10a4 4 0 0 0 4 4Z",
  ],
  rocket: [
    "M8 2.500c2.500 1.500 3.500 4 3 7l-3 2.500-3-2.500c-.5-3 .5-5.500 3-7ZM6 10.500 3.500 12M10 10.500l2.500 1.500M8 6.500v.1",
  ],
  bug: [
    "M8 5v8M5.500 7H3M13 7h-2.500M5.500 10H3M13 10h-2.500M6 5.500a2 2 0 0 1 4 0M5.500 5.500h5v4a2.500 2.500 0 0 1-5 0v-4Z",
  ],
  eye: [EYE],
  "eye-off": [EYE, "m3 3 10 10"],
  bell: ["M4.500 11V7.500a3.500 3.500 0 0 1 7 0V11l1 1.500h-9l1-1.500ZM6.800 14h2.400"],
  message: ["M3 3.500h10a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H8l-3 2.500V11H3a1 1 0 0 1-1-1V4.500a1 1 0 0 1 1-1Z"],
  image: ["M2.500 3.500h11v9h-11zM2.500 11l3.500-3.500 3 3 1.500-1.500 3 3M10.500 6.500v.1"],
  pin: ["M9.500 2.500 13.500 6.500 11 7.500 9 10.500 5.500 7 8.500 5 9.500 2.500ZM5.500 10.500l-3 3"],
  tree: ["M3 3.500h3v2.500H3zM8.500 7h4v2.500h-4zM8.500 11h4v2.500h-4zM4.500 6v6.500M4.500 8.200h4M4.500 12.200h4"],
  box: ["M2.500 5 8 2.500 13.500 5v6L8 13.500 2.500 11V5ZM2.500 5 8 7.500 13.500 5M8 7.500v6"],
  plug: ["M6 2.500v3M10 2.500v3M4.500 5.500h7v2.500a3.500 3.500 0 0 1-7 0V5.500ZM8 11.500v2"],
  activity: ["M2 8h2.500l2-5 3 10 2-5H14"],
  chart: ["M3 13.500V8M7 13.500V3.500M11 13.500V6M14 13.500H2"],
  gauge: ["M2.500 11a5.500 5.500 0 1 1 11 0M8 11l2.500-3.500"],
  wand: ["m3 13 7-7M9 4l1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z"],
  keyboard: ["M2 4.500h12v7H2zM4.500 7v.1M7 7v.1M9.500 7v.1M12 7v.1M5 9.500h6"],
  compass: [circle(8, 8, 5.5), "m10.500 5.500-1.500 3.500-3.500 1.500 1.500-3.500 3.500-1.500Z"],
  moon: ["M12.500 9.500A5 5 0 0 1 6.500 3.500a5 5 0 1 0 6 6Z"],
  sun: [circle(8, 8, 2.5), RAYS],
  trash: ["M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.5 8.500h6l.5-8.500M7 7v4M9 7v3.500"],
  save: ["M3 3h8l2 2v8H3zM5.500 3v3h4V3M5.500 13V9.500h5V13"],
  clipboard: ["M5.500 3.500h-1a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4.500a1 1 0 0 0-1-1h-1M6 2.500h4v2H6z"],
  funnel: ["M2.500 3h11l-4.200 5v4.500l-2.600 1.500V8L2.500 3Z"],
  repeat: [
    "M3 8V7a2.500 2.500 0 0 1 2.500-2.500H13M10.500 2 13 4.500 10.500 7M13 8v1a2.500 2.500 0 0 1-2.500 2.500H3M5.500 14 3 11.500 5.500 9",
  ],
  revert: ["M13 8a5 5 0 1 1-1.600-3.700M12.500 2v3h-3"],
  inbox: ["M2.500 9 4 3.500h8L13.500 9v3.500h-11V9ZM2.500 9h3.500l.7 1.500h2.600L10 9h3.500"],
  newspaper: [
    "M3 3.500h8v9H4.500A1.500 1.500 0 0 1 3 11V3.500ZM11 6h2.500v5.500a1 1 0 0 1-2 0M5.500 6h3M5.500 8.500h3M5.500 11h3",
  ],
  scale: [
    "M8 2.500v11M3 13.500h10M3.500 5.500h9M3.500 5.500 2 9.500h3.500L3.500 5.500ZM12.500 5.500 11 9.500h3.500l-2-4Z",
  ],
  share: [
    "M10 3.500a1.500 1.500 0 1 0 3 0 1.500 1.500 0 0 0-3 0ZM3 8a1.500 1.500 0 1 0 3 0 1.500 1.500 0 0 0-3 0ZM10 12.500a1.500 1.500 0 1 0 3 0 1.500 1.500 0 0 0-3 0ZM5.800 7.200l4.400-2.900M5.800 8.800l4.400 2.900",
  ],
  power: ["M8 2.500v5M4.500 4.500a5 5 0 1 0 7 0"],
  broadcast: [circle(8, 8, 1.2), "M4.500 4.500a5 5 0 0 0 0 7M11.500 4.500a5 5 0 0 1 0 7"],
  run: ["M5 3.500v9l7-4.500z"],
  swap: ["M3 5.500h9.500M10 3l2.500 2.500L10 8M13 10.500H3.500M6 8l-2.500 2.500L6 13"],
  "split-down": ["M2.500 2.500h11v11h-11zM2.500 8h11"],
  split: ["M2.500 2.500h11v11h-11zM8 2.500v11"],
  unified: ["M2.500 2.500h11v11h-11zM5 6h6M5 10h6"],
  stash: ["M2.500 7h11v6.500h-11zM4 7V4.500h8V7"],
  cherry: [circle(5, 11, 2.5), circle(11, 11, 2.5), "M5 8.500 8.500 2.500l2.500 6"],
  rebase: [circle(4.5, 3.5, 1.5), circle(4.5, 12.5, 1.5), circle(11.5, 8, 1.5), "M4.500 5v6M10 8H6.500a2 2 0 0 1-2-2"],
  pull: ["M8 2.500v8M4.500 7 8 10.500 11.500 7M3 13.500h10"],
  push: ["M8 13.500v-8M4.500 9 8 5.500 11.500 9M3 2.500h10"],
  fetch: ["M8 2.500v8M4.500 7 8 10.500 11.500 7M3 13.500h10"],
  ink: ["m3 13 3.500-.5L12 7 9 4 3.500 9.500 3 13ZM9 4l3 3"],
  note: ["M3.500 2.500h9v8L9 14H3.500zM9 14v-3.500h3.500M5.500 5.500h5M5.500 8h5"],
  markdown: ["M2 4.500h12v7H2zM4 9.500v-3l2 2 2-2v3M10.500 9.500v-3M9.200 8.200l1.300 1.300 1.300-1.300"],
  tabs: ["M2 5.500h12v8H2zM2 5.500l1-3h4l1 3"],
  canvas: ["M2.500 3h11v8h-11zM8 11v2.500M5 13.500h6"],
};

/** 规范别名（omp 的符号名）和没有专门画法的名字 → 画得出的名字。 */
const SUBSTITUTE: Record<string, string> = {
  success: "check",
  done: "check",
  error: "x",
  failed: "x",
  warning: "warn",
  pending: "clock",
  running: "activity",
  aborted: "stop",
  cancelled: "stop",
  disabled: "minus",
  model: "sparkle",
  plan: "list",
  goal: "pin",
  loop: "redo",
  git: "branch",
  "git-branch": "branch",
  pr: "merge",
  tokens: "hash",
  token_total: "hash",
  cost: "hash",
  time: "clock",
  time_spent: "clock",
  speculation: "wand",
  compaction: "wand",
  context: "layers",
  agents: "user",
  agent: "user",
  job: "run",
  jobs: "run",
  cache: "database",
  input: "download",
  output: "send",
  host: "server",
  session: "history",
  worktree: "tree",
  bash: "terminal",
  shell: "terminal",
  python: "code",
  edit: "pen",
  write: "pen",
  read: "doc",
  web: "globe",
  url: "link",
  todo: "list",
  task: "layers",
  tasks: "list",
  thinking: "sparkle",
  settings: "sliders",
  appearance: "ink",
  interaction: "keyboard",
  memory: "brain",
  tools: "wand",
  providers: "server",
  plugins: "box",
  advisor: "sparkle",
  sparkles: "sparkle",
  action: "terminal",
  extension: "puzzle",
  computer: "server",
  stats: "chart",
  news: "newspaper",
  export: "open",
  restart: "revert",
  compress: "shrink",
  handoff: "forward",
  question: "help",
  pencil: "pen",
  folderMove: "folder",
  folderPlus: "folder-plus",
  folderMinus: "folder-minus",
  hammer: "wrench",
  prewalk: "activity",
  signIn: "arrow-right",
  signOut: "arrow-left",
  package: "box",
  fast: "bolt",
  voice: "wave",
  rule: "scale",
  skill: "lightbulb",
  mcp: "plug",
  path: "folder",
  puzzle: "box",
  forward: "arrow-right",
  back: "arrow-left",
  "log-in": "arrow-right",
  "log-out": "arrow-left",
  "key-round": "key",
  "folder-go": "folder-open",
  "file-pdf": "file",
  slash: "slash-circle",
  "funnel-x": "funnel",
  "sort-x": "funnel",
  reel: "play",
  "frame-next": "arrow-right",
  "frame-prev": "arrow-left",
  "fast-forward": "arrow-right",
  wave: "activity",
  vibrate: "activity",
  mic: "wave",
  cart: "box",
  footprints: "activity",
  scissors: "x",
  bold: "pen",
  italic: "pen",
  underline: "pen",
  type: "pen",
  "align-left": "list",
  "align-center": "list",
  "align-right": "list",
  "align-justify": "list",
  eraser: "pen",
  cursor: "pen",
  selection: "wand",
  "path-insert": "folder",
  prompt: "terminal",
  vector: "pen",
  blur: "eye-off",
  palette: "ink",
  columns: "layers",
  grid: "layers",
  sidebar: "layers",
  "tabs-h": "tabs",
  "tabs-v": "tabs",
  "dock-up": "layers",
  "dock-down": "layers",
  "dock-left": "layers",
  "dock-right": "layers",
  pip: "layers",
  "pip-tl": "layers",
  "pip-tr": "layers",
  "pip-bl": "layers",
  "pip-exit": "layers",
  stack: "layers",
  kanban: "layers",
  diagram: "layers",
  flow: "layers",
  peek: "eye",
  fit: "expand",
  minimize: "shrink",
  "zoom-in": "plus",
  "zoom-out": "minus",
  stethoscope: "activity",
  "app-omp": "sparkle",
  logo: "sparkle",
  tern: "sparkle",
  "pi-mark": "sparkle",
  "app-claude": "sparkle",
  "app-codex": "sparkle",
  "app-hermes": "sparkle",
  "app-python": "code",
  "app-node": "code",
  "app-bun": "code",
  "app-deno": "code",
  "app-go": "code",
  "app-java": "code",
  "app-ruby": "code",
  "app-rust": "code",
  "app-vim": "terminal",
  "app-docker": "box",
  "app-hammer": "wrench",
  "app-helix": "terminal",
  "app-btop": "activity",
  "app-htop": "activity",
};

/** 名字 → 实际画的图标名；规范：名字里最后一个 `.` 之前的部分丢掉（`status.error` = `error`）。 */
export function resolveIconName(name: string | undefined): string | null {
  if (!name) return null;
  const bare = name.slice(name.lastIndexOf(".") + 1);
  if (PATHS[bare]) return bare;
  const alias = SUBSTITUTE[bare];
  return alias && PATHS[alias] ? alias : null;
}

/** omp 工具名 → 图标名（规范 Work/tool `name` 的表；其它工具是插头）。 */
export function toolIconName(tool: string): string {
  const table: Record<string, string> = {
    bash: "terminal",
    shell: "terminal",
    read: "doc",
    edit: "pen",
    write: "file-plus",
    grep: "search",
    glob: "search",
    search: "search",
    find: "sparkle",
    ls: "folder",
    web: "globe",
    fetch: "globe",
    browser: "globe",
    todo: "list-checks",
    task: "users",
    eval: "code",
    python: "code",
    lsp: "braces",
    proc: "activity",
    wait: "plug",
  };
  return table[tool] ?? "plug";
}

interface TspIconProps {
  name: string | undefined;
  size?: number;
}

/** 一个命名图标；未知名字返回 null（画不出来，也不占位）。 */
export const TspIcon = memo(function TspIcon({ name, size = 14 }: TspIconProps) {
  const resolved = resolveIconName(name);
  if (resolved === null) return null;
  return (
    <svg
      className="tsp-ico"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="var(--icon-stroke)"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[resolved]!.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
});
