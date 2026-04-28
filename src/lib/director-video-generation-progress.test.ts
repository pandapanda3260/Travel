import assert from "node:assert/strict";
import test from "node:test";

import { estimateDirectorVideoGenerationProgressPercent } from "./director-video-generation-progress";

test("快速生成视频进度不会因为轮询刷新 updatedAt 而回退", () => {
  const submittedAt = "2026-04-28T10:00:00.000Z";
  const previousProgress = estimateDirectorVideoGenerationProgressPercent(
    {
      status: "IN_PROGRESS",
      submittedAt,
      updatedAt: "2026-04-28T10:00:01.000Z",
    },
    new Date("2026-04-28T10:00:15.000Z").getTime(),
    5,
  );

  const refreshedProgress = estimateDirectorVideoGenerationProgressPercent(
    {
      status: "IN_PROGRESS",
      submittedAt,
      updatedAt: "2026-04-28T10:00:14.000Z",
    },
    new Date("2026-04-28T10:00:16.000Z").getTime(),
    5,
  );

  assert.ok(refreshedProgress >= previousProgress);
});

test("快速生成视频从排队进入生成中时进度不回落", () => {
  const submittedAt = "2026-04-28T10:00:00.000Z";
  const nowMs = new Date("2026-04-28T10:00:08.000Z").getTime();
  const queuedProgress = estimateDirectorVideoGenerationProgressPercent(
    {
      status: "QUEUED",
      submittedAt,
      updatedAt: submittedAt,
    },
    nowMs,
    5,
  );
  const runningProgress = estimateDirectorVideoGenerationProgressPercent(
    {
      status: "IN_PROGRESS",
      submittedAt,
      updatedAt: "2026-04-28T10:00:08.000Z",
    },
    nowMs,
    5,
  );

  assert.ok(runningProgress >= queuedProgress);
});
