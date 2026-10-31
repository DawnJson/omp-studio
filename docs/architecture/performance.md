# 性能：怎么量、怎么比

界面层面的性能规则（只动 `transform` / `opacity`、循环动画只放 HTML 盒子、不写 `:has()`、`content-visibility`、计时器）在 `docs/design/spec.md` §2.6「性能规则」和 §5.4 第 6、8 条；对话区的 `content-visibility` 在 [conversation.md](conversation.md)；主进程合批的计时在 [tsp-migration.md](tsp-migration.md) §7「批次」。这里写怎么量。

## 已经由检查拦住的

- 按需加载的视图用 `ui/lazy-view.ts`，不用 `React.lazy` + `Suspense`（oxlint `no-restricted-imports` / `no-restricted-properties`）：Suspense 从 fallback 换成内容时要等上次显示 fallback 之后满 300ms，chunk 早就载好也一样（2026-10-27，命令面板首开 17 → 318ms）。
- 对话区、侧栏的样式表不写 `:has()`（`scripts/check.ts` 的 `css-has`，`tsp.css` 里两处在允许清单里并写了原因）。
- 根元素（`#app`）属性上挂的选择器不以 `> *` 结尾（`css-app-child-wildcard`）：`#app[data-sidebar] .sidebar-column > *` 让属性一变整页重算样式（37ms → 3ms）。
- 渲染进程整秒显示的计时不用固定 1000ms 的 `setInterval`（`interval-1000`），用 `useNow(enabled, anchor)` 对齐到计时起点。

## 量之前

- **在长对话里量**（上千个块、约 2 万个元素），不凭短对话的手感：短对话里样式重算、排版都只有几毫秒，看不出来。
- **对比要交错跑**：同一份构建、同一台机器，两组快照交错（A、B、B、A…）比较，不拿分开两批跑的数字比；结论写明场景和轮数。同一个提交分两批测，启动时间能差 22–46%；交错跑的同提交两组 150 个指标零误判（2026-10-27）。
- **每项改动在真实应用里跑一遍再决定留不留**，凭推理加的优化常常不赚：`app://` 开 `codeCache` 后热启动反而慢 6%，主进程压缩对启动没有可测的影响，跨任务合并 TSP 批次让 IPC 消息少了 63% 但 CPU 没变，都撤掉了。

## 卡顿和空闲 CPU

- 不只看 CPU% 和帧率（多任务卡顿时 CPU 只有 2–4%、帧率 144）。用 CDP trace（`devtools.timeline` + `disabled-by-default-devtools.timeline.invalidationTracking` + `blink.animations`）数 Layout / 样式重算的次数和原因：一次 15 秒的 trace 里排版 2170 次，来源是 SVG 动画，挪到 HTML 盒子后 257 次（2026-10-25）。
- **查空闲占 CPU**：不在页面里挂 `requestAnimationFrame` 数帧，它本身就让主线程每帧都跑，会把真正逼主线程出帧的东西盖住。用 CDP `Tracing` 不加任何输入录 3 秒，数 `ProxyMain::BeginMainFrame`，再看 invalidationTracking 里每帧是谁失效（2026-10-28：设置页上每秒 400 多个主线程帧，来源是停着的对话里一个转圈的工具卡）。
- 循环动画的目标必须是 HTML 元素：SVG 里的元素和 `<svg>` 自己的 transform / opacity 动画在 Electron 44 里都交不给合成器（trace 里 `compositeFailed`），只把 transform 从 `<circle>` 挪到 `<svg>` 上没用。放在 `content-visibility: hidden` 里的循环动画同样交不给合成器。这一条没有检查脚本，评审时看。
- 单个 DOM 改动的代价：Playwright + CDP `Performance.getMetrics` 看样式 / 排版耗时，再对改动强制读一次 `offsetHeight` 计时。
- 侧栏、面板的开合不要过渡 `width`：主区每帧变宽，整段对话每帧重排（1100 宽的窗口里一次开合排版 60ms+）。
- 主进程限速、合批或逐帧动画不写 `setTimeout(16)` / `setInterval(16)`：Windows 上按系统时钟格（约 15.6ms）对齐，实际要等约 31ms。合批用 `src/main/platform/batch-timer.ts`，逐帧动画写 10ms。动画"不明显"时先把每一帧的时间和值打出来看。
