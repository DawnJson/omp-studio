# 第三方代码

`vendor/` 下是 [magpie 社区插件](https://github.com/magpie-community/plugins) 的原样拷贝，MIT 许可，全文见 `vendor/LICENSE`。

| 文件 | npm 包 | 版本 | SHA-256 |
|---|---|---|---|
| `vendor/qoder/index.mjs` | `@magpie-community/opencode-qoder-auth` | 0.2.37 | `79e0e01be9ac6412924e1b710baeb614aef42af40a17a27e9f6e660d9aea2b6c` |
| `vendor/workbuddy/index.mjs` | `@magpie-community/opencode-workbuddy-auth` | 0.1.34 | `b48247d241fa22e42e39413b5fbfe69a5d84304b2ed1587278e6100478a214fc` |

`vendor/qoder/LICENSE-CLIProxyAPI` 随上游包原样保留。

升级：整份替换，重算哈希，跑 `test/client-accounts*.test.ts` 和一次真实 omp 冒烟。
