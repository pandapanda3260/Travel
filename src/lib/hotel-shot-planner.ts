import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import {
  buildHotelShotCandidates,
  type HotelShotCandidate,
  type HotelShotCandidateCoverageRole,
} from "./hotel-shot-candidates";
import type { VideoMaterialRecord } from "./video-material-store";
import type {
  HotelAssetSceneType,
  ShotGenerationMode,
  ShotPlan,
  ShotPlanItem,
  VideoTaskWorkflowKind,
} from "./video-task-schema";

type HotelStoryBeat = {
  sceneCandidates: HotelAssetSceneType[];
  goal: string;
  shotScale: "wide" | "medium" | "close" | "detail";
  cameraMovement: string;
  rhythm: string;
  mood: string;
  sellingPointTags: string[];
  narrationHint: string;
  functionTag: string;
  isAtmosphereInsert: boolean;
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

const defaultStoryBeatTemplates: HotelStoryBeat[] = [
  {
    sceneCandidates: ["exterior", "neighborhood"],
    goal: "建立到达感与酒店第一印象",
    shotScale: "wide",
    cameraMovement: "缓慢推进",
    rhythm: "起势",
    mood: "欢迎感",
    sellingPointTags: ["到达感", "门头辨识度", "酒店气质"],
    narrationHint: "先把这家酒店的到达感和第一眼气质立住",
    functionTag: "hero_opening",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["lobby"],
    goal: "建立大堂与公共区域品质感",
    shotScale: "wide",
    cameraMovement: "平稳横移",
    rhythm: "展开",
    mood: "品质感",
    sellingPointTags: ["公区设计", "入住氛围", "空间感"],
    narrationHint: "把公共区域的空间感和第一印象讲清楚",
    functionTag: "arrival_space",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["room"],
    goal: "展示核心房型与入住体验",
    shotScale: "wide",
    cameraMovement: "自然推进",
    rhythm: "核心展示",
    mood: "舒适感",
    sellingPointTags: ["房型", "空间布局", "入住舒适度"],
    narrationHint: "把最核心的房型体验和空间布局交代清楚",
    functionTag: "room_core",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["bathroom", "service_detail"],
    goal: "补足清洁度与细节体验",
    shotScale: "close",
    cameraMovement: "细节推近",
    rhythm: "细节补充",
    mood: "安心感",
    sellingPointTags: ["洗浴体验", "清洁感", "细节完成度"],
    narrationHint: "把卫浴或细节体验补充出来，增强真实感",
    functionTag: "detail_support",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["dining", "food", "facility"],
    goal: "展示餐饮或配套体验",
    shotScale: "medium",
    cameraMovement: "轻微扫拍",
    rhythm: "丰富卖点",
    mood: "体验感",
    sellingPointTags: ["餐饮", "早餐", "配套体验"],
    narrationHint: "把餐饮或配套体验带出来，增强转化信息",
    functionTag: "amenity_showcase",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["facility", "neighborhood"],
    goal: "延展酒店配套与可玩性",
    shotScale: "wide",
    cameraMovement: "稳定推进",
    rhythm: "延展",
    mood: "丰富感",
    sellingPointTags: ["泳池健身", "公共设施", "停留价值"],
    narrationHint: "把配套价值说得更完整，不只停留在房间",
    functionTag: "facility_extension",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["service_detail", "food", "bathroom"],
    goal: "放大真实可感知的服务细节",
    shotScale: "detail",
    cameraMovement: "微距推近",
    rhythm: "精细化",
    mood: "被照顾感",
    sellingPointTags: ["服务细节", "欢迎礼", "体验完成度"],
    narrationHint: "通过真实细节把这家酒店和普通住宿区分开",
    functionTag: "service_detail",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["neighborhood", "atmosphere", "exterior"],
    goal: "交代区位与周边环境",
    shotScale: "wide",
    cameraMovement: "缓慢拉远",
    rhythm: "收束前铺垫",
    mood: "松弛感",
    sellingPointTags: ["区位", "周边环境", "目的地氛围"],
    narrationHint: "顺手把周边环境和目的地氛围补出来",
    functionTag: "location_extension",
    isAtmosphereInsert: true,
  },
  {
    sceneCandidates: ["atmosphere", "room", "exterior"],
    goal: "用氛围镜头收束整条视频",
    shotScale: "medium",
    cameraMovement: "轻柔定帧推进",
    rhythm: "收尾",
    mood: "记忆点",
    sellingPointTags: ["入住氛围", "记忆点", "收尾情绪"],
    narrationHint: "最后用氛围感把这次入住体验收住",
    functionTag: "closing_atmosphere",
    isAtmosphereInsert: true,
  },
];

function getScenePriority(sceneType: HotelAssetSceneType) {
  switch (sceneType) {
    case "exterior":
      return 100;
    case "room":
      return 96;
    case "lobby":
      return 92;
    case "bathroom":
      return 85;
    case "dining":
      return 82;
    case "food":
      return 78;
    case "facility":
      return 76;
    case "neighborhood":
      return 70;
    case "service_detail":
      return 68;
    case "atmosphere":
      return 64;
    default:
      return 40;
  }
}

function getCoverageRoleBonus(
  candidateCoverageRole: HotelShotCandidateCoverageRole,
  expectedFunctionTag: string,
) {
  return candidateCoverageRole === expectedFunctionTag ? 10 : 0;
}

function getWorkflowSourceBonus(candidate: HotelShotCandidate, workflowKind: VideoTaskWorkflowKind) {
  if (workflowKind === "captured_material_first") {
    return candidate.sourceKind === "reference_video_shot" ? 14 : 4;
  }
  return candidate.sourceKind === "hotel_asset_photo" ? 10 : 2;
}

function getContinuityBonus(input: {
  candidate: HotelShotCandidate;
  continuityGroup?: string | null;
  previousOrderHint?: number | null;
}) {
  if (!input.continuityGroup || input.candidate.continuityGroup !== input.continuityGroup) {
    return 0;
  }

  const baseBonus = 12;
  if (input.previousOrderHint == null) {
    return baseBonus;
  }

  const stepDistance = Math.abs(input.candidate.orderHint - input.previousOrderHint);
  return baseBonus + Math.max(0, 4 - Math.min(4, stepDistance));
}

function scoreCandidate(input: {
  candidate: HotelShotCandidate;
  preferredScale?: string;
  expectedFunctionTag: string;
  workflowKind: VideoTaskWorkflowKind;
  continuityGroup?: string | null;
  previousOrderHint?: number | null;
}) {
  const { candidate } = input;
  const scaleBonus = input.preferredScale && candidate.recommendedShotScale === input.preferredScale ? 8 : 0;
  const heroBonus = candidate.isHeroCandidate ? 10 : 0;
  const closeupBonus = input.preferredScale === "detail" && candidate.isCloseupCandidate ? 6 : 0;
  const directBonus = candidate.canDirectI2V ? 6 : 0;
  const enhancementPenalty = candidate.needEnhancement ? 4 : 0;
  const reviewPenalty = candidate.reviewStatus === "rejected" ? 16 : candidate.reviewStatus === "warning" ? 6 : 0;

  return (
    candidate.commercialScore * 0.55 +
    candidate.qualityScore * 0.45 +
    getScenePriority(candidate.sceneType) * 0.18 +
    scaleBonus +
    heroBonus +
    closeupBonus +
    directBonus +
    getWorkflowSourceBonus(candidate, input.workflowKind) +
    getCoverageRoleBonus(candidate.coverageRole, input.expectedFunctionTag) +
    getContinuityBonus(input) -
    enhancementPenalty -
    reviewPenalty
  );
}

function buildBeatSequence(shotCount: number) {
  if (shotCount <= defaultStoryBeatTemplates.length) {
    return defaultStoryBeatTemplates.slice(0, shotCount);
  }

  const sequence = [...defaultStoryBeatTemplates];
  while (sequence.length < shotCount) {
    sequence.splice(sequence.length - 1, 0, {
      sceneCandidates: ["room", "facility", "food", "service_detail"],
      goal: "补足中段体验信息",
      shotScale: "medium",
      cameraMovement: "稳定推进",
      rhythm: "过渡",
      mood: "真实体验",
      sellingPointTags: ["体验补充", "真实入住", "中段节奏"],
      narrationHint: "用真实体验镜头把中段内容补齐",
      functionTag: "generic",
      isAtmosphereInsert: false,
    });
  }

  return sequence.slice(0, shotCount);
}

function groupCandidates(candidates: HotelShotCandidate[]) {
  return candidates.reduce<Record<HotelAssetSceneType, HotelShotCandidate[]>>(
    (accumulator, candidate) => {
      accumulator[candidate.sceneType].push(candidate);
      return accumulator;
    },
    {
      exterior: [],
      lobby: [],
      room: [],
      bathroom: [],
      dining: [],
      food: [],
      facility: [],
      neighborhood: [],
      service_detail: [],
      atmosphere: [],
      other: [],
    },
  );
}

function pickCandidateForBeat(input: {
  groupedCandidates: Record<HotelAssetSceneType, HotelShotCandidate[]>;
  allCandidates: HotelShotCandidate[];
  sceneCandidates: HotelAssetSceneType[];
  preferredScale: string;
  expectedFunctionTag: string;
  workflowKind: VideoTaskWorkflowKind;
  usedAssetCount: Map<string, number>;
  continuityGroup?: string | null;
  previousOrderHint?: number | null;
}) {
  let eligibleCandidates = input.sceneCandidates.flatMap((sceneType) => input.groupedCandidates[sceneType] ?? []);
  if (!eligibleCandidates.length && input.workflowKind === "captured_material_first") {
    eligibleCandidates = input.allCandidates.filter((candidate) => candidate.sourceKind === "reference_video_shot");
  }
  if (!eligibleCandidates.length) {
    eligibleCandidates = input.allCandidates;
  }
  if (!eligibleCandidates.length) {
    return null;
  }

  return [...eligibleCandidates].sort((left, right) => {
    const leftUsed = input.usedAssetCount.get(left.candidateId) ?? 0;
    const rightUsed = input.usedAssetCount.get(right.candidateId) ?? 0;
    if (leftUsed !== rightUsed) {
      return leftUsed - rightUsed;
    }

    return (
      scoreCandidate({
        candidate: right,
        preferredScale: input.preferredScale,
        expectedFunctionTag: input.expectedFunctionTag,
        workflowKind: input.workflowKind,
        continuityGroup: input.continuityGroup,
        previousOrderHint: input.previousOrderHint,
      }) -
      scoreCandidate({
        candidate: left,
        preferredScale: input.preferredScale,
        expectedFunctionTag: input.expectedFunctionTag,
        workflowKind: input.workflowKind,
        continuityGroup: input.continuityGroup,
        previousOrderHint: input.previousOrderHint,
      })
    );
  })[0] ?? null;
}

function resolveGenerationMode(candidate: HotelShotCandidate | null): ShotGenerationMode {
  if (!candidate || !candidate.referenceImageUrl) {
    return "ai_generated_broll";
  }

  return candidate.canDirectI2V && candidate.reviewStatus === "passed" && !candidate.needEnhancement
    ? "photo_direct_i2v"
    : "photo_enhanced_i2v";
}

function buildSceneDescription(
  sceneType: HotelAssetSceneType,
  candidate: HotelShotCandidate | null,
  beat: HotelStoryBeat,
) {
  const sceneLabel = sceneLabelMap[sceneType];
  const subjectSummary = candidate?.subjectSummary?.trim() || "";
  if (!subjectSummary) {
    return `${sceneLabel}，${beat.goal}`;
  }
  if (subjectSummary.includes(sceneLabel)) {
    return subjectSummary;
  }
  return `${sceneLabel}，${subjectSummary}`;
}

function buildImg2ImgPrompt(
  sceneType: HotelAssetSceneType,
  candidate: HotelShotCandidate | null,
  beat: HotelStoryBeat,
) {
  const sceneLabel = sceneLabelMap[sceneType];
  const subjectSummary = candidate?.subjectSummary?.trim() || sceneLabel;
  const sourceLabel = candidate?.sourceKind === "reference_video_shot" ? "用户上传的酒店实拍视频关键帧" : "用户上传的酒店实拍图";
  return [
    `以${sourceLabel}为主体，场景是${subjectSummary}。`,
    "在不改变酒店真实空间结构、动线、窗景、家具布局和装修风格的前提下，提升画面通透度、清晰度与商业展示质感。",
    `保留${sceneLabel}的真实比例和材质，不新增不存在的家具、装饰、人物或空间。`,
    `构图目标：${candidate?.compositionType || beat.goal}，推荐景别：${candidate?.recommendedShotScale || beat.shotScale}。`,
    "整体风格为真实酒店探店短视频封面帧，真实、干净、可转化。",
  ].join("");
}

function buildI2VPrompt(
  sceneType: HotelAssetSceneType,
  candidate: HotelShotCandidate | null,
  beat: HotelStoryBeat,
) {
  const sceneLabel = sceneLabelMap[sceneType];
  const subjectSummary = candidate?.subjectSummary?.trim() || sceneLabel;
  const sourceHint =
    candidate?.sourceKind === "reference_video_shot" && candidate.timeRangeLabel
      ? `参考实拍视频中的 ${candidate.timeRangeLabel} 关键画面，`
      : "";
  return [
    `基于这张${sceneLabel}实拍参考画面做真实酒店探店短视频镜头，${sourceHint}主体是${subjectSummary}。`,
    `运镜方式：${candidate?.cameraMovement || beat.cameraMovement}，节奏：${beat.rhythm}，情绪：${beat.mood}。`,
    `突出${beat.goal}，保持酒店真实结构、陈设和空间关系，不新增陌生人物，不改变建筑和家具布局。`,
    "镜头语言克制自然，适合短视频平台宣传发布。",
  ].join("");
}

function buildFallbackImagePrompt(sceneType: HotelAssetSceneType, beat: HotelStoryBeat) {
  const sceneLabel = sceneLabelMap[sceneType];
  return [
    `${sceneLabel}，${beat.goal}。`,
    `景别 ${beat.shotScale}，构图真实克制，运镜预设 ${beat.cameraMovement}。`,
    "真实酒店探店短视频画面，不要陌生人物抢主体，不要改变真实结构，不要虚构不存在的空间和家具。",
  ].join("");
}

function buildFallbackVideoPrompt(sceneType: HotelAssetSceneType, beat: HotelStoryBeat) {
  return [
    `围绕${sceneLabelMap[sceneType]}做短视频探店镜头。`,
    `运镜 ${beat.cameraMovement}，节奏 ${beat.rhythm}，情绪 ${beat.mood}。`,
    `重点表达 ${beat.goal}。`,
  ].join("");
}

function applyBeatToShot(
  shot: ShotPlanItem,
  beat: HotelStoryBeat,
  candidate: HotelShotCandidate | null,
): ShotPlanItem {
  const sceneType = candidate?.sceneType ?? beat.sceneCandidates[0] ?? "other";
  const generationMode = resolveGenerationMode(candidate);
  const sceneDescription = buildSceneDescription(sceneType, candidate, beat);
  const imagePrompt =
    generationMode === "ai_generated_broll"
      ? buildFallbackImagePrompt(sceneType, beat)
      : buildImg2ImgPrompt(sceneType, candidate, beat);
  const videoPrompt =
    generationMode === "ai_generated_broll"
      ? buildFallbackVideoPrompt(sceneType, beat)
      : buildI2VPrompt(sceneType, candidate, beat);

  const nextVisual = {
    ...shot.visual,
    sceneSetting: sceneLabelMap[sceneType],
    shotScale: shot.visual?.shotScale || candidate?.recommendedShotScale || beat.shotScale,
    composition: shot.visual?.composition || candidate?.compositionType || beat.goal,
    keyDetails: shot.visual?.keyDetails || candidate?.subjectSummary || sceneDescription,
  };
  const nextCinematography = {
    ...shot.cinematography,
    rhythm: shot.cinematography?.rhythm || beat.rhythm,
  };

  return {
    ...shot,
    sceneType,
    location: sceneLabelMap[sceneType],
    sceneDescription,
    contentDescription: candidate?.subjectSummary || beat.goal,
    narrationHint: candidate?.subjectSummary
      ? `${beat.narrationHint}，重点是${candidate.subjectSummary}`
      : beat.narrationHint,
    action: beat.goal,
    emotion: beat.mood,
    cameraMovement: candidate?.cameraMovement || beat.cameraMovement,
    functionTag: shot.functionTag || beat.functionTag,
    sellingPointType: shot.sellingPointType || beat.sellingPointTags[0] || shot.sellingPointType,
    shotScale: candidate?.recommendedShotScale || beat.shotScale,
    compositionHint: candidate?.compositionType || beat.goal,
    rhythmTag: beat.rhythm,
    mood: beat.mood,
    sellingPointTags: beat.sellingPointTags,
    assetId: candidate?.assetId ?? candidate?.candidateId ?? null,
    assetSourceType: candidate?.sourceAssetType ?? (generationMode === "ai_generated_broll" ? "ai_generated" : null),
    assetSubjectSummary: candidate?.subjectSummary ?? null,
    sourceMaterialId: candidate?.materialId ?? null,
    sourceStartAtSeconds: candidate?.startAtSeconds ?? null,
    sourceEndAtSeconds: candidate?.endAtSeconds ?? null,
    sourceTimeRangeLabel: candidate?.timeRangeLabel ?? null,
    referenceImageUrl: candidate?.referenceImageUrl ?? null,
    generationMode,
    sourceTrace: candidate?.sourceTrace ?? "ai_generated",
    needImageEnhancement: generationMode === "photo_enhanced_i2v",
    needImageToVideo: true,
    isAtmosphereInsert: beat.isAtmosphereInsert,
    img2imgPrompt: imagePrompt,
    i2vPrompt: videoPrompt,
    visual: nextVisual,
    cinematography: nextCinematography,
  };
}

export function applyHotelAssetPlanning(input: {
  shotPlan: ShotPlan;
  hotelAssets: TaskHotelAssetRecord[];
  referenceVideoMaterial?: VideoMaterialRecord | null;
  workflowKind?: VideoTaskWorkflowKind;
}) {
  const workflowKind = input.workflowKind ?? "visual_reference_first";
  const candidates = buildHotelShotCandidates({
    hotelAssets: input.hotelAssets,
    referenceVideoMaterial: input.referenceVideoMaterial,
  });
  if (!candidates.allCandidates.length || !input.shotPlan.shots.length) {
    return input.shotPlan;
  }

  const groupedCandidates = groupCandidates(candidates.allCandidates);
  const usedAssetCount = new Map<string, number>();
  const beatSequence = buildBeatSequence(input.shotPlan.shots.length);
  let previousSegmentIndex: number | null = null;
  let previousCandidate: HotelShotCandidate | null = null;

  return {
    ...input.shotPlan,
    shots: input.shotPlan.shots
      .sort((left, right) => left.shotIndex - right.shotIndex)
      .map((shot, index) => {
        const beat = beatSequence[index] ?? beatSequence[beatSequence.length - 1] ?? defaultStoryBeatTemplates[0];
        const sameSegment = previousSegmentIndex != null && (shot.segmentIndex ?? null) === previousSegmentIndex;
        const directCandidate = pickCandidateForBeat({
          groupedCandidates,
          allCandidates: candidates.allCandidates,
          sceneCandidates: beat.sceneCandidates,
          preferredScale: beat.shotScale,
          expectedFunctionTag: beat.functionTag,
          workflowKind,
          usedAssetCount,
          continuityGroup: sameSegment ? previousCandidate?.continuityGroup ?? null : null,
          previousOrderHint: sameSegment ? previousCandidate?.orderHint ?? null : null,
        });

        if (directCandidate) {
          usedAssetCount.set(directCandidate.candidateId, (usedAssetCount.get(directCandidate.candidateId) ?? 0) + 1);
        }

        previousSegmentIndex = shot.segmentIndex ?? null;
        previousCandidate = directCandidate;

        return applyBeatToShot(shot, beat, directCandidate);
      }),
  } satisfies ShotPlan;
}
