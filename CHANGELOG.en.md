# Changelog

What changed in each omp-studio release, written for users. Versions follow [SemVer](https://semver.org/): bug fixes bump the patch number, new features bump the minor number.

How to write it:

- This is the English twin of `CHANGELOG.md`. Every entry goes into both files under "Unreleased", grouped as Added / Fixed / Changed, one sentence each about what users see, no implementation details.
- The release script (`npm run release -- <version>`) turns "Unreleased" in both files into `[<version>] - <date>` and refuses to release when either one is empty. The GitHub Release shows this file's section first, then the Chinese one; the in-app changelog follows the UI language.
- Releases before 0.4.55 are only in `CHANGELOG.md` (Chinese); the English UI shows those in Chinese.

## [Unreleased]

## [0.8.6] - 2026-11-13

### Fixed

- When a resumed session used one of several same-named models, the identified provider was occasionally not saved with the task, so reopening it could start with another provider's model of the same name.

## [0.8.5] - 2026-11-13

### Fixed

- macOS: with the desktop pet on, the app no longer disappears from the Dock, the menu bar and the Force Quit list, and the pet now also floats above other apps' full-screen windows.
- Windows: the desktop pet is no longer covered by other always-on-top windows.
- Text fields in question forms delete only one character per Backspace or Delete, arrow keys move one character at a time, and typed text or digits are no longer duplicated; pressing Enter on a link in a question only opens the link instead of also sending Enter to omp.

### Changed

- In Settings → Integrations & plugins, the "Scope" label in the page header is now an icon: a globe for user scope, a folder for a project; hover shows "Scope".
- In Settings → Integrations & plugins, Add, Test connection, Upgrade, Details, Browse, Update catalog, Install, and the diagnostics Run and Fix are now icon buttons, and a lone Delete, Remove, or Uninstall at the end of a row is a trash icon; hovering shows the original text.

## [0.8.4] - 2026-11-12

### Fixed

- Quitting while a session is being deleted now also ends the temporary omp process used for the deletion instead of leaving it running.
- Plan Review adapts to the window width with a narrower contents list; both panes scroll independently, table columns remain readable, and actions stay reachable in short windows.

### Changed

- omp 18.14.1 is now the minimum version: older omp can't delete sessions that aren't running, and Settings and the input box ask you to update.

## [0.8.3] - 2026-11-12

### Fixed

- After reopening a session that used subagents, "Close session" and "Restart session" are no longer stuck greyed out, and the session closes on its own when idle again.

## [0.8.2] - 2026-11-12

### Added

- "Close session" in the task menu (sidebar right-click, ⋯, top bar ⋯) and the command palette: ends the task's omp process but keeps the conversation; opening the task or sending a message picks the same session back up. Close it here before continuing the session in a terminal, so the terminal doesn't fork an identical copy of it.

### Fixed

- In a long conversation, the side question panel (`/btw`) and the terminal are no longer squeezed into a thin strip with their text cut off; in a very short window only the answer area shrinks, and the header and input row stay whole.
- Opening a session that an omp in a terminal has open no longer silently forks a new session; it says "This session is open in another omp. Quit it there, then send again."
- Typing `/prewalk` in the composer turns Prewalk on directly, like in the terminal; `/prewalk status` still opens the model picker.
- Session toggle slash commands (`/skillful on`, `/browser headless`, `/prewalk` and others) now show omp's reply instead of giving no feedback.

## [0.8.1] - 2026-11-11

### Added

- The pet now has achievements: finishing a phase of the todo list, completing a goal or opening a pull request makes it throw confetti, say something and earn a big chunk of experience.
- The pet keeps growing after its final form: from Lv40 it gains a decoration every 10 levels (a flower, a mushroom, a butterfly, grass, a star), a gold outline at Lv90 and a rainbow outline at the Lv99 cap, with a ★ before its name on the stats card. The stats card also shows how many days you've been together and your check-in streak.

### Fixed

- The pet's speech bubble and stats card no longer cast a large grey shadow that looked like leftover background over the desktop and other windows.

### Changed

- The pet's "Hatch a new pet" confirmation now looks like the rest of omp-studio's confirmations and opens right above the pet instead of as a system dialog.
- The pet now gains experience in real time from what your tasks actually write (output tokens): more writing means more experience, with diminishing returns; simply finishing a turn no longer gives experience.
- The pet no longer wobbles side to side: every animation moves only up and down, it slumps on errors, and the egg follows its mood too.

## [0.8.0] - 2026-11-11

### Added

- Desktop pet: a small pixel pet lives on your desktop. It stays wherever you drag it, always on top and out of the taskbar. Its face follows your tasks: it sweats while one runs, raises a hand when one waits for you, gets dizzy on errors and cheers when a turn finishes. Click to pet it, double-click to open omp-studio (jumping to the task that needs you), right-click for its stats card, talk toggle, hatching a new one, or hiding it.
- Each machine gets its own pet: species (7, including π), rarity, hat and stats are drawn from a local seed, and a small model (omp's tiny role, or smol when tiny isn't set) names it and writes its personality the first time it appears. You can rename it from the stats card.
- The pet grows: finished turns, answered approvals, tasks fixed after an error and a daily check-in give experience. It hatches at Lv 5, grows up at Lv 15 and reaches its final form at Lv 30, looking different at each stage, and its stats slowly rise with how you work.
- The pet talks: a speech bubble when a task finishes, fails or waits for you, when you pet it, and when it levels up. Each line is one small-model call on your own account that only gets the task status and title, never the conversation. Turn it off in Settings -> General -> Desktop pet or from the right-click menu; the same place shows how many calls, tokens and dollars it has spent today and in total. The `/pet` command can also pet it, open the stats card, toggle talking or showing, and rename it.

## [0.7.9] - 2026-11-11

### Fixed

- The Files, Subagents and Browser panels on the right now slide back out when you close them instead of vanishing at once. Hover tips, the jobs card above the input box, sidebar status dots and the green dots on the tabs fade out too, matching how they appear.

## [0.7.8] - 2026-11-11

### Changed

- Connected cards in Settings -> Providers now use icon buttons like the custom provider cards: a key to set or replace the key, a door arrow to sign out or clear the key, a person with a plus to add an account, each explained on hover; the buttons sit on the right and names are no longer cut short by them.
- Cards no longer show the internal ids omp gives accounts (a UUID, `OAuth credential #9`, `API key #6` and the like), only the status badge; emails and user names still show.

## [0.7.7] - 2026-11-11

### Added

- The Projects and Chats tabs in the sidebar also get the small green dot: a tab lights up when it holds a task that finished in the background and you haven't opened yet.

### Fixed

- With the frosted-glass effect on, the sidebar's Tasks header (with the Projects / Chats / Archive tabs) scrolled away with the list; it now stays put while you scroll.

### Changed

- Past sessions and the Archive tab show up sooner after launch: the session index is kept on disk, so unchanged sessions aren't read again after a restart (from about 2 seconds to a few milliseconds with a few hundred sessions).
- Opening Settings is faster: omp settings aren't read again when they haven't changed.
- The model picker shows the model list it last read right away and swaps in the fresh list when it arrives, instead of placeholder rows first.

## [0.7.6] - 2026-11-10

### Added

- Files in the file panel, the preview title and composer attachments now show a colored icon for their type (ts, py, pdf, images and so on are easy to tell apart), and common folders such as src, docs and test have their own icons.
- In the sidebar, a task that finished in the background and you haven't opened yet gets a small green dot and a brighter title; a collapsed folder shows the dot on its header too. Opening the task clears it.

### Fixed

- "Copy session ID" and "Copy session file path" in the task menu now show a "Copied" toast.

### Changed

- Custom provider cards in Settings now show three lines: name, endpoint, and model tags (extras fold into +N, hover to see all); the icon shows which company the models come from (OpenAI, Claude, Gemini, Grok, ...); edit and delete are a pencil and a trash icon, and delete asks first.
- Copy buttons now turn into a check mark after copying and then back (side question, todo board, copy command on tool cards, restored copy-answer, login dialog link) instead of showing a "Copied" toast; tool and bash cards turn their spinner into ✓ / × when they finish, and the approval chip and the API key show/hide button (now an eye icon) morph their icon too.
- The three omp notification settings (asks waiting for you, task finished, task failed) are now switches instead of On / Off segments, matching the other switches in that group.
- The add / edit custom provider dialog now fits its content, so there's no big empty area before any models are added; its top stays put and it only grows downward.
- Confirmation dialogs (delete, discard, ...) no longer have a × in the corner; close them with Cancel or Esc.
- All controls have a cleaner look (modeled on shadcn/ui): buttons, inputs and dropdowns have slightly rounder corners, secondary buttons and inputs sit on a white surface with a light shadow; checked switches and checkboxes use the black/white primary color instead of purple; focused inputs get a light gray border and ring, and the keyboard focus ring is thicker; menus and popovers have a thin border; tooltips are dark with light text; badges are solid small tags that stay readable in every theme. Hand-made buttons and tags in the conversation, sidebar and Settings now follow the same style.

## [0.7.5] - 2026-11-10

### Fixed

- Local images referenced in an answer no longer show up as a single word: images inside the task folder are shown inline and open in the side panel when clicked; images elsewhere appear as a link with an image icon, with the path on hover.

## [0.7.4] - 2026-11-10

### Fixed

- A table in an answer with a long file name or path no longer squeezes the other columns to one word per line and cuts them off on the right: file names now wrap at _, / and `.`.

### Changed

- You now decide the order of sidebar folders: drag a folder to move it (or press Alt+↑ / Alt+↓ on its header), and a finished task no longer moves its folder to the top; new folders appear at the top.
- The sidebar list is split into "Projects | Chats | Archive": Projects holds your folders, Chats holds tasks that don't belong to a project (where new tasks start), and Archive holds archived sessions; the old "Time" view is gone. Selecting a task in the other view switches the sidebar to it.

## [0.7.3] - 2026-11-10

### Fixed

- Tasks set to "Keep running" now show a bolt icon after their title in the sidebar.

## [0.7.2] - 2026-11-10

### Added

- HTML, SVG, Mermaid and Markdown code blocks in answers can be previewed in the right file panel ("Preview in side panel" in the block header).
- HTML previews now run inline scripts when "Run scripts" is on; pages load in an isolated sandbox with no network access and no access to the app.

### Changed

- The tool-call group head now shows each tool's icon with its call count and the group's total time; hover lists every call.

### Fixed

- Your message bubbles no longer have a doubled inner padding; each side is back to the designed width.
- Pressing Ctrl+Shift+↑ at the bottom of a conversation to go back one message no longer occasionally skips one.
- In conversations whose context was compacted, the hover tip on each answer's usage line now shows the cache hit rate and finish time too (they used to disappear after any compaction).
- After you've dragged the input box's height, it grows with its content again (the dragged height is the minimum, up to 60% of the main area); it used to stay at a fixed height forever after one drag.
- Diagrams in ask forms (and other SVG images omp sends) no longer render as solid black blocks; their colours follow the current theme.
- In the subagent panel, two running subagents no longer keep swapping places in the list, and the details below no longer flicker between them.

## [0.7.1] - 2026-11-10

### Added

- The hover tip on each answer's usage line and the per-model session usage in the composer's bottom-right now show the cache hit rate.
- Conversations can now be deleted for real: "Delete conversation…" in the task menu (sidebar right-click, ⋯, or the top bar ⋯) and in archived conversations' menus deletes the session file through omp after a confirmation; it refuses while another omp has the conversation open.

### Changed

- Usage and quota dialog: when there are many accounts or the window is short, only the subscription-quota section scrolls; the summary strip at the top and the heatmap at the bottom stay fixed.
- With "Discover models automatically" on, a custom provider's model table is the full list the service offers, with no grey read-only rows: every model's reasoning, image input, context window and max output can be set, and models the service drops disappear after a model refresh. "Fetch models" and the "not listed" controls are hidden while it's on.

### Fixed

- Typing English with an input method in English mode no longer doubles every letter in the ask dialog's custom answer box (and other omp input boxes and picker search boxes).
- Tasks whose conversation was deleted in omp no longer stay in the sidebar: they're removed at startup and when the window regains focus (deleting one side of a fork no longer leaves two same-named conversations that both open).
- Hover tips no longer sometimes turn into the native Windows style: scrolling, pressing a key, or clicking while a tip is showing no longer makes a native tip pop up when the pointer moves, and the tick marks on ring charts in the conversation use the app's own tips too.

## [0.7.0] - 2026-11-10

### Added

- Conversations can be pinned: choose "Pin to top" in the task menu (sidebar right-click, ⋯, or the top bar ⋯) and the conversation moves to the top of its folder, the folder moves up (after the default folder), and the row shows a pin. Pins are shared with terminal omp's resume list. "Keep running" now uses a bolt icon.

### Changed

- The file preview tree's arrows now rotate when a folder opens instead of swapping icons.

### Fixed

- Built-in client accounts no longer vanish when an agent inside a task runs `omp usage`, `omp models`, `omp commit` and similar commands; a studio launched from a task's terminal now shows their quotas in the usage dialog.
- The usage dialog now shows a full quota card for accounts whose windows are all at 0%, instead of folding them into a final "Untouched" line that listed only provider names.

## [0.6.0] - 2026-11-09

### Added

- The command area of bash cards follows omp's readable view: indentation, colours, a × before failed commands, the rest dimmed while running, and folded long chunks that open on click; the right end of the first line switches between Pseudo and Raw (the original command).
- Buttons in omp's dialogs, questions and approvals render as real buttons, and segmented tabs (such as in `/git`) as a segmented control.

### Changed

- In a task, the input box and the elapsed-time / todo line above it sit directly on the background with no band behind them; the conversation fades out above that line instead of being cut off.
- Settings pages fit as many columns as the window allows; each setting takes one or more columns by its content and rows fill up in order with no gaps, and small groups that take a single row (such as "Idle tasks" and "Terminal") sit side by side. Text fields always stay on the same line as their name.
- The send ↔ stop, copy → check, prompt-enhance ✦ ↔ ×, browser reload ↔ stop and sidebar-toggle icons now morph smoothly instead of swapping instantly; with reduced motion they switch at once.

### Fixed

- The "Retry turn" item in the answer menu shows its icon again (omp 18.18.6).
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
