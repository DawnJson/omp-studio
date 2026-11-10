// 删除会话的纯逻辑（issue #10）：`omp session lease --json` 的输出、omp 的警告行（vibe 模式拒绝 `/delete`）、"文件确实不在"的判定。
// 主进程的删除流程（假 omp 收到 `/delete` 删文件）在 test/task-pool.test.ts「删除会话」。
import { describe, expect, it } from "vitest";
import { parseSessionLease } from "../src/main/history/session-lease.ts";
import { isMissingFileError } from "../src/main/tasks/session-file-missing.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { errorLines, warningLines } from "../src/shared/tsp/error-lines.ts";

describe("omp session lease --json", () => {
  it("id 在 held 里 = 被占着；在 unknown 里或都不在 = 没被占着（omp 18.18.6 实测形状）", () => {
    expect(parseSessionLease('{"held":["a"],"unknown":[]}', "a")).toBe(true);
    expect(parseSessionLease('{"held":[],"unknown":[]}', "a")).toBe(false);
    expect(parseSessionLease('{"held":["b"],"unknown":["a"]}', "a")).toBe(false);
  });

  it("认不出的输出抛错（拿不准就不删）", () => {
    expect(() => parseSessionLease("{}", "a")).toThrow("unexpected output");
    expect(() => parseSessionLease("not json", "a")).toThrow();
  });
});

describe("omp 的警告行", () => {
  it("vibe 模式下 /delete 的 `Exit vibe mode first.`（row role=omp.notice.warning，omp 18.18.6 录制）是警告行、不是错误行", () => {
    const doc = createDocument();
    applyMessage(doc, { verb: "o", body: { id: "s:1", mode: "inline", title: "omp", role: "omp.session" } } as never);
    applyMessage(doc, {
      verb: "f",
      body: {
        sf: "s:1",
        s: 1,
        ops: [
          ["add", "main", "s:1", null, { id: "main", k: "col", p: {} }],
          [
            "add",
            "z",
            "main",
            null,
            {
              id: "z",
              k: "row",
              p: { role: "omp.notice.warning", tone: "warning", gap: "sm", align: "start" },
              c: [
                { id: "z.0", k: "icon", p: { name: "warning", tone: "warning", aria: "Warning" } },
                {
                  id: "z.1",
                  k: "text",
                  p: { wrap: "word", grow: 1, shrink: 1, spans: [{ t: "Exit vibe mode first." }] },
                },
              ],
            },
          ],
        ],
      },
    } as never);
    expect([...warningLines(doc).values()]).toEqual(["Exit vibe mode first."]);
    expect(errorLines(doc).size).toBe(0);
  });
});

describe("会话文件确实不在", () => {
  it("只认 ENOENT / ENOTDIR；权限、被占用不算", () => {
    for (const code of ["ENOENT", "ENOTDIR"])
      expect(isMissingFileError(Object.assign(new Error(code), { code }))).toBe(true);
    for (const code of ["EPERM", "EACCES", "EBUSY", undefined])
      expect(isMissingFileError(Object.assign(new Error("x"), { code }))).toBe(false);
  });
});
