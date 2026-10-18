// 测试用的"主进程"：拉起 fake-omp（带孙进程），报告 pid，然后等着被测试强杀。
// 用法：node test/fake-omp/job-host.ts <fixture> <job|nojob>
// job 时按 task-pool 的做法把 omp 放进应用 Job Object；nojob 是对照组，用来确认测试能发现残留。
import { OmpConnection } from "../../src/main/omp/omp-connection.ts";
import { assignToAppJob } from "../../src/main/platform/win32/job-object.ts";
import path from "node:path";

const [fixture, mode] = process.argv.slice(2);
if (!fixture || (mode !== "job" && mode !== "nojob")) {
  process.stderr.write("usage: job-host.ts <fixture> <job|nojob>\n");
  process.exit(2);
}

const fakeOmp = path.join(import.meta.dirname, "fake-omp.ts");
const connection = OmpConnection.spawn({ command: process.execPath, args: [fakeOmp, fixture], cwd: process.cwd(), env: process.env });
if (mode === "job") assignToAppJob(connection.pid);
connection.onFrame((frame) => {
  const grandchild = frame as { type: string; pid?: number };
  if (grandchild.type === "test_grandchild") process.stdout.write(JSON.stringify({ omp: connection.pid, grandchild: grandchild.pid }) + "\n");
});
await connection.ready;
setInterval(() => {}, 60_000);
