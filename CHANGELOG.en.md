# Changelog

What changed in each omp-studio release, written for users. Versions follow [SemVer](https://semver.org/): bug fixes bump the patch number, new features bump the minor number.

How to write it:

- This is the English twin of `CHANGELOG.md`. Every entry goes into both files under "Unreleased", grouped as Added / Fixed / Changed, one sentence each about what users see, no implementation details.
- The release script (`npm run release -- <version>`) turns "Unreleased" in both files into `[<version>] - <date>` and refuses to release when either one is empty. The GitHub Release shows this file's section first, then the Chinese one; the in-app changelog follows the UI language.
- Releases before 0.4.55 are only in `CHANGELOG.md` (Chinese); the English UI shows those in Chinese.

## [Unreleased]

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
