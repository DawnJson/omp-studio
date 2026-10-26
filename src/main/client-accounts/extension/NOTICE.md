# 第三方代码

`vendor/` 下是 [magpie 社区插件](https://github.com/magpie-community/plugins) 的原样拷贝（每个包只取运行要的文件），MIT 许可，全文见 `vendor/LICENSE`。

| 目录 | npm 包 | 版本 |
|---|---|---|
| `vendor/autoclaw/` | `@magpie-community/opencode-autoclaw-auth` | 0.2.8 |
| `vendor/codearts/` | `@magpie-community/opencode-codearts-auth` | 0.2.1 |
| `vendor/commandcode/` | `@magpie-community/opencode-commandcode-auth` | 0.1.17 |
| `vendor/joycode/` | `@magpie-community/opencode-joycode-auth` | 0.1.1 |
| `vendor/kiro/` | `@magpie-community/opencode-kiro-auth` | 0.1.16 |
| `vendor/mimo/` | `@magpie-community/opencode-mimo-auth` | 0.1.9 |
| `vendor/minimax/` | `@magpie-community/opencode-minimax-auth` | 0.1.5 |
| `vendor/nous/` | `@magpie-community/opencode-nous-auth` | 0.1.1 |
| `vendor/opendesign/` | `@magpie-community/opencode-opendesign-auth` | 0.1.7 |
| `vendor/qoder/` | `@magpie-community/opencode-qoder-auth` | 0.2.37 |
| `vendor/raccoon/` | `@magpie-community/opencode-raccoon-auth` | 0.1.3 |
| `vendor/trae/` | `@magpie-community/opencode-trae-auth` | 0.2.22 |
| `vendor/workbuddy/` | `@magpie-community/opencode-workbuddy-auth` | 0.1.34 |
| `vendor/zcode/` | `@magpie-community/opencode-zcode-auth` | 0.1.30 |
| `vendor/zed/` | `@magpie-community/opencode-zed-auth` | 0.1.11 |
| `vendor/zen-free/` | `@magpie-community/opencode-zen-free-auth` | 0.1.15 |

npm 上没有发布的（codearts、joycode、raccoon、nous、autoclaw）取自社区仓库 `main` 的 `packages/<名字>/`。包里自带的 `LICENSE` 原样保留。

升级：整个目录替换，改上表版本，跑 `test/client-accounts*.test.ts`（含 `STUDIO_REAL_OMP=1` 的真实 omp 一组）和一次真实账号冒烟。
