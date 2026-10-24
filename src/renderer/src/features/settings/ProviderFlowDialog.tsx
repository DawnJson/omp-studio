// 提供商的登录 / 填 API key / 选账号退出，都在这一个对话框里走（spec §4.20）：OAuth 进度、授权码输入、key 输入、选账号、失败重试。
// OAuth 登录的过程事件由主进程经 onLogin 推来；行为和 IPC 同改版前，只是展示从"提供商行里展开的卡"改成对话框。
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LoginEvent } from "../../../../shared/ipc.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { describeError } from "../../ui/errors.ts";
import { AccountsBody, FailedBody, KeyBody, LoginBody, type Flow } from "./ProviderPanels.tsx";
import { TerminalLoginBody } from "./TerminalLoginBody.tsx";
import "./providers.css";

/**
 * 从提供商行 / 选择对话框发起的四种动作：OAuth 登录、填 API key（存进 omp 的凭据库）、在多个账号里选一个退出、
 * 应用内终端登录（只能在 omp 的终端界面里走完的 provider，`loginKind` = terminal）。
 */
export type FlowAction = "login" | "key" | "accounts" | "terminal";

function initialFlow(action: FlowAction): Flow {
  return action === "key"
    ? { kind: "key" }
    : action === "accounts"
      ? { kind: "accounts" }
      : action === "terminal"
        ? { kind: "terminal" }
        : { kind: "login" };
}

export function ProviderFlowDialog({
  provider,
  accounts,
  action,
  onBack,
  onClose,
  onChanged,
}: {
  provider: LoginProvider;
  accounts: LogoutAccount[];
  action: FlowAction;
  /** 从"连接提供商"选择对话框进来时可以回去重选。 */
  onBack?: (() => void) | undefined;
  /** 对话框退出动画放完、卸载时调用。 */
  onClose(): void;
  onChanged(): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [flow, setFlow] = useState<Flow>(() => initialFlow(action));
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  /** 这个对话框跑过终端登录：失败后的"重试"重新走它，而不是原来的 RPC 登录。 */
  const ranTerminal = useRef(false);

  const fail = (error: unknown) => setFlow({ kind: "failed", message: describeError(t, error) });
  const finish = () => {
    onChanged();
    setOpen(false);
  };

  const startLogin = async () => {
    setFlow({ kind: "login" });
    setCode("");
    const off = window.studio.onLogin((event: LoginEvent) => {
      setFlow((current) => {
        if (current.kind !== "login") return current;
        switch (event.type) {
          case "open_url":
            return {
              ...current,
              url: event.url,
              ...(event.launchUrl !== undefined && { launchUrl: event.launchUrl }),
              ...(event.instructions !== undefined && { instructions: event.instructions }),
            };
          case "progress":
            return { ...current, progress: [...(current.progress ?? []), event] };
          case "input_closed":
            // omp 撤销了这个输入（超时或取消）：收起输入框，免得再提交时报 no login input is waiting。
            if (current.input?.inputId !== event.inputId) return current;
            return { ...current, input: undefined };
          case "input":
            return {
              ...current,
              input: {
                inputId: event.inputId,
                title: event.title,
                ...(event.placeholder !== undefined && { placeholder: event.placeholder }),
              },
            };
        }
      });
    });
    try {
      const outcome = await window.studio.startLogin(provider.id);
      if (outcome.ok) finish();
      else if (outcome.message === "cancelled") setOpen(false);
      else setFlow({ kind: "failed", message: outcome.message });
    } catch (error) {
      fail(error);
    } finally {
      off();
    }
  };

  const startTerminalLogin = async () => {
    ranTerminal.current = true;
    setFlow({ kind: "terminal" });
    try {
      const outcome = await window.studio.startTerminalLogin(provider.id);
      if (outcome.ok) finish();
      else if (outcome.message === "cancelled") setOpen(false);
      else setFlow({ kind: "failed", message: outcome.message });
    } catch (error) {
      fail(error);
    }
  };

  // 登录动作一打开就开始（React 严格模式会把 effect 跑两遍，所以用 ref 挡一下）。
  useEffect(() => {
    if ((action !== "login" && action !== "terminal") || started.current) return;
    started.current = true;
    void (action === "login" ? startLogin() : startTerminalLogin());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  // 输入框换了一个（或被 omp 撤销）：上一个输入框里没提交的内容不带到下一个。
  const inputId = flow.kind === "login" ? flow.input?.inputId : undefined;
  useEffect(() => setCode(""), [inputId]);

  const signOut = async (credentialId: number) => {
    setBusy(true);
    try {
      await window.studio.logout(provider.id, credentialId);
      finish();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    setBusy(true);
    try {
      await window.studio.saveApiKey(provider.id, apiKey);
      setApiKey("");
      finish();
    } catch (error) {
      setFlow({ kind: "failed", message: t("login.apiKey.failed", { message: describeError(t, error) }) });
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const close = () => {
    if (flow.kind === "login") void window.studio.cancelLogin();
    if (flow.kind === "terminal") void window.studio.cancelTerminalLogin();
    setOpen(false);
  };
  const submitCode = (inputId: string) => {
    void window.studio.answerLoginInput(inputId, code.trim()).catch(fail);
    setCode("");
    setFlow((current) => (current.kind === "login" ? { ...current, input: undefined } : current));
  };

  let body: ReactNode = null;
  let footer: ReactNode = null;
  if (flow.kind === "login") {
    const input = flow.input;
    body = (
      <LoginBody flow={flow} code={code} copied={copied} onCode={setCode} onCopy={copy} onSubmitCode={submitCode} />
    );
    footer = (
      <>
        <Button onClick={close} testId="provider-login-cancel">
          {t("login.cancel")}
        </Button>
        {input !== undefined && (
          <Button variant="primary" disabled={code.trim() === ""} onClick={() => submitCode(input.inputId)}>
            {t("login.submit")}
          </Button>
        )}
      </>
    );
  } else if (flow.kind === "terminal") {
    body = <TerminalLoginBody />;
    footer = (
      <Button onClick={close} testId="provider-terminal-cancel">
        {t("login.cancel")}
      </Button>
    );
  } else if (flow.kind === "accounts") {
    body = <AccountsBody accounts={accounts} busy={busy} onPick={(id) => void signOut(id)} />;
    footer = <Button onClick={close}>{t("common.cancel")}</Button>;
  } else if (flow.kind === "key") {
    body = <KeyBody value={apiKey} onChange={setApiKey} onSubmit={() => void saveKey()} />;
    footer = (
      <>
        <Button onClick={close}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          disabled={apiKey.trim() === ""}
          loading={busy}
          onClick={() => void saveKey()}
          testId="provider-key-save"
        >
          {t("login.apiKey.save")}
        </Button>
      </>
    );
  } else if (flow.kind === "failed") {
    // rpc 登录被 omp 拒绝、要求多步交互的 provider（omp 升级后新增、loginKind 表里还没有的）：改在应用内的终端登录里走。
    const terminalOnly = !ranTerminal.current && /secret|terminal/i.test(flow.message);
    const retry = () =>
      ranTerminal.current
        ? void startTerminalLogin()
        : action === "login"
          ? void startLogin()
          : setFlow({ kind: action });
    body = <FailedBody message={flow.message} terminalOnly={terminalOnly} />;
    footer = (
      <>
        <Button onClick={close}>{t("common.close")}</Button>
        <Button
          variant="primary"
          onClick={terminalOnly ? () => void startTerminalLogin() : retry}
          testId={terminalOnly ? "provider-terminal-here" : undefined}
        >
          {terminalOnly ? t("login.signInHere") : t("common.retry")}
        </Button>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      onExited={onClose}
      title={provider.name}
      testId={`provider-flow-${provider.id}`}
      footStart={
        onBack !== undefined && flow.kind !== "login" && flow.kind !== "terminal" ? (
          <Button variant="quiet" onClick={onBack}>
            {t("login.back")}
          </Button>
        ) : undefined
      }
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
