# 7. “手感”验收清单（每个阶段都按此验收）

1. 动画只用 `transform`/`opacity`（+折叠用的 `grid-template-rows`）；reduced-motion 开启后 `getAnimations()` 中无位移/缩放动画。
2. 流式时选区不丢；已冻结块的 DOM 节点引用不变（测试：分 1/5/50 字符一帧喂入，最终 DOM 与一次性渲染一致）。
3. 上滚 1 个滚轮格后不再被拉回；吸底时 `scrollTop + clientHeight == scrollHeight`（±1）。
4. 缩放窗口：锚点块的视口偏移变化 ≤2px。
5. IME 组合态 `Enter` 不发送；组合结束后才发送。
6. `Esc` 停止不丢字（排队消息放回草稿）。
7. 门：输入框里 `Enter` 不会批准（有草稿 = 拒绝并发送，空草稿不动作）；`Ctrl+Enter` = 批准、`Ctrl+O` = Details；提问时发送键禁用；门被 omp 撤掉后焦点回到 studio 输入框（§4.17）。
8. 英文长文案不撑破胶囊/按钮/侧栏（无溢出、无意外换行）；越界用 e2e 断言（`test/e2e/launch.ts` 的 `expectNoOverflow`），中英文各查一次。
9. Tab 顺序与 `F6` 循环可预期；侧栏列表只占一个 Tab 停靠点。
10. 冷启动到可输入 <1.5s（窗口先出骨架，omp 握手在后台）；流式时主线程每帧脚本 <8ms。
11. `tokens.css` 的两份深色块、两份 reduced-motion 块一致（单元测试）。

---
