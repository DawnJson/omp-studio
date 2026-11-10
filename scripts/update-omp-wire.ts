// 从 omp 官方仓库对应版本的 tag 拷贝协议类型：RPC wire（服务进程用）和 TSP（任务界面用，连同它引用的 shell-viz / shell-trace）。
// 用法：npm run omp:update-wire -- <omp 版本>。依据：docs/architecture/omp-rpc.md「类型从哪来」、docs/architecture/omp-boundaries.md「协议」。
// 拷过来只改一处：相对 import 补上 `.generated.ts`（我们的 tsconfig 是 nodenext，相对路径必须带扩展名）。
// 换完 TSP 类型要看 src/main/tsp/tsp-session.ts 的 TSP_DECLARED_KINDS：新种类没写组件前不能声明。
import { writeFile } from "node:fs/promises";
import path from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法：npm run omp:update-wire -- <omp 版本，如 18.18.5>");
  process.exit(1);
}

const root = path.join(import.meta.dirname, "..", "src", "shared");
const base = `https://raw.githubusercontent.com/can1357/oh-my-pi/v${version}/packages`;
const files = [
  { source: "coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts", target: "omp-wire/rpc-wire.generated.ts" },
  { source: "wire/src/tsp.ts", target: "tsp/tsp.generated.ts" },
  { source: "wire/src/shell-viz.ts", target: "tsp/shell-viz.generated.ts" },
  { source: "wire/src/shell-trace.ts", target: "tsp/shell-trace.generated.ts" },
];
const siblings = new Set(["tsp", "shell-viz", "shell-trace"]);

// 先全部下载成功再写，免得只换了一半。
const bodies = await Promise.all(
  files.map(async ({ source }) => {
    const url = `${base}/${source}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`下载失败：HTTP ${res.status} ${url}`);
      process.exit(1);
    }
    return { url, text: await res.text() };
  }),
);

for (const [index, { target }] of files.entries()) {
  const { url, text } = bodies[index]!;
  const body = text.replace(/from "\.\/([\w-]+)"/g, (whole, name: string) =>
    siblings.has(name) ? `from "./${name}.generated.ts"` : whole,
  );
  const unresolved = /from "\.\.?\/[^"]*"/.exec(body.replace(/from "\.\/[\w-]+\.generated\.ts"/g, ""));
  if (unresolved !== null) {
    console.error(`${target} 引用了没拷的文件：${unresolved[0]}，把它加进 files`);
    process.exit(1);
  }
  const header = [
    `// omp-studio：此文件从 omp v${version} 原样拷贝（只给相对 import 补了扩展名），不要手改。`,
    `// 来源：${url}`,
    "// 更新：npm run omp:update-wire -- <omp 版本>",
    "// Copyright (c) 2025 Mario Zechner; Copyright (c) 2025-2026 Can Bölük; Copyright (c) 2026 Stencil Labs, Inc.",
    "// MIT License，全文见 src/shared/oh-my-pi-LICENSE.txt（随安装包分发到 resources/licenses/oh-my-pi-MIT.txt）。",
    "",
  ].join("\n");
  const file = path.join(root, target);
  await writeFile(file, header + body);
  console.log(`已写入 ${file}（omp v${version}，${body.length} 字符）`);
}
