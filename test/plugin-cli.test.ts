// src/main/plugins/plugin-cli.ts：用假的 RunOmp 回放 omp 18.12.5 的实测输出（fixtures/omp-plugin/）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPlugins, listPlugins, readPluginConfig, runPluginAction } from "../src/main/plugins/plugin-cli.ts";
import type { RunOmp } from "../src/main/usage/usage-service.ts";

const sample = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "..", "fixtures", "omp-plugin", name), "utf8");

type Reply = { code?: number; stdout?: string; stderr?: string };
function fake(replies: Record<string, Reply>): { run: RunOmp; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunOmp = async (args) => {
    calls.push(args);
    const reply = replies[args.join(" ")];
    if (reply === undefined) throw new Error(`unexpected omp call: ${args.join(" ")}`);
    return { code: reply.code ?? 0, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
  };
  return { run, calls };
}

describe("plugin-cli", () => {
  it("listPlugins combines the installed list and the configured marketplaces", async () => {
    const { run } = fake({
      "plugin list --json": { stdout: sample("list-populated.json") },
      "plugin marketplace list": { stdout: sample("marketplace-list.txt") },
    });
    const snapshot = await listPlugins(run);
    expect(snapshot.npm.map((plugin) => plugin.name)).toEqual(["demo-plugin"]);
    expect(snapshot.marketplace.map((plugin) => plugin.id)).toEqual(["agent-sdk-dev@claude-plugins-official"]);
    expect(snapshot.marketplaces).toEqual([
      { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" },
    ]);
  });

  it("empty state (plain-text marketplace list) is not an error", async () => {
    const { run } = fake({
      "plugin list --json": { stdout: sample("list-empty.json") },
      "plugin marketplace list": { stdout: sample("marketplace-list-empty.txt") },
    });
    expect(await listPlugins(run)).toEqual({ npm: [], marketplace: [], marketplaces: [] });
  });

  it("discover and config use the fixed read commands", async () => {
    const { run, calls } = fake({
      "plugin discover claude-plugins-official": { stdout: sample("discover-marketplace.txt") },
      "plugin config list demo-plugin --json": { stdout: sample("config-list.json") },
    });
    expect(await discoverPlugins(run, "claude-plugins-official")).toHaveLength(12);
    expect((await readPluginConfig(run, "demo-plugin")).settings).toEqual({ greeting: "yo" });
    expect(calls).toHaveLength(2);
  });

  it("non-zero exit rejects with omp's own words (✘ stripped), from stdout or stderr", async () => {
    const stdoutFail = fake({ "plugin discover nope": { code: 1, stdout: sample("discover-unknown.txt") } });
    await expect(discoverPlugins(stdoutFail.run, "nope")).rejects.toThrow(
      'Failed to discover plugins: Error: Marketplace "nope" not found',
    );
    const stderrFail = fake({
      "plugin config list agent-sdk-dev@claude-plugins-official --json": {
        code: 1,
        stderr: sample("config-marketplace-plugin.txt"),
      },
    });
    await expect(readPluginConfig(stderrFail.run, "agent-sdk-dev@claude-plugins-official")).rejects.toThrow(
      'Plugin "agent-sdk-dev@claude-plugins-official" not found',
    );
  });

  it("actions return omp's result sentence; doctor returns parsed checks", async () => {
    const { run } = fake({
      "plugin install agent-sdk-dev@claude-plugins-official --json": { stdout: sample("install.txt") },
      "plugin doctor --json": { stdout: sample("doctor.json") },
    });
    expect(await runPluginAction(run, { kind: "install", id: "agent-sdk-dev@claude-plugins-official" })).toEqual({
      text: "Installed agent-sdk-dev from claude-plugins-official (0.0.0)",
      checks: null,
    });
    const doctor = await runPluginAction(run, { kind: "doctor", fix: false });
    expect(doctor.checks?.map((check) => check.name)).toContain("plugin:demo-plugin");
  });

  it("actions run one at a time, and a failure does not block the next", async () => {
    const order: string[] = [];
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const run: RunOmp = async (args) => {
      order.push(`start ${args[1]}`);
      if (args[1] === "install") {
        await gate;
        order.push("end install");
        return { code: 1, stdout: "", stderr: "✘ boom" };
      }
      order.push(`end ${args[1]}`);
      return { code: 0, stdout: "✔ ok", stderr: "" };
    };
    const first = runPluginAction(run, { kind: "install", id: "a@b" });
    const second = runPluginAction(run, { kind: "disable", id: "x" });
    const failed = expect(first).rejects.toThrow("boom");
    // 让已排队的微任务全部跑完：第二个动作此时仍不能开始。
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(order).toEqual(["start install"]);
    release();
    await failed;
    expect(await second).toEqual({ text: "ok", checks: null });
    expect(order).toEqual(["start install", "end install", "start disable", "end disable"]);
  });
});
