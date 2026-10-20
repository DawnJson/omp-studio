// 节点种类 → 组件。第一次渲染时才拼（节点组件和 TspChildren 互相引用，惰性取表避开模块初始化顺序）。
// 交互类节点（editor / input / list / item / picker / prefs / tabs / overlay / toast）来自 interactive/。
import type { ComponentType } from "react";
import { interactiveNodes } from "./interactive/index.ts";
import type { NodeProps } from "./node-props.ts";
import { Seg, Status } from "./nodes/chrome.tsx";
import { Badge, Icon, Image, Kbd, Kv, Table, Tree } from "./nodes/data.tsx";
import { Card, Col, Row, Rule, Section, Spacer } from "./nodes/layout.tsx";
import { Chart, Effort, Elapsed, Meter, Progress, Rate, Shimmer, Spinner } from "./nodes/motion.tsx";
import { Ansi, Code, Diff, MathBlock, Md, Media, Rows, Text } from "./nodes/text.tsx";
import { Agent, Checklist, Tool } from "./nodes/work.tsx";

let table: Readonly<Record<string, ComponentType<NodeProps>>> | null = null;

export function nodeRegistry(): Readonly<Record<string, ComponentType<NodeProps>>> {
  table ??= {
    col: Col,
    row: Row,
    card: Card,
    section: Section,
    rule: Rule,
    spacer: Spacer,
    text: Text,
    md: Md,
    code: Code,
    diff: Diff,
    ansi: Ansi,
    math: MathBlock,
    rows: Rows,
    media: Media,
    image: Image,
    kv: Kv,
    table: Table,
    tree: Tree,
    badge: Badge,
    kbd: Kbd,
    icon: Icon,
    spinner: Spinner,
    shimmer: Shimmer,
    elapsed: Elapsed,
    progress: Progress,
    rate: Rate,
    meter: Meter,
    chart: Chart,
    effort: Effort,
    status: Status,
    seg: Seg,
    tool: Tool,
    agent: Agent,
    checklist: Checklist,
    ...interactiveNodes,
  };
  return table;
}
