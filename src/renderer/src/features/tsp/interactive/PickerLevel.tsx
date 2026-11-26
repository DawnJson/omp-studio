// picker 的档位滑杆（`level`，规范 TspPickerLevel；omp 的模型切换器用它调思考强度）：停在动作栏上方。
// 按下或拖动后停在另一格时发 `action {act:"level", value:<格 id>}`，新值以 omp 回的 `set` 为准；拖动中只在本地预览。
// 键盘归 omp（←/→ 经搜索框写进伪终端），这里只把键写进悬停提示。
import { useRef, useState, type PointerEvent } from "react";
import type { TspPickerLevel } from "../../../../../shared/tsp/tsp.generated.ts";
import { gateKeyHint } from "../fmt.ts";
import { TspIcon } from "../icons.tsx";
import { levelFraction, levelHeat, levelIndex, stepAtPointer } from "./picker-model.ts";

export function PickerLevel({ level, onPick }: { level: TspPickerLevel; onPick(step: string): void }) {
  /** 格子所在的内框（两端让出旋钮的半径）：指针位置按它换算成格。 */
  const inner = useRef<HTMLSpanElement>(null);
  /** 拖动中指针所在的格；松开后清掉，显示回到 omp 给的值。 */
  const [drag, setDrag] = useState<number | null>(null);
  const steps = level.steps;
  const frozen = level.disabled !== undefined;
  const index = drag ?? levelIndex(level);
  const step = steps[index];
  const keys = level.keys?.map((key) => gateKeyHint([key])).join(" ");
  const tip =
    typeof level.disabled === "string"
      ? level.disabled
      : [level.icon !== undefined ? level.label : "", keys ?? ""].filter(Boolean).join("  ");

  const stepAt = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = inner.current?.getBoundingClientRect();
    if (!rect) return index;
    return stepAtPointer(event.clientX - rect.left, rect.width, steps.length);
  };

  return (
    <div
      className="tspi-pk-level"
      data-heat={levelHeat(index, steps.length)}
      data-frozen={frozen ? "" : undefined}
      data-testid="tsp-picker-level"
    >
      {level.icon !== undefined ? (
        <span className="tspi-pk-level-ic" title={tip || undefined}>
          <TspIcon name={level.icon} size={14} />
        </span>
      ) : (
        <span className="tspi-pk-level-l">{level.label}</span>
      )}
      <div
        className="tspi-pk-track"
        role="slider"
        aria-label={level.label}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, steps.length - 1)}
        aria-valuenow={index}
        aria-valuetext={step?.label}
        aria-disabled={frozen || undefined}
        title={tip || undefined}
        onPointerDown={(event) => {
          if (frozen || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag(stepAt(event));
        }}
        onPointerMove={(event) => {
          if (drag === null) return;
          const next = stepAt(event);
          if (next !== drag) setDrag(next);
        }}
        onPointerUp={(event) => {
          if (drag === null) return;
          const next = stepAt(event);
          setDrag(null);
          const target = steps[next];
          if (target !== undefined && target.id !== level.value) onPick(target.id);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <span
          ref={inner}
          className="tspi-pk-track-in"
          style={{ "--tspi-lv": levelFraction(index, steps.length) } as React.CSSProperties}
        >
          <span className="tspi-pk-track-fill" aria-hidden="true">
            <span className="tspi-pk-track-glint" />
          </span>
          <span className="tspi-pk-track-rest" aria-hidden="true" />
          {steps.map((s, i) => (
            <span
              key={s.id}
              className="tspi-pk-tick"
              data-on={i <= index ? "" : undefined}
              data-step={s.id}
              title={frozen ? undefined : s.label}
              style={{ "--tspi-at": levelFraction(i, steps.length) } as React.CSSProperties}
            />
          ))}
          <span className="tspi-pk-knob-rail" aria-hidden="true">
            <span className="tspi-pk-knob" />
          </span>
        </span>
      </div>
      <span className="tspi-pk-level-chip">
        <span className="v">{step?.label ?? level.value}</span>
        {level.detail !== undefined ? <span className="d">{level.detail}</span> : null}
      </span>
    </div>
  );
}
