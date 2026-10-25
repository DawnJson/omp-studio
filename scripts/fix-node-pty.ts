// npm install 之后跑(package.json 的 postinstall):给 node-pty 的 macOS spawn-helper 加执行位。
// node-pty 1.1.0 的 npm 包里 prebuilds/darwin-*/spawn-helper 是 0644(`tar -tvzf node-pty-1.1.0.tgz` 实测),
// mac 上 posix_spawnp 起不来,原生层抛 Napi::Error 直接 abort 整个进程。electron-builder 从 node_modules 复制,
// 所以这里改了,安装包里的也带执行位(mac workflow 的"检查产物"一步核对)。Windows 上文件不存在或 chmod 无效果,不影响。
import { chmod, stat } from "node:fs/promises";
import path from "node:path";

const prebuilds = path.join(import.meta.dirname, "..", "node_modules", "node-pty", "prebuilds");

for (const arch of ["darwin-arm64", "darwin-x64"]) {
  const helper = path.join(prebuilds, arch, "spawn-helper");
  const info = await stat(helper).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) continue;
  await chmod(helper, info.mode | 0o111);
}
