import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";

export type TaskHotelAssetAnalysisStats = {
  total: number;
  completed: number;
  pending: number;
  warning: number;
  rejected: number;
  skipped: number;
  skippedReasons: Array<{
    reason: string;
    count: number;
  }>;
};

type HotelAssetAnalysisStatInput = Pick<
  TaskHotelAssetRecord,
  "sourceType" | "enhancedFromAssetId" | "reviewStatus" | "analyzedAt"
>;

export function shouldCountHotelAssetForUploadAnalysis(asset: HotelAssetAnalysisStatInput) {
  return asset.sourceType === "user_upload" && !asset.enhancedFromAssetId;
}

function getSkippedReason(asset: HotelAssetAnalysisStatInput) {
  if (asset.sourceType === "enhanced") {
    return "AI 优化图不进入上传解析队列";
  }
  if (asset.sourceType === "ai_generated") {
    return "AI 补图不进入上传解析队列";
  }
  if (asset.enhancedFromAssetId) {
    return "非原始上传图不进入上传解析队列";
  }
  return "";
}

function hasCompletedAnalysis(asset: HotelAssetAnalysisStatInput) {
  return Boolean(asset.analyzedAt?.trim());
}

export function buildTaskHotelAssetAnalysisStats(assets: HotelAssetAnalysisStatInput[]): TaskHotelAssetAnalysisStats {
  const skippedReasonCounts = new Map<string, number>();
  let total = 0;
  let completed = 0;
  let warning = 0;
  let rejected = 0;
  let skipped = 0;

  for (const asset of assets) {
    if (!shouldCountHotelAssetForUploadAnalysis(asset)) {
      skipped += 1;
      const reason = getSkippedReason(asset);
      if (reason) {
        skippedReasonCounts.set(reason, (skippedReasonCounts.get(reason) ?? 0) + 1);
      }
      continue;
    }

    total += 1;
    if (!hasCompletedAnalysis(asset)) {
      continue;
    }

    completed += 1;
    if (asset.reviewStatus === "warning") {
      warning += 1;
    }
    if (asset.reviewStatus === "rejected") {
      rejected += 1;
    }
  }

  return {
    total,
    completed,
    pending: Math.max(0, total - completed),
    warning,
    rejected,
    skipped,
    skippedReasons: Array.from(skippedReasonCounts, ([reason, count]) => ({ reason, count })),
  };
}
