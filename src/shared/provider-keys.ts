// 设置页能输入 API key 的 provider：omp provider id → 注入给 omp 的环境变量名。
// 变量名出自 omp 文档 environment-variables.md §1（omp 18.12.0 随附）；provider id 取自该表"Using `<id>` provider"
// 一列，没有写 id 的行按 omp 的 provider 命名推断 [推测]。表里没有的 provider 不能用 API key 路线（用 OAuth 或终端登录）。
const providerKeyEnv: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  together: "TOGETHER_API_KEY",
  huggingface: "HUGGINGFACE_HUB_TOKEN",
  synthetic: "SYNTHETIC_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  nanogpt: "NANO_GPT_API_KEY",
  novita: "NOVITA_API_KEY",
  venice: "VENICE_API_KEY",
  litellm: "LITELLM_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  stepfun: "STEPFUN_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  zai: "ZAI_API_KEY",
  "zhipu-coding-plan": "ZHIPU_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-code": "MINIMAX_CODE_API_KEY",
  "minimax-code-cn": "MINIMAX_CODE_CN_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
  "opencode-zen": "OPENCODE_API_KEY",
  qianfan: "QIANFAN_API_KEY",
  "qwen-portal": "QWEN_PORTAL_API_KEY",
  zenmux: "ZENMUX_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  "siliconflow-cn": "SILICONFLOW_CN_API_KEY",
  kilo: "KILO_API_KEY",
  "ollama-cloud": "OLLAMA_CLOUD_API_KEY",
  "cline-pass": "CLINE_API_KEY",
  baseten: "BASETEN_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  "alibaba-coding-plan": "ALIBABA_CODING_PLAN_API_KEY",
  "alibaba-token-plan": "ALIBABA_TOKEN_PLAN_API_KEY",
};

/** provider 对应的环境变量名；这个 provider 不支持 API key 路线时为 null。 */
export function apiKeyEnvName(providerId: string): string | null {
  return Object.hasOwn(providerKeyEnv, providerId) ? (providerKeyEnv[providerId] ?? null) : null;
}
