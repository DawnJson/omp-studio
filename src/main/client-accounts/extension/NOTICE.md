# 第三方代码

`vendor/` 下是原样拷贝的上游文件，只在这里记录来源和更新方式。

## `vendor/qoder/index.mjs`

- 来源：<https://github.com/magpie-community/plugins>，`packages/qoder/index.mjs`
- 包名和版本：`@magpie-community/opencode-qoder-auth` 0.2.37（2026-10-25 取自 `main`）
- SHA-256：`79e0e01be9ac6412924e1b710baeb614aef42af40a17a27e9f6e660d9aea2b6c`
- 许可证：MIT（同仓库 `packages/qoder/package.json`）。它自己是从 magpie 的 `internal/qoder` 移植的，后者移植自 CLIProxyAPI（MIT），声明在 `LICENSE-CLIProxyAPI`。
- 改没改：没改。上游修 bug 时整份替换，然后重算上面的哈希，跑 `test/client-accounts*.test.ts` 和一次真实 omp 冒烟。
- 我们依赖的接口只有 `shim.mjs` 文件头列的那几处（`make({client})`、`auth.methods[].authorize`、`auth.refresh`、`auth.loader`、`provider.models`、`client.auth.set`）；上游改了这些会立刻在测试里失败。

## `vendor/workbuddy/index.mjs`

- 来源：<https://github.com/magpie-community/plugins>，`packages/workbuddy/index.mjs`
- 包名和版本：`@magpie-community/opencode-workbuddy-auth` 0.1.34（2026-10-25 取自 `main`）
- SHA-256：`b48247d241fa22e42e39413b5fbfe69a5d84304b2ed1587278e6100478a214fc`
- 许可证：MIT
- 改没改：没改；升级步骤同上。
- 它有两个登录方式：浏览器登录和"读 WorkBuddy 桌面版已登录的账号"。`adapter.mjs` 的 `pickSignInMethod` 只认 label 里写 `browser` 的那个，读别的应用文件的方式不接（AGENTS.md 的边界）。

## 注意

- 这份代码会读本机的机器信息（`os`、`crypto` 生成的 id）并按 Qoder 客户端的格式签名请求；它不读 Qoder 桌面版的文件（`child_process`、`fs` 的引用只在与本 provider 无关的 campaign/checkin 路径上，`shim.mjs` 不接这些入口）。
- 它冒充 Qoder 客户端发请求，账号风控风险由用户名下的账号承担；登录前界面会提示一次（见计划文档 D4）。
