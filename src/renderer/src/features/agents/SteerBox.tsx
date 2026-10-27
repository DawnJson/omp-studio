// 面板底部的插话框（钉在面板底边，不随详情滚动）：和主输入框同一个外观（.composer 的框、.composer-field 的文本区、
// 右下角圆形的 .send 发送键），按内容自动增高。
// Enter 发送（Shift+Enter 换行、输入法组字时不发）。发送期间面板顶部显示"正在发给 <名字>"（主进程在后台走 Hub，要一两秒），
// 成功后清空，失败（omp 的原文已经 toast）文字留着。
import { useState, type KeyboardEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { subagentLimits } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { ArrowUp } from "../../icons.tsx";
import { steerAgent } from "./agents-actions.ts";
import "../composer/composer.css";

export function SteerBox({ taskId, name, busy }: { taskId: TaskId; name: string; busy: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const message = text.trim();
  const send = () => {
    if (message === "" || busy) return;
    void steerAgent(t, taskId, name, message).then((sent) => {
      if (sent) setText("");
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <div className="agents-steer" data-testid="agents-steer">
      <div className="composer">
        <div className="composer-body">
          <textarea
            className="composer-field agents-steer-field"
            data-testid="agents-steer-input"
            rows={1}
            value={text}
            maxLength={subagentLimits.steerChars}
            placeholder={t("agents.steerPlaceholder")}
            aria-label={t("agents.steerLabel", { name })}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="composer-tools agents-steer-tools">
          <button
            type="button"
            className="send"
            data-kind="send"
            data-testid="agents-steer-send"
            disabled={busy || message === ""}
            aria-label={t("agents.steerSend")}
            title={t("agents.steerSend")}
            onClick={send}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
