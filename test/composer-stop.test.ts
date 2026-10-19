// 防的是：Esc 之后 toast 写"已停止"，其实这一轮没停下来或后台任务还会唤醒 omp。
import { describe, expect, it } from "vitest";
import type { RestoredQueue } from "../src/shared/ipc.ts";
import { stopToasts } from "../src/renderer/src/features/composer/stop-outcome.ts";

const restored = (overrides: Partial<RestoredQueue> = {}): RestoredQueue => ({
  steering: [],
  followUp: [],
  imagesDropped: false,
  truncated: false,
  aborted: true,
  backgroundWork: false,
  ...overrides,
});

describe("stopToasts", () => {
  it("干净停止：没有排队消息只说已停止；有排队消息带条数", () => {
    expect(stopToasts(restored())).toEqual([{ key: "composer.stopped" }]);
    expect(stopToasts(restored({ steering: [{ text: "a" }], followUp: [{ text: "b" }] }))).toEqual([
      { key: "composer.queueRestored", count: 2 },
    ]);
  });

  it("这一轮没停下：只报失败，不出现'已停止'", () => {
    const toasts = stopToasts(restored({ aborted: false, followUp: [{ text: "b" }] }));
    expect(toasts).toEqual([{ level: "warning", key: "composer.stopFailed" }]);
  });

  it("停下了但后台任务还会唤醒会话：已停止之后追加一条警告", () => {
    expect(stopToasts(restored({ backgroundWork: true }))).toEqual([
      { key: "composer.stopped" },
      { level: "warning", key: "composer.stoppedBackground" },
    ]);
  });

  it("图片太大没放回：警告排在已停止之前", () => {
    expect(stopToasts(restored({ imagesDropped: true, followUp: [{ text: "b" }] })).map((toast) => toast.key)).toEqual([
      "composer.imagesDropped",
      "composer.queueRestored",
    ]);
  });
});
