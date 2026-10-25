// studio 自带的账号型 provider：登录自己的 Qoder / Qoder CN / WorkBuddy 账号，直接用套餐里的模型。
//
// 这个文件是 omp 的扩展（`omp -e <这个文件>`），由 omp-studio 部署到 userData 并在每次启动 omp 时传入。
// 设计、实测和风险见 docs/architecture/client-accounts.md；第三方来源见 NOTICE.md。
//
// 不声明静态模型表（插件的 SITES[].models 只是它自己"问不到账号时"的兜底）：那些 id 未必在账号的
// 真实列表里，挑中会得到 400 `unknown or disabled model`。模型只来自 `fetchDynamicModels`（账号自己的列表）。
import { registerAccountProvider } from "./shim.mjs";
import { QoderAuthPlugin, QoderCNAuthPlugin, _internal as qoder } from "./vendor/qoder/index.mjs";
import { WorkBuddyAIAuthPlugin, WorkBuddyAuthPlugin, _internal as workbuddy } from "./vendor/workbuddy/index.mjs";

export default function studioAccounts(pi) {
  registerAccountProvider(pi, {
    id: "qoder",
    name: "Qoder",
    baseUrl: "https://api3.qoder.sh",
    make: QoderAuthPlugin,
    sessionHeader: qoder.SESSION,
  });

  registerAccountProvider(pi, {
    id: "qoder-cn",
    name: "Qoder CN",
    baseUrl: "https://gateway.qoder.com.cn",
    make: QoderCNAuthPlugin,
    sessionHeader: qoder.SESSION,
  });

  registerAccountProvider(pi, {
    id: "workbuddy",
    name: "WorkBuddy",
    // 只收 chat 模型（Claude 走 Messages，已在 adapter 里跳过），所以 baseUrl 直接写 chat 的根：<endpoint>/v2。
    baseUrl: "https://copilot.tencent.com/v2",
    make: WorkBuddyAuthPlugin,
    sessionHeader: workbuddy.SESSION,
  });

  registerAccountProvider(pi, {
    id: "workbuddy-ai",
    name: "WorkBuddy AI",
    baseUrl: "https://www.workbuddy.ai/v2",
    make: WorkBuddyAIAuthPlugin,
    sessionHeader: workbuddy.SESSION,
  });
}
