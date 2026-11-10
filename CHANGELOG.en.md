# Changelog

What changed in each omp-studio release, written for users. Versions follow [SemVer](https://semver.org/): bug fixes bump the patch number, new features bump the minor number.

How to write it:

- This is the English twin of `CHANGELOG.md`. Every entry goes into both files under "Unreleased", grouped as Added / Fixed / Changed, one sentence each about what users see, no implementation details.
- The release script (`npm run release -- <version>`) turns "Unreleased" in both files into `[<version>] - <date>` and refuses to release when either one is empty. The GitHub Release shows this file's section first, then the Chinese one; the in-app changelog follows the UI language.
- Releases before 0.4.55 are only in `CHANGELOG.md` (Chinese); the English UI shows those in Chinese.

## [Unreleased]

### Added

- The command area of bash cards follows omp's readable view: indentation, colours, a × before failed commands, the rest dimmed while running, and folded long chunks that open on click; the right end of the first line switches between Pseudo and Raw (the original command).
- Buttons in omp's dialogs, questions and approvals render as real buttons, and segmented tabs (such as in `/git`) as a segmented control.

### Changed

- In a task, the input box and the elapsed-time / todo line above it sit directly on the background with no band behind them; the conversation fades out above that line instead of being cut off.
- Settings pages fit as many columns as the window allows; each setting takes one or more columns by its content and rows fill up in order with no gaps, and small groups that take a single row (such as "Idle tasks" and "Terminal") sit side by side. Text fields always stay on the same line as their name.
- The send ↔ stop, copy → check, prompt-enhance ✦ ↔ ×, browser reload ↔ stop and sidebar-toggle icons now morph smoothly instead of swapping instantly; with reduced motion they switch at once.

### Fixed

- Session usage now includes the usage omp records separately (background jobs, task completion, title generation, cache warm-ups) and no longer counts spend from before a `/clear`; on real sessions it matches omp's own numbers exactly.
- Works with omp 18.18.5: code blocks with non-contiguous lines (grep, ranged reads, LSP results) show the real line numbers with a `…` row where lines are skipped, and match marks land on the right lines (they used to count 1, 2, 3…).
- Works with the omp 18.15+ background jobs list: jobs started by the model no longer drop out, failed or cancelled jobs are no longer recorded as completed, and eval jobs are no longer labelled bash.
- Rows in the subagent panel no longer flicker: between two tool calls the second line keeps showing the last tool instead of jumping back to the task description, and the elapsed time no longer shifts sideways when "Running" turns into the progress ring.
- Hovering the copy and fork icons under an answer no longer also pops up a Windows-style tooltip (the usage text of the row around them); every hover tip now looks the same.
- In short windows or at large font sizes, tooltips, dropdowns, right-click menus, the slash / @ file / history search menus, the background-jobs card and the model picker no longer extend past the window and scroll when needed, and the input box stays visible with both the side question panel and the terminal open.

## [0.5.2] - 2026-11-09

### Added

- The task menu (the ⋯ in the top bar and on sidebar task rows, or right-click) now has "Session tree", to open the session tree and go back to an earlier message or fork from it.

### Changed

- "Edit" on a user message now only puts the message in the input box for you to change and send; it no longer goes back to before that message, so the message and the replies after it stay in the conversation.

## [0.5.1] - 2026-11-09

### Fixed

- A question with many options no longer gets its lower options and buttons cut off: the question area scrolls when it is taller than the conversation area, and moving to an option out of view with the arrow keys scrolls to it.

## [0.5.0] - 2026-11-09

### Added

- Subagent panel: the details show the subagent's thinking level after its model name (such as `· High`).
- Thinking level can be set to "Auto" (omp picks per turn for the model) for new sessions, in a conversation, and for the default and per-role levels in Settings -> Models; Alt T cycles to it too.
- Hovering a user message shows a fork button: it starts a new task from before that message. Forked sessions are indented under the original in the sidebar, the original's row has an arrow to collapse its forks, and their title no longer gets " (fork)".
- The usage line under an answer has two more buttons, "Copy plain text" and "Fork from here": the forked task keeps the conversation up to that answer. Right-clicking an answer's copy button also offers "Copy Markdown" or "Copy plain text".
- Consecutive tool calls are grouped: once done they collapse into one row (tool icons, "N tool calls", ✓); open it to see each card, Ctrl+O expands all; it can be turned off in Settings -> General.
- The tooltip of the usage line under an answer now shows when the answer finished.
- Sessions in the sidebar (past sessions not attached to a task) can be archived too; the session list has an "Archived" view where opening one restores it.
- Custom providers: after fetching models, tick the ones to add in the list that pops up (search, then select all); each row in the model table has an × to remove it; models the server no longer lists are marked "Not listed" and can be removed in one click (models you add by hand in that dialog aren't marked).
- Session info usage now shows the cache hit rate (cache reads as a share of all prompt tokens); it is hidden when there is no cache data.
- Code blocks in answers have a "Quote in message" button that adds the code, fenced with its language, to the end of your message draft.
- Hovering a user message shows an "Edit" button: it goes back to before that message and puts its text in the composer so you can change it and resend.
- An "Enhance prompt" button left of Send rewrites your draft more clearly with omp's small model and replaces the draft; Ctrl+Z brings the original back. Only the draft is sent and nothing is added to the conversation; Esc cancels it without stopping the task. Without a small or default model configured, the task's own model is used.
- The conversation column can be resized: drag its right edge (or ← / → on the keyboard); the width is kept as a share of the window across restarts, and double-click resets it.
- Hovering the conversation line on the right opens an outline with one row per user message; click a row to jump to that turn. Ctrl+Shift+↑ / ↓ jumps to the previous / next turn (in a text field that has text, these keys still select text).
- Settings -> General -> Terminal picks the shell for the built-in terminal: one found on this machine (PowerShell, cmd, Git Bash, WSL and so on) or an executable you choose; the default is automatic.
- Large pastes also get a card at the top of the composer (line count and first line); open it to preview the text or "Expand into text" to put it back in the draft.
- User messages longer than 12 lines are collapsed in the conversation; click "N more lines" to see all of it.
- omp's questions show a number before each option; press the digit to pick that option (omp itself ignores digit keys).

### Fixed

- Task titles saved before 0.4.55 that were terminal titles (`Administrator: C:\Windows\system32\cmd.exe`, `Windows PowerShell` and the like) are replaced with omp's session title at startup.
- After Ctrl+T / Ctrl+O, omp's status line in the conversation ("Thinking blocks: …", "Tool output expansion: …") updates instead of keeping the first result.
- In resumed sessions every answer has its copy button again (before, only turns that had just run did).
- Picking a thinking level that omp doesn't offer for the model now corrects the level list to what omp actually offers, instead of keeping levels that can't be picked.

### Changed

- Subagent panel: the elapsed time moved from the stats in the details to each row of the list, left of the progress percentage.
- "Remove from list" in the folder menu no longer asks you to archive tasks first: it just hides the folder from the sidebar, tasks are not archived and running ones keep running; opening the folder again brings it back.
- With "Show tool calls as titles only" on, collapsed tool cards show the command's first line or the call's description in the title row, not just "Bash".
- A finished tool card keeps its ✓ in the title row instead of fading it out.
- The tooltip of "Restart session" in the top bar says it reloads the conversation from the session file (use it after editing the session in another omp).
- Custom providers: fetched models no longer all land in the table to be removed by unticking; with "Discover models automatically" on, discovered models show greyed out and read-only in the table, and the tooltip says they can't be removed one by one.
- Archived tasks no longer come back to the session list; open them from the list's "Archived" view to restore.
- The sidebar no longer shows a green check on finished tasks and sessions; only running, waiting, error and interrupted states get an icon.

## [0.4.58] - 2026-11-06

### Added

- Usage and quota: when a provider has several signed-in accounts, the one the current task is using is marked "In use".

### Changed

- Usage and quota: "Syncing…" during a refresh now sits in the title row, left of the update time, aligned with it and the refresh button.
- Output speed (tok/s) moved out of the input box toolbar into "Session usage" in the context ring popover, where the last reply's speed shows even when nothing is generating.

## [0.4.57] - 2026-11-06

### Fixed

- The "Fallback" badge after the model name now goes away once omp switches back to the original model after the cooldown (it used to stay even while Opus was answering).

## [0.4.56] - 2026-11-06

### Added

- Settings → Providers: a signed-in provider's card (such as Anthropic) now has "Add account" in its ⋯ menu; sign in with another account in the browser to add it, and omp switches to another account when one runs out of quota.
- When omp hits an error and switches to a fallback model, a "Fallback" badge appears after the model name in the input box (hover to see which model), and in the subagent details too; the switch notice in the conversation is drawn as a visible warning bar.
- Settings → Model roles: a new "Fallback chains" row shows chains set by model or provider (such as `anthropic/*`); before, only chains keyed by a role were shown.

### Fixed

- With a theme illustration as the background, moving the mouse over the sidebar task list no longer lags a frame on every move: the illustration is no longer redrawn with every repaint of the sidebar or the input box.

### Changed

- omp status lines in the conversation show at most two lines: with many MCP tools, the startup notice listing every mounted tool no longer fills the screen; click "more lines" to see all of it.
- Settings → About → Changelog follows the UI language: the English UI shows English notes (releases before 0.4.55 are in Chinese only); release notes on GitHub list English first, then Chinese.

## [0.4.55] - 2026-11-05

### Added

- Settings → General has a new "Show tool calls as titles only" switch: collapsed tool cards show just their title line, with no output preview; click one or press Ctrl+O to see everything (#8).

### Fixed

- In Settings → About, the result of checking for omp updates ("You're up to date") now sits to the left of the "Check for updates" button, like omp-studio's own, instead of on a separate line below.
- Task titles no longer turn into terminal titles such as `C:\WINDOWS\system32\cmd.exe` or `Windows PowerShell`; omp-studio now uses the session title omp records (#8).
- Opening a session you deleted in omp now explains that the session file was deleted, and sending a message starts a new session in the same task; before, the task only showed a red dot and nothing worked (#8).
- Sessions of archived tasks show up again in the sidebar's session history, and opening one restores the original task; before, archived sessions could not be found again (#8).
- The sidebar's session history refreshes when the window comes back to the foreground, so sessions created or deleted in a terminal appear without restarting (#8).
- A task you just archived (while it can still be undone) no longer blocks "Remove from list" on its folder (#8).
- Tool cards you opened can be collapsed again with Ctrl+O.
- Settings → Integrations → MCP: a successful connection test shows just "Connected, N tools", with the tool names in the tooltip; before, every tool name was listed on the card, making it very tall when a server had many tools.
