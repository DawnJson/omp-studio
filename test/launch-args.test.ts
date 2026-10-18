// 审批模式跟随 omp 配置：只有用户选过才传 --approval-mode，否则会盖掉用户 config.yml 里的 tools.approvalMode。
import { describe, expect, it } from "vitest";
import { buildOmpArgs } from "../src/main/omp/launch-args.ts";

describe("omp 启动参数", () => {
  it("没选审批模式时不传 --approval-mode，选了才传", () => {
    expect(buildOmpArgs({ cwd: "C:\\proj", approvalMode: null })).not.toContain("--approval-mode");
    expect(buildOmpArgs({ cwd: "C:\\proj", approvalMode: "always-ask" })).toEqual(["--mode", "rpc-ui", "--approval-mode", "always-ask"]);
  });
});
