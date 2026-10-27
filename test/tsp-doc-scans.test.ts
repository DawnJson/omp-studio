import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TspDocScans } from "../src/main/tasks/tsp-doc-scans.ts";
import { findBtwView } from "../src/shared/tsp/btw.ts";
import { statusToastTexts } from "../src/shared/tsp/composer-state.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { hasRunningWork } from "../src/shared/tsp/task-status.ts";
import { deriveTodoPhases } from "../src/shared/tsp/todos.ts";
import { loadTspFixture, tspDocMessages, tspFixtureDir } from "./tsp-fixtures.ts";

const fixtures = readdirSync(tspFixtureDir)
  .filter((name) => name.endsWith(".jsonl"))
  .map((name) => name.slice(0, -".jsonl".length));

describe("TspDocScans：按 changed 跳过重扫，结果和每条消息都整篇重扫一致", () => {
  it.each(fixtures)("%s", (name) => {
    const doc = createDocument();
    const scans = new TspDocScans(doc);
    for (const { message } of tspDocMessages(loadTspFixture(name))) {
      scans.observe(message, applyMessage(doc, message));
      expect(scans.todoPhases).toEqual(deriveTodoPhases(doc));
      expect(scans.toastTexts).toEqual(statusToastTexts(doc));
      expect(scans.btwView).toEqual(findBtwView(doc));
      expect(scans.runningWork).toBe(hasRunningWork(doc));
    }
  });
});
