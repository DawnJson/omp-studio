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
    "The name has spaces or special characters, so omp's /mcp commands can't manage it. Edit the config file instead.",
  "mcp.note":
    "Changes apply to new tasks; open tasks need “Restart session” (Ctrl Shift R). Servers that need OAuth must be authorized in the terminal.",
  "mcp.remove.title": "Remove MCP server “{name}”?",
  "mcp.remove.body":
    "This removes the entry from omp's {scope} config. A server with the same name in the other scope is not affected.",
  "mcp.name": "Name",
  "mcp.name.tip": "Letters, digits, dot, underscore and dash, up to 100 characters, no spaces.",
  "mcp.kind": "Type",
  "mcp.kind.stdio": "Local command",
  "mcp.command": "Command",
  "mcp.args": "Arguments",
  "mcp.args.tip": "One argument per line. Spaces are fine; double quotes are not.",
  "mcp.token": "Token",
  "mcp.token.tip": "Optional. Stored in the config file as an Authorization: Bearer header.",

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
  "skills.empty": "No skills available. Put skill folders in ~/.omp/agent/skills or a project's .omp/skills.",
  "skills.note": "Skills omp currently has (read-only); a selected project adds its own.",

  "tools.title": "Available tools",
  "tools.enabled": "Enabled",
  "tools.device": "xd device",
  "tools.device.tip":
    "An on-demand entry point to the same tool, not a separate tool, so it has no switch. Turn off tools.xdev to drop all devices.",
  "tools.mounted": "On demand",
  "tools.mounted.tip":
    "Mounted under an xd:// device and called on demand; it is not off. It has no <tool>.enabled setting, so there is no switch.",
  "tools.mounted.mcpTip":
    "Comes from an MCP server and has no switch of its own; turn off the whole server to disable it.",
  "tools.inactive.tip":
    "Not active in this session: omp enables it on demand through a mode or command (e.g. /autoresearch, /goal), so there is no switch.",
  "tools.note":
    "omp's global tool list, without project tools. Switches are the same settings as below; hover a badge to see why a row has none.",

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
    "Deletes this project's memory data; this cannot be undone. With Hindsight only local state is cleared, not the server bank.",
  "memory.cleared": "Memory cleared",
  "memory.note":
    "omp builds local memory when a session starts (it calls a model and may cost money); it cannot be triggered by hand.",

  "changelog.title": "Changelog",
  "changelog.hint": "From omp's own /changelog, English only.",

  "slash.mcp": "Manage MCP servers (opens Settings → Integrations)",
  "slash.ssh": "Manage SSH hosts (opens Settings → Integrations)",
  "slash.tools": "See available tools (opens Settings → Tools & permissions)",
  "slash.memory": "View and consolidate memory (opens Settings → Context & memory)",
  "slash.changelog": "See the omp changelog (opens Settings → About)",
  "slash.args": "The arguments were not run: type the command alone to open the settings page and make changes there.",

  "cmd.mcp": "MCP servers",
  "cmd.ssh": "SSH hosts",
  "cmd.tools": "Available tools",
  "cmd.memory": "Memory",
  "cmd.changelog": "omp changelog",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
