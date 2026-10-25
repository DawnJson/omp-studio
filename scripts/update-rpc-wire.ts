// 从 omp 官方仓库对应版本的 tag 拷贝 RPC wire 类型。用法：node scripts/update-rpc-wire.ts <omp 版本>
// 依据：docs/architecture/omp-rpc.md「类型从哪来」、AGENTS.md "omp 的边界"。
import { writeFile } from "node:fs/promises";
import path from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法：node scripts/update-rpc-wire.ts <omp 版本，如 18.12.0>");
  process.exit(1);
}

const source = `https://raw.githubusercontent.com/can1357/oh-my-pi/v${version}/packages/coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts`;
const res = await fetch(source);
if (!res.ok) {
  console.error(`下载失败：HTTP ${res.status} ${source}`);
  process.exit(1);
}
const body = await res.text();
const header = [
  `// omp-studio：此文件从 omp v${version} 原样拷贝，不要手改。`,
  `// 来源：${source}`,
  `// 更新：npm run rpc:update-wire -- <omp 版本>`,
  "// Copyright (c) 2025 Mario Zechner; Copyright (c) 2025-2026 Can Bölük; Copyright (c) 2026 Stencil Labs, Inc.",
  "// MIT License，全文见 src/shared/oh-my-pi-LICENSE.txt（随安装包分发到 resources/licenses/oh-my-pi-MIT.txt）。",
  "",
].join("\n");

const target = path.join(import.meta.dirname, "..", "src", "shared", "omp-wire", "rpc-wire.generated.ts");
await writeFile(target, header + body);
console.log(`已写入 ${target}（omp v${version}，${body.length} 字符）`);
