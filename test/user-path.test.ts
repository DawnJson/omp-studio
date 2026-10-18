import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWin32, win32Constants } from "../src/main/platform/win32/ffi.ts";
import {
  addToUserPath,
  pathContains,
  pathStartsWith,
  prependToPath,
  readUserPath,
} from "../src/main/platform/win32/user-path.ts";

describe("PATH transforms", () => {
  it("moves an existing entry to the front, ignoring case and a trailing backslash, keeping other entries verbatim", () => {
    expect(prependToPath("C:\\a;C:\\OMP\\bin\\;%USERPROFILE%\\bin", "c:\\omp\\bin")).toBe(
      "c:\\omp\\bin;C:\\a;%USERPROFILE%\\bin",
    );
  });

  it("recognises an entry written with an unexpanded %VAR%", () => {
    process.env["OMP_STUDIO_TEST_ROOT"] = "D:\\路径 测试";
    expect(pathContains("%OMP_STUDIO_TEST_ROOT%\\omp\\bin", "D:\\路径 测试\\omp\\bin")).toBe(true);
    expect(pathStartsWith("%omp_studio_test_root%\\omp\\bin;C:\\x", "D:\\路径 测试\\omp\\bin\\")).toBe(true);
    delete process.env["OMP_STUDIO_TEST_ROOT"];
  });

  it("handles an empty or missing value and drops empty entries", () => {
    expect(prependToPath(null, "C:\\omp\\bin")).toBe("C:\\omp\\bin");
    expect(prependToPath("", "C:\\omp\\bin")).toBe("C:\\omp\\bin");
    expect(prependToPath(";;C:\\a;;", "C:\\omp\\bin")).toBe("C:\\omp\\bin;C:\\a");
  });
});

// 注册表测试只写 HKCU\Software\omp-studio-test-<pid> 这个临时子键，用完删掉；绝不碰 HKCU\Environment。
describe.runIf(process.platform === "win32")("user PATH in the registry (temporary subkey)", () => {
  const subKey = `Software\\omp-studio-test-${process.pid}`;
  const options = { subKey };

  beforeAll(() => {
    const { advapi32 } = loadWin32();
    const created = advapi32.RegCreateKeyExW(win32Constants.HKEY_CURRENT_USER, subKey, win32Constants.KEY_WRITE);
    advapi32.RegCloseKey(created.key);
  });
  afterAll(() => {
    // 删键用 reg.exe 只是为了清理：要删的是上面自己建的临时键。
    execFileSync("reg.exe", ["delete", `HKCU\\${subKey}`, "/f"], { windowsHide: true });
  });

  it("creates the value as REG_EXPAND_SZ when there was none, then writes the dir first and backs up the previous value", () => {
    expect(readUserPath(options).raw).toBeNull();
    let previous: string | null | undefined;
    const first = addToUserPath("C:\\Users\\某 人\\omp-studio\\omp\\bin", {
      ...options,
      onBeforeWrite: (value) => (previous = value),
    });
    expect(first.changed).toBe(true);
    expect(previous).toBeNull();
    expect(readUserPath(options)).toEqual({
      raw: "C:\\Users\\某 人\\omp-studio\\omp\\bin",
      type: win32Constants.REG_EXPAND_SZ,
    });
  });

  it("keeps %VAR% unexpanded and the value type, and does nothing when the dir is already first", () => {
    const { advapi32 } = loadWin32();
    const opened = advapi32.RegCreateKeyExW(win32Constants.HKEY_CURRENT_USER, subKey, win32Constants.KEY_SET_VALUE);
    // 原来是普通 REG_SZ、带 %VAR%：写回后类型不能变，%VAR% 不能被展开。
    advapi32.RegSetValueExW(
      opened.key,
      "Path",
      win32Constants.REG_SZ,
      Buffer.from("%USERPROFILE%\\bin;C:\\keep\0", "utf16le"),
    );
    advapi32.RegCloseKey(opened.key);

    expect(addToUserPath("C:\\omp\\bin", options).changed).toBe(true);
    expect(readUserPath(options)).toEqual({
      raw: "C:\\omp\\bin;%USERPROFILE%\\bin;C:\\keep",
      type: win32Constants.REG_SZ,
    });
    expect(addToUserPath("C:\\OMP\\bin\\", options).changed).toBe(false);
  });
});
