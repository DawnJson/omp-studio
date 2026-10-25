<div align="center">
  <img src="docs/images/icon.png" width="128" height="128" alt="omp-studio icon">
  <h1>omp-studio</h1>
  <p>A desktop app for <a href="https://github.com/can1357/oh-my-pi">oh-my-pi</a> (omp). It runs the official, unmodified omp and shares logins, settings and sessions with the terminal version.</p>
  <p><a href="README.md">简体中文</a> · <b>English</b></p>
  <p>
    <a href="#download">Download</a> ·
    <a href="docs/architecture/">Docs</a> ·
    <a href="CHANGELOG.md">Changelog</a> ·
    <a href="https://github.com/DawnJson/omp-studio/issues">Feedback</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows&logoColor=white" alt="Windows x64">
    <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&logoColor=white" alt="macOS Apple Silicon">
    <img src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white" alt="Electron 44">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT"></a>
  </p>
</div>

<table>
  <tr>
    <td width="50%"><img src="docs/images/conversation-light.png" alt="omp-studio in the light theme: a finished task with the todo board, two subagents, pytest output and the answer"></td>
    <td width="50%"><img src="docs/images/conversation-dark.png" alt="The same task in the dark theme"></td>
  </tr>
</table>

**`Ctrl+K` command palette**

![Ctrl+K command palette](docs/images/command-palette.png)

**Settings → General: appearance, notifications, keyboard shortcuts**

![Settings → General: appearance, notifications, keyboard shortcuts](docs/images/settings.png)

## Download

| Windows (x64) | macOS (Apple silicon) |
| --- | --- |
| [`omp-studio-<version>-setup.exe`](https://github.com/DawnJson/omp-studio/releases/latest) | [`omp-studio-<version>-arm64.dmg`](https://github.com/DawnJson/omp-studio/releases/latest)<br>[`omp-studio-<version>-arm64-mac.zip`](https://github.com/DawnJson/omp-studio/releases/latest) |

### System requirements

| | Windows | macOS |
| --- | --- | --- |
| OS | Windows 10 / 11 | macOS 13 Ventura or later |
| Chip | x64 | Apple silicon (arm64) |

- **Windows**: Double-click the installer. It installs into your user directory and does not need administrator rights. The installer is unsigned, so on first run click "More info → Run anyway" in SmartScreen.
- **macOS**: Drag `omp-studio.app` into Applications. The app is ad-hoc signed. Before opening it the first time, run `xattr -cr /Applications/omp-studio.app` in Terminal, or click "Open Anyway" in System Settings → Privacy & Security.

omp-studio is in private beta (`0.x`). The repository is private; Releases and Issues are open to collaborators.

## Features

### Tasks and conversations

- Each task runs interactive omp in a pseudo-terminal. The UI renders the nodes omp sends over the TSP protocol, and tool cards and thinking blocks expand and collapse the same way as in the terminal version.
- The sidebar lists tasks by project, including omp sessions you started in a terminal. Open one to continue the conversation.
- Approvals and questions appear above the input box. When a task is waiting for you, a banner appears at the top of the sidebar; `Ctrl+J` jumps to it.
- When the window is in the background, the taskbar flashes and system notifications follow omp's notification settings. Closing the window leaves the app in the tray, and tasks keep running.

### Subagents and background jobs

- The todo board, subagents and background jobs sit above the input box.
- The subagents panel shows each subagent's output. You can send it a message, stop it, or resume it.
- `/btw` asks a side question in a side panel without interrupting the main conversation.

### Review, git and terminal

- Review (`Ctrl+Shift+D`) stages or discards changes by file or by line, and omp can write the commit message.
- The branch menu commits, pushes, creates PRs and merges. New tasks in a git repository can run in a separate worktree.
- The built-in terminal (``Ctrl+` ``) opens in the task's working directory. The file panel (`Ctrl+Shift+E`) shows the file tree and previews.

### Settings and integrations

- Settings cover provider logins and API keys, custom providers, model roles, MCP, Skills, plugin marketplaces, and every omp setting.
- Changes are written to omp's own config, so the terminal version picks them up too.
- The `Ctrl+K` command palette searches tasks, past sessions, commands and slash commands.
- Light and dark themes; Chinese and English UI. Text in the conversation's process area stays in English, as in omp.

On macOS, shortcuts use `⌘` instead of `Ctrl`.

## First launch

omp-studio looks for omp on PATH at startup. An omp that omp-studio manages checks for new versions every hour and downloads and replaces itself in the background, fetching only a delta patch when one is available. Running tasks keep the old version; new tasks use the new one. To check manually, go to Settings → About → omp.

- **No omp on PATH**: The setup page shows the download source `build.stencil.so` and the file size. Click "Download and install" to download the official build and verify its sha256. On Windows it installs to `%LOCALAPPDATA%\omp-studio\omp\` and goes first on the user PATH, so `omp` in a terminal runs the same copy. On macOS it installs to `~/Library/Application Support/omp-studio/omp/`.
- **omp already on PATH** (installed by you, or managed by a tool such as Tern): omp-studio asks once. "Let omp-studio manage it" installs a separate official copy first on the user PATH and leaves the original where it is. With "Keep using mine", updates keep going through the original install method.

## FAQ

| Question | Answer |
| --- | --- |
| omp-studio shows "Found a script-based omp" at startup | The first omp on PATH is an `omp.cmd` created by npm or a similar installer, and omp-studio only launches `.exe`. Click "Let omp-studio manage it": the official copy it installs goes first on PATH, and the original stays. |
| How do I update omp-studio? | Windows: the app checks 10 seconds after launch and then every hour, or click Settings → About → Check for updates. New versions download in the background, and only the changed parts are fetched. When the download finishes, an "Update" label appears next to Settings in the sidebar: click it to restart and install, or leave it and the update installs the next time you quit. If it shows "This build has no update source configured" (0.4.16 and earlier), download the new installer from [Releases](https://github.com/DawnJson/omp-studio/releases/latest) and run it once. macOS: download the new version from Releases and replace the old one. |
| How do I report a problem? | First go to Settings → About → Troubleshooting and click "Export diagnostics…". The file contains the version, system, omp status and the last 3 days of logs, with user names, home paths and keys removed. Then press `Ctrl+K` → About & feedback → Report an issue, fill in the template, and drag the file into the "Diagnostics" box. Blur model provider account details in screenshots first. |
| Where is my data stored? | Logins, models, settings and sessions live in `~/.omp`, shared with the terminal omp. |

## Development

Requires Node.js 24 or later. Run `npm run dist:mac` on macOS.

```powershell
npm ci
npm run dev        # development with hot reload
npm test           # unit tests (Vitest)
npm run dist       # Windows NSIS installer, written to release/
npm run dist:mac   # macOS arm64 dmg and zip, written to release/
```

Architecture docs are in [`docs/architecture/`](docs/architecture/), the UI spec in [`docs/design/spec.md`](docs/design/spec.md), and version history in [`CHANGELOG.md`](CHANGELOG.md).

## Acknowledgements

- [oh-my-pi](https://github.com/can1357/oh-my-pi): omp itself
- [Tern](https://docs.stencil.so/tern/protocol/): the TSP protocol spec
- [Electron](https://www.electronjs.org/)
- [node-pty](https://github.com/microsoft/node-pty): pseudo-terminal
- [xterm.js](https://xtermjs.org/): built-in terminal
- [markdown-it](https://github.com/markdown-it/markdown-it), [KaTeX](https://katex.org/), [Shiki](https://shiki.style/): Markdown, math and code highlighting
- [Geist](https://vercel.com/font): UI font (SIL OFL 1.1)
- [LobeHub Icons](https://github.com/lobehub/lobe-icons): model provider logos

## License

[MIT](LICENSE). omp-studio is a working name. It is developed independently by a third party.
