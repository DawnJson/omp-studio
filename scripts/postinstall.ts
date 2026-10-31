// npm install 之后跑（package.json 的 postinstall）：给 node-pty 补执行位，启用仓库自带的 git 钩子（.githooks）。
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import "./fix-node-pty.ts";

const root = path.resolve(import.meta.dirname, "..");

// 只在本仓库自己的工作区里设钩子：从压缩包装、或者装在别的仓库里时不碰 git 配置。没装 git 也按不在工作区处理。
const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
if (top.status === 0 && path.resolve(top.stdout.trim()) === root)
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "inherit" });
