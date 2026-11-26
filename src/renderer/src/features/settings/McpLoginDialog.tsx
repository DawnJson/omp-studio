// MCP 服务器的 OAuth 登录对话框（设置 → 扩展 → MCP 卡片的"登录"）：主进程在专用的 rpc-ui 里跑 `/mcp reauth <name>`，
// omp 自己开浏览器；这里和 provider 登录同一个正文（LoginBody：正在打开浏览器 / 登录链接 + 复制 + 重新打开），只有"取消"。
// 结果出来就关：成功把 omp 的原话交给卡片弹 toast 并重测这一行，失败把原话交给卡片显示，取消什么都不做。
import { useEffect, useRef, useState } from "react";
import type { McpReauthOutcome, ProjectId } from "../../../../shared/ipc.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { LoginBody } from "./ProviderPanels.tsx";
import "./providers.css";

const noop = () => undefined;

export function McpLoginDialog({
  name,
  projectId,
  onDone,
}: {
  name: string;
  projectId: ProjectId | null;
  /** 对话框关完（退出动画放完）时调；outcome 为 null = 用户取消。 */
  onDone(outcome: McpReauthOutcome | null): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [url, setUrl] = useState<string | undefined>(undefined);
  const result = useRef<McpReauthOutcome | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode 下 effect 跑两次：登录只发一次（再发会取消第一次）。
    if (started.current) return;
    started.current = true;
    const off = window.studio.onMcpReauthUrl(setUrl);
    window.studio
      .startMcpReauth(name, projectId)
      .catch((error: unknown): McpReauthOutcome => ({ kind: "failed", message: errorDetail(error) }))
      .then((outcome) => {
        off();
        result.current = outcome.kind === "cancelled" ? null : outcome;
        setOpen(false);
      });
  }, [name, projectId]);

  const cancel = () => {
    void window.studio.cancelMcpReauth();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={cancel}
      onExited={() => onDone(result.current)}
      title={t("integrations.mcp.login.title", { name })}
      testId="mcp-login"
      footer={
        <Button onClick={cancel} testId="mcp-login-cancel">
          {t("login.cancel")}
        </Button>
      }
    >
      <LoginBody flow={{ kind: "login", url }} code="" onCode={noop} onSubmitCode={noop} />
    </Dialog>
  );
}
