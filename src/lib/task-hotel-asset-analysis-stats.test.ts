import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskHotelAssetAnalysisStats } from "./task-hotel-asset-analysis-stats";
import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";

function asset(input: {
  sourceType: TaskHotelAssetRecord["sourceType"];
  enhancedFromAssetId?: string | null;
  reviewStatus?: TaskHotelAssetRecord["reviewStatus"];
  analyzedAt?: string | null;
}) {
  return {
    sourceType: input.sourceType,
    enhancedFromAssetId: input.enhancedFromAssetId ?? null,
    reviewStatus: input.reviewStatus ?? "pending",
    analyzedAt: input.analyzedAt ?? null,
  } as TaskHotelAssetRecord;
}

test("buildTaskHotelAssetAnalysisStats 只把原始上传图计入解析分母", () => {
  const stats = buildTaskHotelAssetAnalysisStats([
    asset({ sourceType: "user_upload", reviewStatus: "passed", analyzedAt: "2026-05-01T08:00:00.000Z" }),
    asset({ sourceType: "user_upload", reviewStatus: "pending", analyzedAt: null }),
    asset({
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
      reviewStatus: "passed",
      analyzedAt: "2026-05-01T08:01:00.000Z",
    }),
  ]);

  assert.equal(stats.total, 2);
  assert.equal(stats.completed, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.skipped, 1);
  assert.deepEqual(stats.skippedReasons, [
    {
      reason: "AI 优化图不进入上传解析队列",
      count: 1,
    },
  ]);
});

test("buildTaskHotelAssetAnalysisStats 用 analyzedAt 判断解析完成而不是质量状态", () => {
  const stats = buildTaskHotelAssetAnalysisStats([
    asset({ sourceType: "user_upload", reviewStatus: "rejected", analyzedAt: "2026-05-01T08:00:00.000Z" }),
    asset({ sourceType: "user_upload", reviewStatus: "warning", analyzedAt: "2026-05-01T08:01:00.000Z" }),
    asset({ sourceType: "user_upload", reviewStatus: "passed", analyzedAt: null }),
  ]);

  assert.equal(stats.total, 3);
  assert.equal(stats.completed, 2);
  assert.equal(stats.pending, 1);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.warning, 1);
});
