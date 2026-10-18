// 对话流里不属于消息的几类内容：提示、命令输出、压缩状态、模型错误（左 2px 红线 + 浅红底，不用大块红色）。
import type { PromptError } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { showView } from "../../store/index.ts";
import type { Extra } from "./model.ts";

function ModelError({ message, error }: { message: string; error: PromptError | null }) {
  const t = useT();
  const unauthenticated = error?.httpStatus === 401 || error?.httpStatus === 403;
  return (
    <div className="inline-error" role="alert" data-testid="model-error">
      <span className="inline-error-text">{t("error.model", { message })}</span>
      {unauthenticated && (
        <button type="button" className="inline-error-action" onClick={() => showView("settings")}>
          {t("error.goSignIn")}
        </button>
      )}
    </div>
  );
}

export function ExtraView({ extra }: { extra: Extra }) {
  const t = useT();
  switch (extra.kind) {
    case "notice":
      return <p className="note" data-level={extra.level}>{extra.message}</p>;
    case "command_output":
      return <pre className="command-output" aria-label={t("conversation.commandOutput")}>{extra.text}</pre>;
    case "compaction":
      return extra.phase === "end" ? <p className="note" data-level="info">{t("conversation.compacted")}</p> : null;
    case "retry":
      return null;
    case "prompt_error":
      return <ModelError message={extra.error?.message ?? ""} error={extra.error} />;
    case "model_error":
      return <ModelError message={extra.message} error={null} />;
  }
}
