# 阶段 3.3 设计方向：主区纯白 + 新任务页概览

> 状态：**大部分已撤回**。2026-10-27 实现、同日仓库所有者同意；当天稍晚仓库所有者觉得设置页等处“一块一块的、看着丑”，要求把 3.3 和之后的质感改版（`ab02ed2`）一起撤掉，**只留侧栏文件夹头的箭头位置和新任务页的“本周用量”**（新任务页保留 π + “开始一个任务” + 本周用量的排法，去掉“最近会话”）。现行取值以 `spec.md` 为准（§2.2、§2.3、§4.3、§4.7），下面是当时的方案，留作记录。
>
> 范围：在 3.2（统一控件、设置页重排）之上，只动外观层级：主区面板、圆角、新任务页、bash / eval 卡片的输出区、几处数字的字体，外加侧栏文件夹头的箭头位置。过程区的结构、控件库、设置页、侧栏行不变。

## 1. 改了什么

| 区域 | 3.2 | 3.3 |
|---|---|---|
| 主区面板 | `--bg-app` `#FAFAF9` + 1px `--border` | 浅色纯白 `#FFFFFF`，不描边，一层 `--shadow-panel`（`0 1px 2px` + `0 6px 20px`，都是 5%）；深色 `--shadow-panel: none`，靠主区 `#151514` 和侧栏 `#0F0F0E` 的明度差分开 |
| 圆角 | `--radius-lg` 8、`--radius-xl` 10 | 12、14（卡片 / popover / 门 12，对话框 / 命令面板 / 主区面板 14）；xs / sm / md 不变 |
| bash / eval 卡片 | 命令和输出同一块 `--bg-tool`，中间一条 `--border-subtle` 线 | 输出是灰托盘里的一张内卡：新 token `--bg-inset`（浅色 `#FFFFFF`、深色 `#111110`），`--radius-md`，外边距上下 4、左右 8，上下内边距 8，没有分隔线 |
| 数字的字体 | 会话费用、用量仪表、项目路径标签用 `--font-mono` | 都换成 UI 字体 + `tabular-nums`；等宽只留给代码、命令和要原样照抄的标识符 |
| 文件夹头 | `[箭头][名称]` | `[名称][箭头]`：箭头紧跟名称，名称太长被省略时箭头不被挤掉；高度、字号不变 |
| 新任务页 | 居中一幅像素标志（π + `omp studio` + 版本号），下面“最近更新” | π + 标题一行、本周用量卡片、最近会话，整块在输入框上方竖直居中；见第 2 节 |

## 2. 新任务页

不画 `omp studio` 字标（顶栏已经有品牌），不用 `StudioHeader`（它只留在过程区顶部）。自上而下：

1. **π + 标题**：36 高的像素 π（不用 `crispEdges`，36 不是像素的整数倍）+ “开始一个任务”（`--font-display` `--fs-xl` 600）。升级后第一次启动时，“最近更新”在标题下面一行，和标题左对齐。
2. **本周用量**：近 7 天 token（28px）+ 费用、右上“今天 N”小标签；下面 12 周 × 7 天 = 84 列、每列最多 6 个点的点阵，铺满卡片宽。较早的日子灰（`--text-3` 55%），最近 7 天 `--accent` 60%，今天满 `--accent`。数据和用量对话框是同一份热力图缓存（`getUsageHeatmap`）。没有统计库时只写一句说明，读失败时不显示卡片。
3. **最近会话**：最近活动的 4 个任务，两列小卡片（窄于约 560px 一列），标题 + `项目 · 相对时间`，点开就是选中任务。一个任务都没有时不显示。

卡片都是 `--bg-raised` + 1px `--border-subtle` + `--radius-lg`，不加阴影（浅色主区本身是白的，靠细线分开）。概览比窗口高时整页滚动，输入框 sticky 贴底。

## 3. 仓库所有者的决定（2026-10-27）

| # | 决定 |
|---|---|
| 1 | 主区浅色纯白、不描边、淡阴影；深色不加阴影，只靠明度差 |
| 2 | 圆角 lg 8 → 12，xl 10 → 14 |
| 3 | bash / process 卡片的输出放进托盘里的 `--bg-inset` 内卡，取代分隔线 |
| 4 | 等宽字体只给代码、命令；费用、用量仪表、项目路径标签用 UI 字体 + tabular 数字 |
| 5 | 侧栏文件夹头的**箭头放到项目名右边** |
| 6 | 新任务页按第 2 节：π + “开始一个任务”、标题下的最近更新、“本周用量”卡片、“最近会话”，整块在输入框上方竖直居中 |

## 4. 代码

- token：`src/renderer/styles/tokens.css`（`--radius-lg/xl`、`--bg-app`、`--bg-inset`、`--shadow-panel`，三处主题块都加了）。
- 主区：`src/renderer/src/app/app.css` 的 `.panel`。
- 过程卡片：`src/renderer/src/features/tsp/tsp.css` 的 `.tsp-tool-body .tsp-col > .tsp-code + .tsp-ansi`。
- 字体：`features/composer/composer.css`（`.session-cost`、`.usage`）、`features/empty/empty.css`（`.empty-project-name`）。
- 侧栏：`features/sidebar/FolderGroup.tsx`、`sidebar.css`（`.sb-chevron`）。
- 新任务页：`features/empty/EmptyState.tsx`、`EmptyMark.tsx`、`UsageCard.tsx`、`usage-overview.ts`（`test/usage-overview.test.ts`）、`RecentTasks.tsx`、`empty.css`；文案 `src/shared/i18n/*/empty.ts`（`spec.md` 附录 A.3）。

## 5. 之后被质感改版改掉的（2026-10-27）

同一天的质感改版（中文字体打包、四层表面、发丝线和受光边，现行取值见 `spec.md` §1.2、§2.2、§2.5）改了上面几行，以 `spec.md` 为准：

- 主区面板：`--shadow-panel` 自带一圈发丝线（浅色 5% + `0 1px 2px` 4% + `0 6px 24px -6px` 7%）；深色不再是 `none`，是一圈 `rgba(232, 232, 228, 0.06)` 发丝线。主区深色 `#171716`、侧栏 `#0E0E0D`，浅色侧栏 `#F1F0ED`。
- bash / eval 输出：不再是“灰托盘里的白卡”，而是卡片里凹下去的一块：`--bg-inset` 改成 `#F4F4F1` / `#121211`，外边距 `0 --space-3 --space-2`、内边距 `--space-2 --space-3`。卡片本身是近白的 `--bg-tool`（`#FAFAF8`）+ 1px `--border-subtle` 发丝线。
- 新任务页的卡片：`--bg-tool` + 1px `--border-subtle`（原来 `--bg-raised`）；用量合计改用 `--font-display` + `--ls-tight`，费用 `--text-3`。
- 过程区顶部的 `StudioHeader` 也改成 π + 文件夹名 + 路径的排法（`spec.md` §4.14），不再画整幅像素标志和版本号。

## 6. 撤回（2026-10-27）

撤回提交 `c4d1a84`（3.3）和 `ab02ed2`（质感改版）。回到 3.2 的：主区 `--bg-app` + 1px `--border`、圆角 lg 8 / xl 10、bash 输出和命令同一块底、费用 / 用量 / 项目路径等宽字体、中文落到系统字体（不再打包思源黑体）、设置分组不是卡片、过程区顶部的整幅像素标志 + 版本号。

保留：

| 项 | 现在 |
|---|---|
| 侧栏文件夹头 | `[名称][箭头]`（第 1 节） |
| 新任务页 | π + “开始一个任务”、升级后第一次启动的最近更新、“本周用量”卡片（第 2 节第 1、2 项，卡片 `--bg-raised` + 1px `--border-subtle` + `--radius-lg`）；**没有“最近会话”**（`RecentTasks.tsx`、`empty.recentTitle` 已删） |
