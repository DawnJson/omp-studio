import { describe, expect, it } from "vitest";
import { pullRequestUrl } from "../src/main/git/pull-request-url.ts";

describe("PR 页面地址：由 remote URL 推出", () => {
  it("https、scp 写法、ssh://（带端口）、git://，去掉 .git 和凭据", () => {
    for (const remote of [
      "https://github.com/acme/widgets.git",
      "https://user:token@github.com/acme/widgets",
      "git@github.com:acme/widgets.git",
      "ssh://git@github.com:22/acme/widgets.git",
      "git://github.com/acme/widgets.git/",
    ])
      expect(pullRequestUrl(remote, 12)).toBe("https://github.com/acme/widgets/pull/12");
  });

  it("企业版主机照用；本地路径和少于两段的认不出", () => {
    expect(pullRequestUrl("git@ghe.corp.example:team/repo.git", 3)).toBe("https://ghe.corp.example/team/repo/pull/3");
    expect(pullRequestUrl("E:\\work\\repo", 1)).toBeNull();
    expect(pullRequestUrl("/srv/git/repo.git", 1)).toBeNull();
    expect(pullRequestUrl("https://github.com/only", 1)).toBeNull();
  });
});
