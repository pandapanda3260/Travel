import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import type { VideoMaterialImageAsset, VideoMaterialRecord } from "./video-material-store";
import type { HotelAssetSceneType, VideoTaskWorkflowKind } from "./video-task-schema";

export type HotelShotCandidateSourceKind = "hotel_asset_photo" | "reference_video_shot";

export type HotelShotCandidateCoverageRole =
  | "hero_opening"
  | "arrival_space"
  | "room_core"
  | "detail_support"
  | "amenity_showcase"
  | "facility_extension"
  | "service_detail"
  | "location_extension"
  | "closing_atmosphere"
  | "generic";

export type HotelShotCandidate = {
  candidateId: string;
  sourceKind: HotelShotCandidateSourceKind;
  sceneType: HotelAssetSceneType;
  subjectSummary: string;
  purposeSummary: string;
  compositionType: string;
  recommendedShotScale: "wide" | "medium" | "close" | "detail";
  qualityScore: number;
  commercialScore: number;
  reviewStatus: "pending" | "passed" | "warning" | "rejected";
  canDirectI2V: boolean;
  needEnhancement: boolean;
  isHeroCandidate: boolean;
  isCloseupCandidate: boolean;
  referenceImageUrl: string | null;
  sourceAssetType: "user_upload" | "enhanced" | "ai_generated" | "video_material";
  sourceTrace: "user_photo" | "enhanced_from_user_photo" | "reference_video_keyframe" | "ai_generated";
  assetId: string | null;
  materialId: string | null;
  startAtSeconds: number | null;
  endAtSeconds: number | null;
  continuityGroup: string;
  coverageRole: HotelShotCandidateCoverageRole;
  cameraMovement: string;
  orderHint: number;
  durationSeconds: number | null;
  timeRangeLabel: string | null;
};

type TimeRange = {
  startSeconds: number | null;
  endSeconds: number | null;
  label: string | null;
};

const sceneLabelMap: Record<HotelAssetSceneType, string> = {
  exterior: "酒店外观",
  lobby: "酒店大堂",
  room: "客房",
  bathroom: "卫浴",
  dining: "餐厅环境",
  food: "早餐 / 菜品",
  facility: "配套设施",
  neighborhood: "周边环境",
  service_detail: "服务细节",
  atmosphere: "氛围镜头",
  other: "其他场景",
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampScore(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function detectSceneTypeFromText(text: string): HotelAssetSceneType {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return "other";
  if (/(门头|外观|外立面|酒店楼体|到达|drop off|外景|招牌|入口)/.test(normalized)) return "exterior";
  if (/(大堂|前台|接待|大厅|lobby|reception)/.test(normalized)) return "lobby";
  if (/(客房|卧室|双床|大床|套房|房间|床品|room|suite)/.test(normalized)) return "room";
  if (/(卫浴|浴室|洗手台|马桶|浴缸|淋浴|bath)/.test(normalized)) return "bathroom";
  if (/(餐厅|用餐|晚餐|包厢|dining|restaurant)/.test(normalized)) return "dining";
  if (/(早餐|甜品|菜品|餐食|摆盘|food|buffet)/.test(normalized)) return "food";
  if (/(泳池|健身房|会议室|儿童乐园|spa|温泉|设施|facility|gym|pool)/.test(normalized)) return "facility";
  if (/(周边|街景|海边|山景|景观|商圈|neighborhood|view)/.test(normalized)) return "neighborhood";
  if (/(欢迎礼|服务|摆件|香薰|洗漱包|细节|服务细节|service)/.test(normalized)) return "service_detail";
  if (/(氛围|光影|窗景|夜景|atmosphere)/.test(normalized)) return "atmosphere";
  return "other";
}

function normalizeShotScale(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  if (["wide", "广角", "大全景", "全景", "远景"].includes(normalized)) {
    return "wide" as const;
  }
  if (["close", "近景"].includes(normalized)) {
    return "close" as const;
  }
  if (["detail", "特写", "细节"].includes(normalized)) {
    return "detail" as const;
  }
  return "medium" as const;
}

function inferCoverageRole(input: {
  sceneType: HotelAssetSceneType;
  purposeText: string;
  index: number;
  total: number;
}): HotelShotCandidateCoverageRole {
  const purposeText = input.purposeText.toLowerCase();
  if (input.index === 0 || /(开场|吸引|钩子|到达|第一印象)/.test(purposeText)) {
    return "hero_opening";
  }
  if (input.index === input.total - 1) {
    return input.sceneType === "atmosphere" ? "closing_atmosphere" : "location_extension";
  }
  if (input.sceneType === "lobby") return "arrival_space";
  if (input.sceneType === "room") return "room_core";
  if (input.sceneType === "bathroom") return "detail_support";
  if (input.sceneType === "service_detail") return "service_detail";
  if (input.sceneType === "dining" || input.sceneType === "food") return "amenity_showcase";
  if (input.sceneType === "facility") return "facility_extension";
  if (input.sceneType === "neighborhood") return "location_extension";
  if (input.sceneType === "atmosphere") return "closing_atmosphere";
  return "generic";
}

function parseTimeRange(rawValue: unknown): TimeRange {
  const value = normalizeText(rawValue);
  if (!value) {
    return { startSeconds: null, endSeconds: null, label: null };
  }

  const normalized = value.replace(/[—–~至]/g, "-");
  const seconds = Array.from(normalized.matchAll(/(\d+(?:\.\d+)?)\s*秒?/g)).map((match) => Number(match[1]));
  if (seconds.length >= 2) {
    return {
      startSeconds: seconds[0] ?? null,
      endSeconds: seconds[1] ?? seconds[0] ?? null,
      label: value,
    };
  }
  if (seconds.length === 1) {
    return {
      startSeconds: seconds[0] ?? null,
      endSeconds: seconds[0] ?? null,
      label: value,
    };
  }
  return { startSeconds: null, endSeconds: null, label: value };
}

function getTimeRangeMidpoint(timeRange: TimeRange) {
  if (timeRange.startSeconds == null && timeRange.endSeconds == null) {
    return null;
  }
  if (timeRange.startSeconds == null) {
    return timeRange.endSeconds;
  }
  if (timeRange.endSeconds == null) {
    return timeRange.startSeconds;
  }
  return Number(((timeRange.startSeconds + timeRange.endSeconds) / 2).toFixed(2));
}

function pickNearestFrameUrl(frames: VideoMaterialImageAsset[], seconds: number | null) {
  if (!frames.length) {
    return null;
  }
  if (seconds == null) {
    return frames[0]?.imageUrl ?? null;
  }
  return (
    [...frames].sort((left, right) => {
      const leftDiff = Math.abs((left.timestampSeconds ?? 0) - seconds);
      const rightDiff = Math.abs((right.timestampSeconds ?? 0) - seconds);
      return leftDiff - rightDiff;
    })[0]?.imageUrl ?? null
  );
}

function parseVideoAnalysisShots(material: VideoMaterialRecord) {
  try {
    const parsed = JSON.parse(material.videoAnalysis) as Record<string, unknown>;
    return Array.isArray(parsed["镜头序列"]) ? (parsed["镜头序列"] as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function buildPhotoCandidate(asset: TaskHotelAssetRecord, index: number, total: number): HotelShotCandidate {
  const coverageRole = inferCoverageRole({
    sceneType: asset.sceneType,
    purposeText: `${asset.subjectSummary} ${asset.userNote}`.trim(),
    index,
    total,
  });

  return {
    candidateId: `photo:${asset.assetId}`,
    sourceKind: "hotel_asset_photo",
    sceneType: asset.sceneType,
    subjectSummary: asset.subjectSummary || sceneLabelMap[asset.sceneType],
    purposeSummary: asset.userNote || asset.subjectSummary || sceneLabelMap[asset.sceneType],
    compositionType: asset.compositionType,
    recommendedShotScale: asset.recommendedShotScale,
    qualityScore: asset.qualityScore,
    commercialScore: asset.commercialScore,
    reviewStatus: asset.reviewStatus,
    canDirectI2V: asset.canDirectI2V,
    needEnhancement: asset.needEnhancement,
    isHeroCandidate: asset.isHeroCandidate,
    isCloseupCandidate: asset.isCloseupCandidate,
    referenceImageUrl: asset.fileUrl,
    sourceAssetType: asset.sourceType,
    sourceTrace: asset.sourceType === "enhanced" ? "enhanced_from_user_photo" : "user_photo",
    assetId: asset.assetId,
    materialId: null,
    startAtSeconds: null,
    endAtSeconds: null,
    continuityGroup: `photo:${asset.sceneType}`,
    coverageRole,
    cameraMovement: "自然推进",
    orderHint: index,
    durationSeconds: null,
    timeRangeLabel: null,
  };
}

function buildVideoShotCandidate(
  material: VideoMaterialRecord,
  shot: Record<string, unknown>,
  index: number,
  total: number,
): HotelShotCandidate {
  const frames = material.cleanedFrames.length > 0 ? material.cleanedFrames : material.extractedFrames;
  const timeRange = parseTimeRange(shot["时间段"]);
  const midpoint = getTimeRangeMidpoint(timeRange);
  const visualContent = normalizeText(shot["视觉内容"]);
  const sceneText = normalizeText(shot["场景"]);
  const subjectText = normalizeText(shot["主体"]);
  const detailText = Array.isArray(shot["关键细节"])
    ? (shot["关键细节"] as unknown[]).map((item) => normalizeText(item)).filter(Boolean).slice(0, 2).join("，")
    : "";
  const purposeText = normalizeText(shot["镜头目的"]);
  const sceneType = detectSceneTypeFromText([sceneText, visualContent, subjectText, detailText].join("，"));
  const frameUrl = pickNearestFrameUrl(frames, midpoint);
  const shotScale = normalizeShotScale(shot["景别"] ?? shot["镜头类型"]);
  const coverageRole = inferCoverageRole({
    sceneType,
    purposeText: [purposeText, sceneText, visualContent].filter(Boolean).join("，"),
    index,
    total,
  });
  const hasFrame = Boolean(frameUrl);

  return {
    candidateId: `video:${material.materialId}:${index + 1}`,
    sourceKind: "reference_video_shot",
    sceneType,
    subjectSummary:
      [visualContent, subjectText, detailText].filter(Boolean).join("，") || sceneText || sceneLabelMap[sceneType],
    purposeSummary: purposeText || sceneText || visualContent || sceneLabelMap[sceneType],
    compositionType: normalizeText(shot["构图"]),
    recommendedShotScale: shotScale,
    qualityScore: clampScore(hasFrame ? 86 : 74, 80),
    commercialScore: clampScore(hasFrame ? 88 : 76, 82),
    reviewStatus: hasFrame ? "passed" : "warning",
    canDirectI2V: hasFrame,
    needEnhancement: !hasFrame,
    isHeroCandidate: coverageRole === "hero_opening" || sceneType === "exterior" || sceneType === "room",
    isCloseupCandidate: shotScale === "close" || shotScale === "detail",
    referenceImageUrl: frameUrl,
    sourceAssetType: "video_material",
    sourceTrace: hasFrame ? "reference_video_keyframe" : "ai_generated",
    assetId: null,
    materialId: material.materialId,
    startAtSeconds: timeRange.startSeconds,
    endAtSeconds: timeRange.endSeconds,
    continuityGroup: `video:${material.materialId}:${sceneType}`,
    coverageRole,
    cameraMovement: normalizeText(shot["镜头运动"]) || "自然运镜",
    orderHint: index,
    durationSeconds:
      timeRange.startSeconds != null && timeRange.endSeconds != null
        ? Math.max(0.8, Number((timeRange.endSeconds - timeRange.startSeconds).toFixed(2)))
        : null,
    timeRangeLabel: timeRange.label,
  };
}

export function buildHotelShotCandidates(input: {
  hotelAssets: TaskHotelAssetRecord[];
  referenceVideoMaterial?: VideoMaterialRecord | null;
}) {
  const photoCandidates = input.hotelAssets
    .filter((asset) => asset.fileUrl?.trim())
    .map((asset, index, records) => buildPhotoCandidate(asset, index, records.length));
  const videoShots =
    input.referenceVideoMaterial?.status === "ready" && input.referenceVideoMaterial.videoAnalysis.trim()
      ? parseVideoAnalysisShots(input.referenceVideoMaterial)
      : [];
  const videoCandidates = input.referenceVideoMaterial
    ? videoShots.map((shot, index) => buildVideoShotCandidate(input.referenceVideoMaterial as VideoMaterialRecord, shot, index, videoShots.length))
    : [];

  return {
    photoCandidates,
    videoCandidates: videoCandidates.filter((candidate) => candidate.referenceImageUrl || candidate.sceneType !== "other"),
    allCandidates: [...photoCandidates, ...videoCandidates],
  };
}

export function buildHotelCapturedMaterialContext(input: {
  hotelAssets: TaskHotelAssetRecord[];
  referenceVideoMaterial?: VideoMaterialRecord | null;
  workflowKind: VideoTaskWorkflowKind;
}) {
  const candidates = buildHotelShotCandidates(input);
  const sceneCoverageMap = candidates.allCandidates.reduce<Map<HotelAssetSceneType, number>>((map, candidate) => {
    map.set(candidate.sceneType, (map.get(candidate.sceneType) ?? 0) + 1);
    return map;
  }, new Map());

  return {
    workflowKind: input.workflowKind,
    photoAssetCount: input.hotelAssets.length,
    referenceVideoMaterial: input.referenceVideoMaterial
      ? {
          materialId: input.referenceVideoMaterial.materialId,
          name: input.referenceVideoMaterial.name,
          status: input.referenceVideoMaterial.status,
          shotCandidateCount: candidates.videoCandidates.length,
          contentScript: input.referenceVideoMaterial.contentScript.trim().slice(0, 300),
          subtitle: input.referenceVideoMaterial.subtitle.trim().slice(0, 200),
        }
      : null,
    sceneCoverage: Array.from(sceneCoverageMap.entries()).map(([sceneType, count]) => ({
      sceneType,
      sceneLabel: sceneLabelMap[sceneType],
      count,
    })),
    candidatePreview: candidates.allCandidates.slice(0, 8).map((candidate) => ({
      sourceKind: candidate.sourceKind,
      sceneType: candidate.sceneType,
      coverageRole: candidate.coverageRole,
      subjectSummary: candidate.subjectSummary,
      continuityGroup: candidate.continuityGroup,
      timeRangeLabel: candidate.timeRangeLabel,
    })),
  };
}
