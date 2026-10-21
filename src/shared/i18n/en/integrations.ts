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
  loadFailed: "Could not load: {message}",

  "mcp.title": "MCP servers",
  "mcp.scope.desc":
    "User scope is written to omp's global mcp.json and shared by every project. Pick a project to read and write in that project's directory; the list then shows both layers and marks which one each row comes from.",
  "mcp.empty": "No MCP servers configured.",
  "mcp.add": "Add server…",
  "mcp.test": "Test connection",
  "mcp.connected": "Connected, {count} tools",
  "mcp.unmanageable":
    "The name has spaces or special characters: omp's /mcp commands cannot manage it. Edit the config file instead.",
  "mcp.note":
    "Changes are written to omp's config and apply to new tasks; a task that is already open needs /mcp reload in its own session to reconnect. Servers that need OAuth sign-in or sign-out (/mcp reauth, /mcp unauth) only work in omp's terminal UI; that cannot be done here.",
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
  "ssh.scope.desc":
    "User-scope hosts are shared by every project. Pick a project to read and write in that project's directory (its .omp/ssh.json); the list shows both layers.",
  "ssh.empty": "No SSH hosts configured.",
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

  "tools.title": "Available tools",
  "tools.enabled": "Enabled",
  "tools.inactive": "Available, not enabled now",
  "tools.device": "xd device",
  "tools.note":
    "This is the global list omp sees without a project: tools from a project's plugins or MCP servers are not included. A tool's switch is the <tool>.enabled setting below; once turned off the tool disappears from omp's list, so the row stays here until you press Refresh.",

  "memory.title": "Memory",
  "memory.backend": "Memory backend",
  "memory.backend.desc": "From the memory.backend setting; change it in the settings below. off means no memory.",
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

  "changelog.title": "omp changelog",
  "changelog.show": "Show changelog",
  "changelog.hint": "From omp's own /changelog, English only.",
  "changelog.all": "All",
  "changelog.more": "Show {count} more versions",

  "slash.mcp": "Manage MCP servers (opens Settings → Integrations)",
  "slash.ssh": "Manage SSH hosts (opens Settings → Integrations)",
  "slash.tools": "See available tools (opens Settings → Tools & permissions)",
  "slash.memory": "View and consolidate memory (opens Settings → Context & memory)",
  "slash.changelog": "See the omp changelog (opens Settings → omp version)",
  "slash.args":
    "The arguments of this command were not run: type it without arguments to open the settings page, and add or remove entries on its cards.",

  "cmd.mcp": "MCP servers",
  "cmd.ssh": "SSH hosts",
  "cmd.tools": "Available tools",
  "cmd.memory": "Memory",
  "cmd.changelog": "omp changelog",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
