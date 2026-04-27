import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTaskVisualSelectedImageSessionId,
  parseTaskVisualSelectedImageSessionIdValue,
} from "./task-visual-image-session";

test("builds and parses shot-scoped visual image sessions", () => {
  const sessionId = buildTaskVisualSelectedImageSessionId("task-1", "segment-2", 5);

  assert.equal(sessionId, "task-1:segment-2:shot-5");
  assert.deepEqual(parseTaskVisualSelectedImageSessionIdValue(sessionId), {
    taskId: "task-1",
    segmentId: "segment-2",
    shotIndex: 5,
  });
});

test("parses legacy segment-only session ids for backward compatibility", () => {
  assert.deepEqual(parseTaskVisualSelectedImageSessionIdValue("task-1:segment-3"), {
    taskId: "task-1",
    segmentId: "segment-3",
    shotIndex: 3,
  });
});

test("rejects invalid visual image session ids", () => {
  assert.equal(parseTaskVisualSelectedImageSessionIdValue("task-1:segment-x"), null);
  assert.equal(parseTaskVisualSelectedImageSessionIdValue(""), null);
});
