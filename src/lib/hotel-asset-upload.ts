import { buildFallbackHotelAssetAnalysis } from "./hotel-asset-vision";
import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import type { HotelAssetSceneType } from "./video-task-schema";

type HotelAssetUploadSeedInput = {
  width: number;
  height: number;
  fileName?: string | null;
  userNote?: string | null;
  preferredSceneType?: HotelAssetSceneType | null;
};

export type PendingHotelAssetAnalysis = Pick<
  TaskHotelAssetRecord,
  | "sceneType"
  | "subjectSummary"
  | "tags"
  | "compositionType"
  | "recommendedShotScale"
  | "isHeroCandidate"
  | "isCloseupCandidate"
  | "canDirectI2V"
  | "needEnhancement"
  | "qualityScore"
  | "commercialScore"
  | "reviewStatus"
  | "analyzedAt"
>;

export function buildPendingHotelAssetAnalysis(input: HotelAssetUploadSeedInput): PendingHotelAssetAnalysis {
  const fallback = buildFallbackHotelAssetAnalysis({
    imageDataUrl: "",
    width: input.width,
    height: input.height,
    fileName: input.fileName,
    userNote: input.userNote,
    preferredSceneType: input.preferredSceneType,
  });

  return {
    sceneType: fallback.sceneType,
    subjectSummary: fallback.subjectSummary,
    tags: fallback.tags,
    compositionType: fallback.compositionType,
    recommendedShotScale: fallback.recommendedShotScale,
    isHeroCandidate: fallback.isHeroCandidate,
    isCloseupCandidate: fallback.isCloseupCandidate,
    canDirectI2V: fallback.canDirectI2V,
    needEnhancement: fallback.needEnhancement,
    qualityScore: fallback.qualityScore,
    commercialScore: fallback.commercialScore,
    reviewStatus: "pending",
    analyzedAt: null,
  };
}
