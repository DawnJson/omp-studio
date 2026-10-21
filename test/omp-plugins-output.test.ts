// `omp plugin …` 输出解析和动作参数；样本是 omp 18.12.5 的实测输出（fixtures/omp-plugin/，路径已脱敏）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PluginOutputError,
  actionMessage,
  extractJson,
  parseDiscover,
  parseDoctor,
  parseMarketplaceList,
  parsePluginAction,
  parsePluginConfig,
  parsePluginList,
  pluginActionArgs,
} from "../src/shared/omp-output/plugins.ts";

const sample = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "..", "fixtures", "omp-plugin", name), "utf8");

describe("parsePluginList", () => {
  it("empty list", () => {
    expect(parsePluginList(sample("list-empty.json"))).toEqual({ npm: [], marketplace: [] });
  });

  it("npm (linked) + marketplace plugins; enabled defaults to true", () => {
    const list = parsePluginList(sample("list-populated.json"));
    expect(list.npm).toHaveLength(1);
    const demo = list.npm[0]!;
    expect(demo).toMatchObject({
      kind: "npm",
      name: "demo-plugin",
      version: "1.2.0",
      description: null,
      enabled: false,
      enabledFeatures: ["extra"],
    });
    expect(demo.features).toEqual([
      { name: "extra", description: "Extra skills", default: false },
      { name: "core", description: "Core", default: true },
    ]);
    expect(demo.settings["retries"]).toEqual({ type: "number", default: 3 });
    expect(demo.settings["greeting"]).toEqual({ type: "string", default: "hi", description: "Greeting text" });
    expect(list.marketplace).toEqual([
      {
        kind: "marketplace",
        id: "agent-sdk-dev@claude-plugins-official",
        name: "agent-sdk-dev",
        marketplace: "claude-plugins-official",
        installs: [expect.objectContaining({ scope: "user", version: "0.0.0", enabled: true })],
      },
    ]);
  });

  it("a disabled marketplace install carries enabled:false", () => {
    const text = JSON.stringify({
      npm: [],
      marketplace: [{ id: "p@m", scope: "user", entries: [{ scope: "user", version: "1", enabled: false }] }],
    });
    expect(parsePluginList(text).marketplace[0]?.installs[0]?.enabled).toBe(false);
  });

  it("not JSON → error carrying the raw text", () => {
    expect(() => parsePluginList("No plugins installed")).toThrow(PluginOutputError);
    expect(() => parsePluginList("No plugins installed")).toThrow(/No plugins installed/);
    expect(() => parsePluginList('{"npm":1}')).toThrow(PluginOutputError);
  });
});

describe("parseDoctor / parsePluginConfig / extractJson", () => {
  it("doctor checks", () => {
    const checks = parseDoctor(sample("doctor.json"));
    expect(checks.map((check) => check.name)).toEqual([
      "plugins_directory",
      "package_manifest",
      "node_modules",
      "plugin:demo-plugin",
    ]);
    expect(checks.every((check) => check.status === "ok")).toBe(true);
    expect(parseDoctor('[{"name":"x","status":"warning","message":"m"},{"name":"y","status":"???"}]')).toEqual([
      { name: "x", status: "warning", message: "m" },
      { name: "y", status: "error", message: "" },
    ]);
  });

  it("config list: empty settings, and set values", () => {
    const empty = parsePluginConfig(sample("config-list-empty.json"));
    expect(empty.settings).toEqual({});
    expect(Object.keys(empty.schema)).toEqual(["greeting", "retries", "verbose"]);
    expect(parsePluginConfig(sample("config-list.json")).settings).toEqual({ greeting: "yo" });
  });

  it("config of a marketplace plugin is a plain-text error, not JSON", () => {
    expect(() => parsePluginConfig(sample("config-marketplace-plugin.txt"))).toThrow(/not found/);
  });

  it("features --enable prints a ✔ line before the JSON", () => {
    expect(extractJson(sample("features-enable.txt"), "features")).toEqual({
      plugin: "demo-plugin",
      enabledFeatures: ["extra"],
      availableFeatures: ["extra", "core"],
    });
    expect(extractJson(sample("features.json"), "features")).toMatchObject({ enabledFeatures: null });
  });
});

describe("parseMarketplaceList", () => {
  it("empty → []", () => {
    expect(parseMarketplaceList(sample("marketplace-list-empty.txt"))).toEqual([]);
  });

  it("one marketplace", () => {
    expect(parseMarketplaceList(sample("marketplace-list.txt"))).toEqual([
      { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" },
    ]);
  });

  it("local path source with spaces and backslashes is kept whole", () => {
    const text = "Configured Marketplaces:\n\n  a  anthropics/x\n  local-mk  C:\\Users\\user\\My Plugins\\mk\n";
    expect(parseMarketplaceList(text)).toEqual([
      { name: "a", source: "anthropics/x" },
      { name: "local-mk", source: "C:\\Users\\user\\My Plugins\\mk" },
    ]);
  });

  it("unknown text → error with raw", () => {
    expect(() => parseMarketplaceList("boom")).toThrow(/boom/);
  });
});

describe("parseDiscover", () => {
  it("empty → []", () => {
    expect(parseDiscover(sample("discover-empty.txt"))).toEqual([]);
  });

  it("entries with descriptions and @version", () => {
    const entries = parseDiscover(sample("discover-marketplace.txt"));
    expect(entries).toHaveLength(12);
    expect(entries[0]).toMatchObject({ name: "42crunch-api-security-testing", version: null });
    expect(entries[0]?.description).toMatch(/^Automate API security/);
    expect(entries[2]).toEqual({
      name: "agent-sdk-dev",
      version: null,
      description: "Development kit for working with the Claude Agent SDK",
    });
    expect(entries.at(-2)).toEqual({
      name: "clangd-lsp",
      version: "1.0.0",
      description: "C/C++ language server (clangd) for code intelligence",
    });
  });

  it("multi-line descriptions are joined; entries without description are kept", () => {
    const text = "Available Plugins (m):\n\n  a\n    line one\n    line two\n  b@2.0.0\n";
    expect(parseDiscover(text)).toEqual([
      { name: "a", version: null, description: "line one line two" },
      { name: "b", version: "2.0.0", description: "" },
    ]);
  });

  it("error text → throws with raw", () => {
    expect(() => parseDiscover(sample("discover-unknown.txt"))).toThrow(/Marketplace "nope" not found/);
  });
});

describe("actionMessage", () => {
  it("strips ✔ / ✘ markers and takes the first line", () => {
    expect(actionMessage(sample("install.txt"))).toBe("Installed agent-sdk-dev from claude-plugins-official (0.0.0)");
    expect(actionMessage(sample("marketplace-add-bad.txt"))).toMatch(/^Failed to add marketplace/);
    expect(actionMessage(sample("upgrade-all.txt"))).toBe("All marketplace plugins are up to date.");
    expect(actionMessage(sample("config-set-bad.txt"))).toBe("Expected number");
    expect(actionMessage(sample("features-enable.txt"))).toBe("Updated features for demo-plugin");
    // 只有 JSON（enable / disable / uninstall 的 --json）：没有可显示的句子。
    expect(actionMessage(sample("disable.json"))).toBe("");
    expect(actionMessage(sample("uninstall.json"))).toBe("");
  });
});

describe("project scope", () => {
  it("one plugin installed in both scopes arrives as two records and is merged into two installs", () => {
    const list = parsePluginList(sample("list-project-both-scopes.json"));
    expect(list.marketplace).toHaveLength(1);
    expect(list.marketplace[0]?.id).toBe("p1@local-mk");
    expect(list.marketplace[0]?.installs.map((install) => install.scope)).toEqual(["project", "user"]);
  });

  it("an ambiguous request is rejected by omp with a message that names --scope", () => {
    expect(actionMessage(sample("disable-ambiguous-scope.txt"))).toMatch(/installed in both user and project scope/);
  });

  it("scope becomes --scope <scope> on install / enable / disable / uninstall / upgrade", () => {
    const run = (value: unknown) => pluginActionArgs(parsePluginAction(value));
    expect(run({ kind: "install", id: "p@m", scope: "project" })).toEqual([
      "plugin",
      "install",
      "p@m",
      "--scope",
      "project",
      "--json",
    ]);
    expect(run({ kind: "disable", id: "p@m", scope: "user" })).toEqual([
      "plugin",
      "disable",
      "p@m",
      "--scope",
      "user",
      "--json",
    ]);
    expect(run({ kind: "uninstall", id: "p@m", scope: "project" })).toEqual([
      "plugin",
      "uninstall",
      "p@m",
      "--scope",
      "project",
      "--json",
    ]);
    expect(run({ kind: "upgrade", id: "p@m", scope: "project" })).toEqual([
      "plugin",
      "upgrade",
      "p@m",
      "--scope",
      "project",
      "--json",
    ]);
    expect(run({ kind: "upgrade", id: null, scope: "project" })).toEqual(["plugin", "upgrade", "--json"]);
    expect(() => parsePluginAction({ kind: "install", id: "p@m", scope: "both" })).toThrow(/scope/);
  });
});

describe("plugin actions", () => {
  it("maps validated actions to argv (no shell, one element per value)", () => {
    const run = (value: unknown) => pluginActionArgs(parsePluginAction(value));
    expect(run({ kind: "enable", id: "demo-plugin" })).toEqual(["plugin", "enable", "demo-plugin", "--json"]);
    expect(run({ kind: "uninstall", id: "p@claude-plugins-official" })).toEqual([
      "plugin",
      "uninstall",
      "p@claude-plugins-official",
      "--json",
    ]);
    expect(run({ kind: "upgrade", id: null })).toEqual(["plugin", "upgrade", "--json"]);
    expect(run({ kind: "install", id: "agent-sdk-dev@claude-plugins-official" })).toEqual([
      "plugin",
      "install",
      "agent-sdk-dev@claude-plugins-official",
      "--json",
    ]);
    expect(run({ kind: "feature", id: "@scope/pkg", feature: "extra", on: false })).toEqual([
      "plugin",
      "features",
      "@scope/pkg",
      "--disable",
      "extra",
      "--json",
    ]);
    expect(run({ kind: "configSet", id: "demo-plugin", key: "greeting", value: "hello world" })).toEqual([
      "plugin",
      "config",
      "set",
      "demo-plugin",
      "greeting",
      "hello world",
    ]);
    expect(run({ kind: "configDelete", id: "demo-plugin", key: "greeting" })).toEqual([
      "plugin",
      "config",
      "delete",
      "demo-plugin",
      "greeting",
    ]);
    expect(run({ kind: "marketplaceAdd", source: " anthropics/claude-plugins-official " })).toEqual([
      "plugin",
      "marketplace",
      "add",
      "anthropics/claude-plugins-official",
    ]);
    expect(run({ kind: "marketplaceUpdate", name: null })).toEqual(["plugin", "marketplace", "update"]);
    expect(run({ kind: "doctor", fix: true })).toEqual(["plugin", "doctor", "--json", "--fix"]);
  });

  it("rejects option-looking ids and values, control characters, npm installs, unknown kinds", () => {
    const bad = [
      { kind: "enable", id: "--force" },
      { kind: "enable", id: "a b" },
      { kind: "enable", id: "a;rm" },
      { kind: "install", id: "demo-plugin" },
      { kind: "configSet", id: "p", key: "k", value: "-5" },
      { kind: "configSet", id: "p", key: "k", value: "a\nb" },
      { kind: "configSet", id: "p", key: "--x", value: "1" },
      { kind: "marketplaceAdd", source: "--help" },
      { kind: "marketplaceAdd", source: "a\r\nb" },
      { kind: "marketplaceRemove", name: "a/b" },
      { kind: "feature", id: "p", feature: "f", on: "yes" },
      { kind: "link", id: "p" },
      { kind: "doctor" },
      null,
      "enable",
    ];
    for (const value of bad)
      expect(() => parsePluginAction(value), JSON.stringify(value)).toThrow(/invalid plugin action/);
  });
});
