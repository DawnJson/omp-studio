import type { MessageEntry } from "../index.ts";
import type { integrations as zhCN } from "../zh-CN/integrations.ts";

export const integrations = {
  "scope.user": "User (global)",
  "scope.project": "Project",
  "field.scope": "Scope",
  add: "Add",
  remove: "Remove",
  refresh: "Refresh",
  loading: "Loading…",
  more: "More actions",
  loadFailed: "Could not load: {message}",

  "mcp.title": "MCP servers",
  "mcp.empty": "No MCP servers configured.",
  "mcp.form.title": "Add MCP server",
  "mcp.add": "Add server…",
  "mcp.test": "Test connection",
  "mcp.connected": "Connected, {count} tools",
  "mcp.unmanageable":
    "The name has spaces or special characters: omp's /mcp commands cannot manage it. Edit the config file instead.",
  "mcp.note":
    "Changes are written to omp's config and apply to new tasks; a task that is already open reconnects after you click “Restart session” next to its title in the top bar (Ctrl Shift R). Servers that need OAuth sign-in or sign-out (/mcp reauth, /mcp unauth) only work in omp's terminal UI; that cannot be done here.",
  "mcp.remove.title": "Remove MCP server “{name}”?",
  "mcp.remove.body":
    "This removes the entry from omp's {scope} config. A server with the same name in the other scope is not affected.",
  "mcp.name": "Name",
  "mcp.name.tip": "Letters, digits, dot, underscore and dash, up to 100 characters, no spaces.",
  "mcp.kind": "Type",
  "mcp.kind.stdio": "Local command",
  "mcp.command": "Command",
  "mcp.args": "Arguments",
  "mcp.args.tip":
    "One argument per line. Spaces inside an argument are fine; each line is one argument. Arguments cannot contain double quotes.",
  "mcp.token": "Token",
  "mcp.token.tip": "Optional. omp stores it as an Authorization: Bearer header in the config file.",

  "ssh.title": "SSH hosts",
  "ssh.empty": "No SSH hosts configured.",
  "ssh.form.title": "Add SSH host",
  "ssh.add": "Add host…",
  "ssh.remove.title": "Remove SSH host “{name}”?",
  "ssh.remove.body": "This only removes the entry from omp's config; it does not connect to that machine.",
  "ssh.name": "Name",
  "ssh.host": "Host address",
  "ssh.user": "User",
  "ssh.port": "Port",
  "ssh.key": "Key path",
  "ssh.key.tip": "Path to the private key file. Optional.",
  "ssh.desc": "Description",
  "ssh.compat": "Compat mode",
  "ssh.compat.tip": "omp's --compat: for remotes that are not fully compatible (some routers, minimal systems).",

  "skills.title": "Skills",
  "skills.empty":
    "No skills available. Put a skill folder with a SKILL.md in ~/.omp/agent/skills (user) or .omp/skills in a project, or run omp skill install in a terminal.",
  "skills.note":
    "Read-only list of the skills omp reports as available. The project scope adds the skills found in that project's folder. omp has no command to turn skills on or off from here.",

  "tools.title": "Available tools",
  "tools.enabled": "Enabled",
  "tools.device": "xd device",
  "tools.device.tip":
    "An xd:// device is another entry point to the same tool, which the model calls on demand. It is not a separate tool, so it has no switch. To drop every device, turn off the tools.xdev setting (tools are then listed directly to the model).",
  "tools.mounted": "On demand",
  "tools.mounted.tip":
    "This tool is not in the default tool set. It is mounted under an xd:// device and the model calls it when needed; it is not turned off. It has no <tool>.enabled setting, so there is no switch.",
  "tools.mounted.mcpTip":
    "A tool provided by an MCP server. omp has no per-tool setting for MCP tools: to disable it, turn the whole MCP server off under Integrations & plugins above. It is mounted under an xd:// device and called on demand; it is not turned off.",
  "tools.inactive.tip":
    "This tool is not active in the current session: omp enables it on demand through a mode or command (e.g. the /autoresearch experiment tools, /goal). It has no <tool>.enabled setting, so there is no switch.",
  "tools.note":
    "This is the global list omp sees without a project: tools from a project's plugins or MCP servers are not included. Tools with a <tool>.enabled setting have a switch (the same setting as below); once turned off the tool disappears from omp's list, so the row stays here until you press Refresh. A row without a switch is not broken: hover its badge for the reason and where to change it.",

  "memory.title": "Memory",
  "memory.noProject": "Memory is kept per project. Open a project first to view and consolidate it.",
  "memory.project": "Project",
  "memory.project.desc":
    "Memory is stored per project directory; everything here runs in the selected project's directory.",
  "memory.view": "View",
  "memory.op.stats": "Stats",
  "memory.op.diagnose": "Diagnose",
  "memory.op.queue": "Queue",
  "memory.op.view": "Injected",
  "memory.emptyOutput": "(omp printed nothing)",
  "memory.clear": "Clear",
  "memory.clear.title": "Clear this project's memory?",
  "memory.clear.body":
    "This deletes the data the current memory backend keeps for this project and cannot be undone. omp rebuilds local memory from past sessions the next time a session starts. With the Hindsight backend it only clears the local session state and cache; it does not delete the bank on the server.",
  "memory.cleared": "Memory cleared",
  "memory.note":
    "omp builds local memory itself when a session starts (it reads past sessions with a model and may cost money); there is no button to trigger it. /memory sync and /memory rebuild have no observable effect outside that startup run, so they are not offered here.",

  "changelog.title": "Changelog",
  "changelog.hint": "From omp's own /changelog, English only.",

  "slash.mcp": "Manage MCP servers (opens Settings → Integrations)",
  "slash.ssh": "Manage SSH hosts (opens Settings → Integrations)",
  "slash.tools": "See available tools (opens Settings → Tools & permissions)",
  "slash.memory": "View and consolidate memory (opens Settings → Context & memory)",
  "slash.changelog": "See the omp changelog (opens Settings → About)",
  "slash.args":
    "The arguments of this command were not run: type it without arguments to open the settings page, and add or remove entries on its cards.",

  "cmd.mcp": "MCP servers",
  "cmd.ssh": "SSH hosts",
  "cmd.tools": "Available tools",
  "cmd.memory": "Memory",
  "cmd.changelog": "omp changelog",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
