import { describe, expect, it } from "vitest";
import type { OmpInstall } from "../src/main/omp/discover.ts";
import { resolveOmp, type PathScan } from "../src/main/omp-manager/resolve.ts";
import { takeoverKey, type OmpStudioState } from "../src/main/omp-manager/takeover-state.ts";
import { compareVersions, isBelowMinimum } from "../src/main/omp-manager/version.ts";

const noState: OmpStudioState = { takeover: {}, addToPathAsked: false };
const exe = (path: string, manager: OmpInstall["manager"] = null): PathScan => ({ kind: "exe", install: { path, version: "18.12.0", manager } });

describe("resolveOmp", () => {
  it("uses a Tern-managed omp as is, without asking and without touching it", () => {
    const decision = resolveOmp({ scan: exe("C:\\Users\\某人\\AppData\\Local\\Tern\\omp\\bin\\omp.exe", { id: "tern", name: "Tern" }), managed: null, state: noState });
    expect(decision).toEqual({ action: "use", path: "C:\\Users\\某人\\AppData\\Local\\Tern\\omp\\bin\\omp.exe", version: "18.12.0", source: { kind: "managed_by_other", managerName: "Tern" } });
  });

  it("asks once about a user-installed exe, remembering the answer per exe path (case-insensitively on Windows)", () => {
    const first = resolveOmp({ scan: exe("C:\\omp\\omp.exe"), managed: null, state: noState });
    expect(first).toMatchObject({ action: "ask_takeover", launchable: true });
    const accepted = resolveOmp({ scan: exe("C:\\omp\\omp.exe"), managed: null, state: { ...noState, takeover: { [takeoverKey("C:\\OMP\\omp.exe")]: "accepted" } } });
    expect(accepted).toEqual(process.platform === "win32" ? { action: "use_managed", reason: "takeover" } : first);
    // 换了另一个自装的 omp 要重新问。
    expect(resolveOmp({ scan: exe("D:\\other\\omp.exe"), managed: null, state: { ...noState, takeover: { [takeoverKey("C:\\omp\\omp.exe")]: "accepted" } } })).toMatchObject({ action: "ask_takeover" });
  });

  it("keeps using the user's own omp after the takeover was declined", () => {
    const state: OmpStudioState = { ...noState, takeover: { [takeoverKey("C:\\omp\\omp.exe")]: "declined" } };
    expect(resolveOmp({ scan: exe("C:\\omp\\omp.exe"), managed: null, state })).toMatchObject({ action: "use", source: { kind: "user_installed" } });
  });

  it("cannot launch a script omp.cmd: asks first, then reports it unusable once declined", () => {
    const scan: PathScan = { kind: "script", path: "C:\\npm\\omp.cmd" };
    expect(resolveOmp({ scan, managed: null, state: noState })).toEqual({ action: "ask_takeover", path: "C:\\npm\\omp.cmd", version: null, launchable: false });
    expect(resolveOmp({ scan, managed: null, state: { ...noState, takeover: { [takeoverKey("C:\\npm\\omp.cmd")]: "declined" } } })).toEqual({ action: "unusable", path: "C:\\npm\\omp.cmd" });
  });

  it("manages its own copy when PATH has no omp, and trusts an omp-studio manager.json on PATH", () => {
    expect(resolveOmp({ scan: { kind: "none" }, managed: null, state: noState })).toEqual({ action: "use_managed", reason: "missing" });
    expect(resolveOmp({ scan: exe("C:\\s\\omp\\bin\\omp.exe", { id: "omp-studio", name: "omp-studio" }), managed: null, state: noState })).toMatchObject({ action: "use", source: { kind: "studio_managed", onUserPath: true } });
  });
});

describe("versions", () => {
  it("compares numerically, not as strings, and ranks a prerelease below its release", () => {
    expect(compareVersions("18.12.1", "18.12.0")).toBe(1);
    expect(compareVersions("18.9.0", "18.12.0")).toBe(-1);
    expect(compareVersions("18.12.0-canary.1", "18.12.0")).toBe(-1);
    expect(compareVersions("18.12.0", "18.12")).toBe(0);
  });

  it("flags versions below the supported minimum", () => {
    expect(isBelowMinimum("18.8.7")).toBe(true);
    expect(isBelowMinimum("18.12.0")).toBe(false);
  });
});
