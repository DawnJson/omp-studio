// 应用内终端登录对话框的正文（docs/architecture/login.md "应用内登录"）：用过程区的 TSP 渲染器只画临时登录 omp 的 layer
// （登录窗 `omp.overlay.login`：输入框、设备码、授权链接、Open / Copy / Continue 按钮），用户的点击、输入经现有的 sendTspEvent / sendTspKeys
// 回到主进程，主进程按固定 id（TERMINAL_LOGIN_ID）路由给临时 omp。对话区（main）、dock、toast 一概不画：登录对话框里只有登录窗。
// 外链走 openHref → openExternal（只放行 http/https/mailto，主进程再校验一遍）。
import { useEffect, useMemo } from "react";
import { TERMINAL_LOGIN_ID } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import type { TspContext } from "../tsp/node-props.ts";
import { TspCtx } from "../tsp/tsp-context.ts";
import { TspChildren } from "../tsp/TspChildren.tsx";
import { dropTspDocument, ensureTspDocument, useTspNode, useTspSurfaces } from "../tsp/tsp-store.ts";
import "../tsp/tsp.css";
import "./providers.css";

function LoginLayer({ ctx }: { ctx: TspContext }) {
  const layer = useTspNode(ctx.taskId, ctx.sf, "layer");
  return layer === null ? null : <TspChildren node={layer} ctx={ctx} />;
}

export function TerminalLoginBody() {
  const t = useT();
  // 每次登录都是一个新进程：镜像从空开始，挂载时丢掉上一次留下的，卸载时也不留。
  useEffect(() => {
    dropTspDocument(TERMINAL_LOGIN_ID);
    ensureTspDocument(TERMINAL_LOGIN_ID);
    return () => dropTspDocument(TERMINAL_LOGIN_ID);
  }, []);
  const surface = useTspSurfaces(TERMINAL_LOGIN_ID).find((candidate) => candidate.mode === "inline" && candidate.live);
  const sf = surface?.id ?? "";
  const ctx = useMemo<TspContext>(
    () => ({
      taskId: TERMINAL_LOGIN_ID,
      sf,
      send: (event) => {
        window.studio.sendTspEvent(TERMINAL_LOGIN_ID, event).catch((error: unknown) => reportErrorNow(error));
      },
      keys: (data) => {
        window.studio.sendTspKeys(TERMINAL_LOGIN_ID, data).catch((error: unknown) => reportErrorNow(error));
      },
    }),
    [sf],
  );
  return (
    <div className="tsp-view pv-terminal" data-testid="terminal-login" data-sf={sf}>
      {surface === undefined ? (
        <p className="pv-text pv-muted" role="status">
          {t("login.terminal.starting")}
        </p>
      ) : (
        <TspCtx.Provider value={ctx}>
          <div className="tsp-surface" data-mode="inline">
            <div className="tsp-layer">
              <LoginLayer ctx={ctx} />
            </div>
          </div>
        </TspCtx.Provider>
      )}
    </div>
  );
}
