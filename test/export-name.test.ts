// 导出对话框的默认文件名：标题清理成合法的 Windows 文件名（HTML 本身由 `omp --export` 生成，见 task-tsp.test.ts 的导出用例）。
import { describe, expect, it } from "vitest";
import { exportFileName, sanitizeFileStem } from "../src/main/tasks/export-name.ts";

describe("导出的默认文件名", () => {
  it("去掉 Windows 非法字符和路径分隔符，折叠空白", () => {
    expect(sanitizeFileStem('修复 a/b:c*d?"e"<f>|g\\h')).toBe("修复 a b c d e f g h");
    expect(sanitizeFileStem("line1\r\nline2\tend")).toBe("line1 line2 end");
  });

  it("去首尾的点和空格；全是非法字符或空标题时用 omp-session", () => {
    expect(sanitizeFileStem("  ..name.. ")).toBe("name");
    expect(sanitizeFileStem("")).toBe("omp-session");
    expect(sanitizeFileStem("///:::***")).toBe("omp-session");
    expect(sanitizeFileStem("...")).toBe("omp-session");
  });

  it("Windows 保留设备名后补下划线（含大小写）", () => {
    expect(sanitizeFileStem("con")).toBe("con_");
    expect(sanitizeFileStem("NUL")).toBe("NUL_");
    expect(sanitizeFileStem("com1")).toBe("com1_");
    expect(sanitizeFileStem("console")).toBe("console");
  });

  it("按码点限长 80，不劈开代理对，截断后露出的结尾空白和点也去掉", () => {
    const emoji = "😀".repeat(100);
    const cut = sanitizeFileStem(emoji);
    expect([...cut]).toHaveLength(80);
    expect(cut).not.toContain("\ufffd");
    expect(sanitizeFileStem(`${"a".repeat(79)}. tail`)).toBe("a".repeat(79));
  });

  it("文件名 = <标题>-<本地日期>.html", () => {
    expect(exportFileName("修 bug: 登录", new Date(2026, 9, 5, 23, 59))).toBe("修 bug 登录-2026-10-05.html");
    expect(exportFileName("", new Date(2026, 0, 31))).toBe("omp-session-2026-01-31.html");
  });
});
