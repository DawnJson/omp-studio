// "登录"对一个 provider 意味着什么。omp 的 RPC `get_login_providers` 只给 {id, name, available, authenticated}，
// 没有登录方式这一项（实测 omp 18.12.2：84 个 provider 的 `available` 全是 true，不能区分）。所以这里按实测分类：
// 在隔离的 agent 目录里对每个 provider 发 `login`，看 omp 接着发什么（rpc-ui 模式）：
//   - open_url 之后是"Paste the authorization code"、"等待浏览器/设备授权"          → oauth
//   - open_url 之后是 "Paste your <name> API key" 这类输入框（title/placeholder 提示的是 key）→ api-key
//   - 直接以"requires interactive prompts which are not supported in RPC mode"失败 → terminal（应用内用临时交互式 omp 跑 `/login`，docs/architecture/login.md "应用内登录"）
// 没出现在下面两张表里的 provider（omp 升级后新增的）按 oauth 处理：保留登录按钮，失败了界面会给出原因，不会把可能能用的入口藏掉。
// omp 升级后新增或改了登录方式的 provider 要重新实测并更新这两张表（docs/architecture/login.md）。

export type LoginKind = "oauth" | "api-key" | "terminal";

/** 登录就是粘贴 API key 的 provider（omp 在 open_url 打开控制台页之后发一个 "Paste your … API key" 输入框）。 */
const apiKeyLogin: Readonly<Record<string, true>> = Object.fromEntries(
  [
    "zai",
    "xai",
    "aiand",
    "abliteration",
    "zhipu-coding-plan",
    "umans",
    "qwen-portal",
    "sakana",
    "sambanova",
    "minimax-code",
    "minimax-code-cn",
    "xiaomi",
    "xiaomi-token-plan-sgp",
    "xiaomi-token-plan-ams",
    "xiaomi-token-plan-cn",
    "firepass",
    "cline-pass",
    "commandcode",
    "charm-hyper",
    "deepseek",
    "stepfun",
    "meta",
    "moonshot",
    "cerebras",
    "baseten",
    "helmcode",
    "fireworks",
    "together",
    "nvidia",
    "novita",
    "deepinfra",
    "huggingface",
    "qianfan",
    "venice",
    "siliconflow",
    "siliconflow-cn",
    "synthetic",
    "nanogpt",
    "wafer-serverless",
    "coreweave",
    "vercel-ai-gateway",
    "cloudflare-ai-gateway",
    "cloudflare-workers-ai",
    "litellm",
    "zenmux",
    "opencode-zen",
    "opencode-go",
    "yolo-auto",
    "tavily",
    "kagi",
    "exa",
    "parallel",
    "typesafe",
    "ollama",
    "ollama-cloud",
    "llama.cpp",
    "vllm",
    "gmi-cloud",
    "singularityapi-dev",
    "singularityapi-tech",
    "coralbricks",
  ].map((id) => [id, true]),
);

/** omp 在 RPC 里直接拒绝登录、要求多步交互提示（企业域名、区域、设备码……）的 provider：这些走应用内终端登录（`startTerminalLogin`）。 */
const terminalLogin: Readonly<Record<string, true>> = Object.fromEntries(
  ["github-copilot", "alibaba-coding-plan", "alibaba-token-plan", "perplexity", "snowflake", "lm-studio"].map((id) => [
    id,
    true,
  ]),
);

export function loginKind(providerId: string): LoginKind {
  if (Object.hasOwn(apiKeyLogin, providerId)) return "api-key";
  if (Object.hasOwn(terminalLogin, providerId)) return "terminal";
  return "oauth";
}
