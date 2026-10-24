// 标签输入：字符串数组设置（task.disabledAgents、cycleOrder 等）。标签依次排开，末尾一个输入框：
// Enter 或逗号添加，输入框为空时 Backspace 删最后一个，失焦时把没提交的文字也加进去。每次增删立即交给调用方保存。
import { useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";

export function TagInput({
  values,
  onChange,
  labelledBy,
  testId,
}: {
  values: readonly string[];
  onChange(next: string[]): void;
  labelledBy: string;
  testId?: string | undefined;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  const commit = () => {
    const added = text
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    setText("");
    const next = [...values];
    for (const part of added) if (!next.includes(part)) next.push(part);
    if (next.length !== values.length) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div
      className="st-tags"
      role="group"
      aria-labelledby={labelledBy}
      data-testid={testId}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        input.current?.focus();
      }}
    >
      {values.map((value) => (
        <span key={value} className="st-tag">
          <span className="st-tag-text" title={value}>
            {value}
          </span>
          <button
            type="button"
            className="st-tag-remove"
            aria-label={t("settings.cfg.removeTag", { name: value })}
            title={t("settings.cfg.remove")}
            onClick={() => onChange(values.filter((other) => other !== value))}
          >
            <Close size={10} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        className="st-tags-input"
        value={text}
        spellCheck={false}
        aria-labelledby={labelledBy}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  );
}
