// 模型选择对话框里的思考强度：ui/Segmented md（设一个值），每档等宽。键盘 ←/→ 换档由 Segmented 负责。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { TaskThinkingLevel } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Segmented } from "../../ui/controls.tsx";
import { thinkingLabel } from "./thinking-levels.ts";

interface ThinkingSegmentsProps {
  levels: readonly TaskThinkingLevel[];
  level: TaskThinkingLevel | null;
  onPick(level: TaskThinkingLevel): void;
}

export function ThinkingSegments({ levels, level, onPick }: ThinkingSegmentsProps) {
  const t = useT();
  return (
    <Segmented<string>
      label={t("model.thinking")}
      testId="thinking-segments"
      value={level ?? ""}
      options={levels.map((candidate) => ({ value: candidate, label: t(thinkingLabel[candidate] as MessageKey) }))}
      onChange={(next) => {
        const picked = levels.find((candidate) => candidate === next);
        if (picked !== undefined) onPick(picked);
      }}
    />
  );
}
