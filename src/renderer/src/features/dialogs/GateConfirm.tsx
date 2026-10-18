// confirm：标题（在头部）+ message（等宽 pre-wrap，>8 行折叠）+ [取消 Esc] [确认 Ctrl+Enter]。
import { useEffect } from "react";
import { useT } from "../../i18n/use-t.ts";
import type { DialogRequest } from "../../../../shared/ipc.ts";
import type { GateBodyProps } from "./Gate.tsx";
import { GateDetails } from "./GateSelect.tsx";

export function GateConfirm({ dialog, busy, respond, primaryRef }: GateBodyProps<Extract<DialogRequest, { kind: "confirm" }>>) {
  const t = useT();
  useEffect(() => {
    primaryRef.current = () => respond({ kind: "confirm", confirmed: true });
  });
  return (
    <div className="gate-body">
      {dialog.message !== "" && <GateDetails text={dialog.message} />}
      <div className="gate-actions" data-end>
        <button type="button" className="gate-btn" disabled={busy} onClick={() => respond({ kind: "confirm", confirmed: false })}>
          <span className="gate-btn-label">{t("gate.cancel")}</span>
          <kbd className="gate-key">Esc</kbd>
        </button>
        <button type="button" className="gate-btn" data-primary disabled={busy} onClick={() => respond({ kind: "confirm", confirmed: true })}>
          <span className="gate-btn-label">{t("gate.confirm")}</span>
          <kbd className="gate-key">Ctrl+Enter</kbd>
        </button>
      </div>
    </div>
  );
}
