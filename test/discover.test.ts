import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOmpOnPath, UnsupportedOmpLauncherError } from "../src/main/omp/discover.ts";

const isWindows = process.platform === "win32";
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 发现-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function dirWith(name: string, files: string[]): Promise<string> {
  const dir = path.join(scratch, name);
  await mkdir(dir, { recursive: true });
  for (const file of files) await writeFile(path.join(dir, file), "", { mode: 0o755 });
  return dir;
}

describe("findOmpOnPath", () => {
  it("returns the first omp in PATH order, from a directory with spaces and Chinese in its name", async () => {
    const empty = await dirWith("空 目录", []);
    const first = await dirWith("第一个 bin", [isWindows ? "omp.exe" : "omp"]);
    const second = await dirWith("第二个 bin", [isWindows ? "omp.exe" : "omp"]);
    const found = await findOmpOnPath({ PATH: [empty, first, second].join(path.delimiter), PATHEXT: ".COM;.EXE;.BAT;.CMD" });
    expect(found).toBe(path.join(first, isWindows ? "omp.exe" : "omp"));
  });

  it("returns null when no directory has omp", async () => {
    const empty = await dirWith("空", []);
    expect(await findOmpOnPath({ PATH: empty })).toBeNull();
  });

  it.runIf(isWindows)("reads the variables case-insensitively, as Windows does (`Path`, `PathExt`)", async () => {
    const dir = await dirWith("大小写", ["omp.exe"]);
    expect(await findOmpOnPath({ Path: dir, PathExt: ".EXE" })).toBe(path.join(dir, "omp.exe"));
  });

  it.runIf(isWindows)("refuses an npm-style omp.cmd that shadows an omp.exe later on PATH", async () => {
    const shim = await dirWith("npm 全局", ["omp.cmd"]);
    const exe = await dirWith("tern", ["omp.exe"]);
    const error = await findOmpOnPath({ PATH: [shim, exe].join(path.delimiter), PATHEXT: ".COM;.EXE;.BAT;.CMD" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedOmpLauncherError);
    expect((error as UnsupportedOmpLauncherError).path).toBe(path.join(shim, "omp.cmd"));
  });
});
