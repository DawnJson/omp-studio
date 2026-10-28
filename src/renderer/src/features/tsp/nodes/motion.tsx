// 进度与动效类节点：spinner、shimmer、elapsed、rate、progress、meter、chart、effort（规范 Progress and Motion）。
// 所有循环动画遵守减少动效：spinner 停在第一帧，shimmer 变成静态文字，meter / progress 的值直接跳过去。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TspText } from "../../../../../shared/tsp/tsp.generated.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";
import { labels } from "../labels.ts";
import { clamp01, formatElapsed, formatRate } from "../fmt.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { asArray, asNumber, asString } from "../props-util.ts";
import { plainText, semanticOf, spanClass, cleanGlyphs, TspSpans } from "../spans.tsx";
import { useAge, useClock, useReducedMotion } from "../use-clock.ts";

// ───────── spinner ─────────

const FRAMES = {
  braille: { glyphs: [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"], ms: 100 },
  starburst: { glyphs: [..."·✢✳✶✻✽✻✶✳✢"].map((g) => `${g}\uFE0E`), ms: 120 },
} as const;

export function Spinner(props: NodeProps) {
  const p = props.node.p;
  const reduced = useReducedMotion();
  const kind = p.style === "dots" || p.style === "orbit" || p.style === "starburst" ? p.style : "braille";
  const frames = kind === "braille" || kind === "starburst" ? FRAMES[kind] : null;
  // 只取帧号、按帧长醒：帧没换（starburst 120ms 一帧）就不重画。
  const frame = useClock(frames !== null && !reduced, frames?.ms ?? 1000, (now) =>
    frames === null ? 0 : Math.floor(now / frames.ms),
  );
  let indicator;
  if (frames !== null) {
    const { glyphs } = frames;
    indicator = <span className="tsp-spin-glyph">{reduced ? glyphs[0] : glyphs[frame % glyphs.length]}</span>;
  } else if (kind === "dots") {
    indicator = (
      <span className="tsp-spin-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  } else {
    indicator = <span className="tsp-spin-orbit" aria-hidden="true" />;
  }
  const label = p.label as TspText | undefined;
  return (
    <span
      {...nodeDomProps(props, "tsp-spinner")}
      role="img"
      aria-label={asString(p.aria) ?? (label ? plainText(label) : labels.working)}
    >
      {indicator}
      {label !== undefined && (
        <span className="tsp-spin-label">
          <TspSpans text={label} />
        </span>
      )}
    </span>
  );
}

// ───────── shimmer ─────────

function sweepColor(token: unknown, fallback: string): string {
  const semantic = typeof token === "string" ? semanticOf(token.split(/\s+/)[0] ?? "") : null;
  return semantic && semantic !== "strong" ? `var(--tsp-c-${semantic})` : fallback;
}

export function Shimmer(props: NodeProps) {
  const p = props.node.p;
  const spans = Array.isArray(p.spans) ? (p.spans as { t?: unknown; s?: unknown }[]) : null;
  const text = spans
    ? spans.map((span) => (typeof span.t === "string" ? span.t : "")).join("")
    : (asString(p.text) ?? "");
  const palette = isRecord(p.palette) ? p.palette : {};
  const style = {
    "--sh-lo": sweepColor(palette.low, "var(--text-3)"),
    "--sh-mid": sweepColor(palette.mid, "var(--text-2)"),
    "--sh-hi": sweepColor(palette.high, "var(--text)"),
  } as CSSProperties;
  const kitt = p.mode === "kitt";
  return (
    <span {...nodeDomProps(props, "tsp-shimmer", { className: kitt ? "kitt" : undefined, style })}>
      <span className="tsp-shimmer-text">{cleanGlyphs(text)}</span>
    </span>
  );
}

// ───────── elapsed / rate ─────────

export function Elapsed(props: NodeProps) {
  const p = props.node.p;
  const age = asNumber(p.age) ?? 0;
  const stopped = asNumber(p.stopped);
  const format = p.format === "clock" ? "clock" : "short";
  const countdown = age < 0;
  const value = useAge(age, stopped === undefined, format);
  const shown = stopped !== undefined ? stopped : countdown ? Math.max(0, -value) : value;
  return (
    <span {...nodeDomProps(props, "tsp-elapsed")} role="timer">
      {formatElapsed(shown, format)}
    </span>
  );
}

/** 新值到来后 420ms 缓出（ease-out cubic）到它；第一个值立刻显示。 */
function useEased(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const current = useRef(target);
  current.current = shown;
  useEffect(() => {
    from.current = current.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 420);
      setShown(from.current + (target - from.current) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

export function Rate(props: NodeProps) {
  const value = useEased(asNumber(props.node.p.value) ?? 0);
  return <span {...nodeDomProps(props, "tsp-rate")}>{formatRate(value, asString(props.node.p.unit))}</span>;
}

// ───────── progress ─────────

export function Progress(props: NodeProps) {
  const raw = props.node.p.value;
  const value = typeof raw === "number" ? clamp01(raw) : null;
  const percent = value === null ? null : Math.round(value * 100);
  const label = props.node.p.label as TspText | undefined;
  return (
    <span {...nodeDomProps(props, "tsp-progress", { className: value === null ? "indeterminate" : undefined })}>
      <span
        className="tsp-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span className="tsp-progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
      </span>
      {label !== undefined && (
        <span className="tsp-progress-label">
          <TspSpans text={label} />
        </span>
      )}
    </span>
  );
}

// ───────── meter ─────────

interface MeterPart {
  value: number;
  token: string | undefined;
  label: string | undefined;
  hatch: boolean;
}

function meterLevel(value: number | null, thresholds: unknown): "warn" | "bad" | undefined {
  if (value === null || !isRecord(thresholds)) return undefined;
  const bad = asNumber(thresholds.bad);
  const warn = asNumber(thresholds.warn);
  if (bad !== undefined && value >= bad) return "bad";
  if (warn !== undefined && value >= warn) return "warn";
  return undefined;
}

/** 部件颜色：token 是语义 token 或 omp 主题 token；"track" = 留空。 */
function partColor(token: string | undefined): string | undefined {
  if (token === "track") return "transparent";
  const semantic = token === undefined ? null : semanticOf(token);
  return semantic ? `var(--tsp-c-${semantic})` : undefined;
}

/** meter 的内容（table 的 meter 单元格复用）。p 是 meter 的 props。 */
export function MeterView({ p }: { p: Readonly<Record<string, unknown>> }) {
  const parts: MeterPart[] = [];
  let used = 0;
  for (const part of asArray(p.parts).filter(isRecord)) {
    // 部件按顺序夹紧，总和不超过 1。
    const value = Math.max(0, Math.min(asNumber(part.value) ?? 0, 1 - used));
    used += value;
    parts.push({ value, token: asString(part.token), label: asString(part.label), hatch: part.hatch === true });
  }
  const hasParts = parts.length > 0;
  const raw = asNumber(p.value);
  const value = raw === undefined ? (hasParts ? used : null) : clamp01(raw);
  const level = meterLevel(raw === undefined ? null : clamp01(raw), p.thresholds);
  const style = p.style === "ring" || p.style === "blocks" ? p.style : "bar";
  const size = p.size === "md" || p.size === "lg" ? p.size : "sm";
  const steps = asNumber(p.steps);
  const marks = asArray(p.marks).filter(isRecord);
  const tone = asString(p.tone);
  const title =
    asString(p.title) ??
    (parts.some((part) => part.label)
      ? parts
          .filter((part) => part.label)
          .map((part) => `${part.label} ${Math.round(part.value * 100)}%`)
          .join(" · ")
      : undefined);
  const label = p.label as TspText | undefined;
  const total = p.total as TspText | undefined;
  let shape;
  if (style === "ring") {
    const C = 2 * Math.PI * 6;
    let offset = 0;
    const arcs = hasParts ? parts : [{ value: value ?? 0 }];
    shape = (
      <svg className="tsp-mt-ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle className="track" cx="8" cy="8" r="6" />
        {arcs.map((part, index) => {
          const length = C * part.value;
          const arc = (
            <circle
              key={index}
              className="arc"
              cx="8"
              cy="8"
              r="6"
              strokeDasharray={`${length} ${C - length}`}
              strokeDashoffset={-offset}
              style={{ stroke: "token" in part ? partColor(part.token) : undefined }}
            />
          );
          offset += length;
          return arc;
        })}
        {marks.map((mark, index) => {
          const angle = clamp01(asNumber(mark.at) ?? 0) * 2 * Math.PI - Math.PI / 2;
          return (
            <line
              key={`m${index}`}
              className="mark"
              data-tone={asString(mark.tone)}
              x1={8 + 4.5 * Math.cos(angle)}
              y1={8 + 4.5 * Math.sin(angle)}
              x2={8 + 7.5 * Math.cos(angle)}
              y2={8 + 7.5 * Math.sin(angle)}
            >
              {asString(mark.title) !== undefined && <title>{asString(mark.title)}</title>}
            </line>
          );
        })}
      </svg>
    );
  } else if (style === "blocks") {
    const cells =
      steps !== undefined && steps >= 1 && steps <= 20
        ? Math.floor(steps)
        : size === "lg"
          ? 100
          : size === "md"
            ? 50
            : 20;
    const lit = Math.round((value ?? 0) * cells);
    // 标记落在它所在的那一格上：染 tone、悬停显示 title。
    const markAt = new Map<number, Readonly<Record<string, unknown>>>();
    for (const mark of marks)
      markAt.set(Math.min(cells - 1, Math.floor(clamp01(asNumber(mark.at) ?? 0) * cells)), mark);
    shape = (
      <div className="tsp-mt-blocks" data-steps={steps !== undefined ? cells : undefined}>
        {Array.from({ length: cells }, (_, index) => {
          const mark = markAt.get(index);
          return (
            <i
              key={index}
              className={[index < lit ? "on" : "", mark ? "mark" : ""].filter(Boolean).join(" ") || undefined}
              data-tone={mark ? asString(mark.tone) : undefined}
              title={mark ? asString(mark.title) : undefined}
            />
          );
        })}
      </div>
    );
  } else {
    const icons = marks.filter((mark) => typeof mark.icon === "string");
    shape = (
      <div className={icons.length > 0 ? "tsp-mt-track gapped" : "tsp-mt-track"}>
        {hasParts ? (
          parts.map((part, index) => (
            <div
              key={index}
              className={part.hatch ? "tsp-mt-part hatch" : "tsp-mt-part"}
              style={{ width: `${part.value * 100}%`, background: partColor(part.token) }}
              title={part.label}
            />
          ))
        ) : (
          <div className="tsp-mt-fill" style={{ width: `${(value ?? 0) * 100}%` }} />
        )}
        {marks.map((mark, index) => (
          <div
            key={index}
            className={typeof mark.icon === "string" ? "tsp-mt-mark icon" : "tsp-mt-mark"}
            data-tone={asString(mark.tone)}
            style={{ left: `${clamp01(asNumber(mark.at) ?? 0) * 100}%` }}
            title={asString(mark.title)}
          >
            {typeof mark.icon === "string" && <TspIcon name={mark.icon} size={12} />}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className={value === null && !hasParts ? "tsp-meter-in unknown" : "tsp-meter-in"}
      data-style={style}
      data-size={size}
      data-level={level}
      data-tone={tone}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      title={title}
      style={{ "--tsp-meter": value ?? 0 } as CSSProperties}
    >
      {shape}
      {label !== undefined && (
        <span className="tsp-mt-lbl">
          <TspSpans text={label} />
        </span>
      )}
      {total !== undefined && (
        <span className="tsp-mt-total">
          <TspSpans text={total} />
        </span>
      )}
    </div>
  );
}

export function Meter(props: NodeProps) {
  return (
    <div {...nodeDomProps(props, "tsp-meter")}>
      <MeterView p={props.node.p} />
    </div>
  );
}

// ───────── effort ─────────

const EFFORT_RUNGS: Record<string, { rungs: number; tone: string }> = {
  off: { rungs: 0, tone: "dim" },
  minimal: { rungs: 1, tone: "muted" },
  low: { rungs: 2, tone: "info" },
  medium: { rungs: 3, tone: "accent" },
  high: { rungs: 4, tone: "warning" },
  xhigh: { rungs: 5, tone: "error" },
  max: { rungs: 6, tone: "error" },
};

/** 六段环：一段 60° 减去缝隙。 */
function arcPath(index: number): string {
  const start = (index * 60 + 4) * (Math.PI / 180) - Math.PI / 2;
  const end = ((index + 1) * 60 - 4) * (Math.PI / 180) - Math.PI / 2;
  const r = 5.5;
  const point = (a: number): string => `${(8 + r * Math.cos(a)).toFixed(2)} ${(8 + r * Math.sin(a)).toFixed(2)}`;
  return `M${point(start)}A${r} ${r} 0 0 1 ${point(end)}`;
}

export function Effort(props: NodeProps) {
  const level = asString(props.node.p.level) ?? "";
  const known = EFFORT_RUNGS[level];
  return (
    <span
      {...nodeDomProps(props, "tsp-effort", {
        className: level === "max" ? "max" : undefined,
        style: { color: known ? `var(--tsp-c-${known.tone})` : "var(--text-3)" },
      })}
      data-level={known ? level : "auto"}
      role="img"
      aria-label={asString(props.node.p.aria) ?? labels.effortAria(level)}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        {known ? (
          Array.from({ length: 6 }, (_, index) => (
            <path key={index} d={arcPath(index)} className={index < known.rungs ? "on" : "off"} />
          ))
        ) : (
          <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2.4" className="off" />
        )}
      </svg>
    </span>
  );
}

// ───────── chart ─────────

export function Chart(props: NodeProps) {
  const p = props.node.p;
  const kind = p.kind === "bars" || p.kind === "spark" ? p.kind : "heatmap";
  const size = p.size === "sm" || p.size === "lg" ? p.size : "md";
  const token = asString(p.token);
  const semantic = token ? semanticOf(token) : null;
  const color = semantic && semantic !== "strong" ? `var(--tsp-c-${semantic})` : "var(--accent)";
  const summary = p.summary as TspText | undefined;
  const series = asArray(p.series).filter(isRecord);
  let body;
  if (kind === "heatmap") {
    const cells = asArray(p.cells).map((row) => asArray(row));
    const columns = Math.max(0, ...cells.map((row) => row.length));
    const tips = asArray(p.tips).map((row) => asArray(row));
    const rowLabels = asArray(p.rows);
    const colLabels = asArray(p.cols).filter(isRecord);
    body = (
      <div className="tsp-chart-heat" style={{ "--cols": columns } as CSSProperties}>
        {colLabels.length > 0 && (
          <div className="tsp-chart-cols" style={{ gridColumn: "2 / -1" }}>
            {colLabels.map((col, index) => (
              <span key={index} style={{ gridColumnStart: (asNumber(col.at) ?? 0) + 1 }}>
                {asString(col.label)}
              </span>
            ))}
          </div>
        )}
        {cells.map((row, r) => (
          <div key={r} className="tsp-chart-row">
            <span className="tsp-chart-rl">{asString(rowLabels[r]) ?? ""}</span>
            {Array.from({ length: columns }, (_, c) => {
              const v = asNumber(row[c]);
              return (
                <i
                  key={c}
                  title={asString(tips[r]?.[c])}
                  style={{
                    background:
                      v === undefined
                        ? "var(--bg-sunken)"
                        : `color-mix(in srgb, ${color} ${Math.round(clamp01(v) * 85) + 8}%, var(--bg-sunken))`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    );
  } else {
    const values = series.map((s) => asNumber(s.value) ?? 0);
    const marks = asArray(p.marks).filter(isRecord);
    const min = asNumber(p.min) ?? 0;
    const max = asNumber(p.max) ?? Math.max(1, ...values, ...marks.map((m) => asNumber(m.value) ?? 0));
    const span = max - min || 1;
    body = (
      <div className={`tsp-chart-bars ${kind}`} data-size={size}>
        {series.map((s, index) => (
          <i
            key={index}
            title={asString(s.title) ?? asString(s.label)}
            style={{
              height: `${Math.max(1, clamp01(((values[index] ?? 0) - min) / span) * 100)}%`,
              background: asString(s.tone) ? `var(--tsp-c-${semanticOf(asString(s.tone) ?? "") ?? "accent"})` : color,
            }}
          />
        ))}
        {marks.map((m, index) => (
          <b
            key={`m${index}`}
            title={asString(m.title)}
            style={{ bottom: `${clamp01(((asNumber(m.value) ?? 0) - min) / span) * 100}%` }}
          />
        ))}
      </div>
    );
  }
  const empty = kind === "heatmap" ? asArray(p.cells).length === 0 : series.length === 0;
  return (
    <div
      {...nodeDomProps(props, "tsp-chart", { className: kind })}
      role="img"
      aria-label={summary ? plainText(summary) : undefined}
    >
      {empty ? <span className="tsp-chart-empty">{labels.chartEmpty}</span> : body}
      {summary !== undefined && (
        <div className={`tsp-chart-sum ${spanClass("muted") ?? ""}`}>
          <TspSpans text={summary} />
        </div>
      )}
    </div>
  );
}
