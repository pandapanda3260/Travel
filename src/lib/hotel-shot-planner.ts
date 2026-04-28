import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import {
  buildHotelShotCandidates,
  type HotelShotCandidate,
  type HotelShotCandidateCoverageRole,
} from "./hotel-shot-candidates";
import type { VideoMaterialRecord } from "./video-material-store";
import type {
  HotelAssetSceneType,
  CommercialBeatPhase,
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
  commercialPhase: CommercialBeatPhase;
  commercialIntent: string;
  evidenceTarget: string;
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
    sellingPointTags: ["全新开业", "亲子/度假定位", "第一眼吸引"],
    narrationHint: "开场直接抛出地域、人群和最大停留理由，不慢铺垫",
    functionTag: "hero_opening",
    commercialPhase: "attention_hook",
    commercialIntent: "3 秒内让目标用户知道这条视频和自己有关，并愿意继续看",
    evidenceTarget: "地域/人群/强利益钩子",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["lobby"],
    goal: "确认品牌、地点和真实空间",
    shotScale: "wide",
    cameraMovement: "平稳横移",
    rhythm: "展开",
    mood: "品质感",
    sellingPointTags: ["品牌识别", "项目位置", "真实空间"],
    narrationHint: "快速讲清这是谁、在哪、靠不靠谱",
    functionTag: "arrival_space",
    commercialPhase: "identity_confirmation",
    commercialIntent: "让用户明确品牌/酒店/地点，建立真实感和信任感",
    evidenceTarget: "品牌和地点身份",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["room", "exterior", "facility"],
    goal: "前置开业、套餐或促销机会",
    shotScale: "wide",
    cameraMovement: "自然推进",
    rhythm: "机会抛出",
    mood: "紧迫感",
    sellingPointTags: ["开业大促", "限时机会", "先囤"],
    narrationHint: "把开业大促、低价房券或限时机会提前说出来",
    functionTag: "room_core",
    commercialPhase: "opportunity_offer",
    commercialIntent: "让用户知道为什么现在值得继续看或先囤",
    evidenceTarget: "开业/促销/稀缺机会",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["room", "dining", "food"],
    goal: "明确套餐、价格、房型或核心权益",
    shotScale: "close",
    cameraMovement: "细节推近",
    rhythm: "核心利益",
    mood: "划算感",
    sellingPointTags: ["套餐内容", "一价全包", "住宿餐饮"],
    narrationHint: "把价格、晚数、含吃含住含玩等核心利益讲清楚",
    functionTag: "detail_support",
    commercialPhase: "core_benefit",
    commercialIntent: "让用户明确这份套餐或体验具体给到什么",
    evidenceTarget: "价格/套餐/核心利益",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["dining", "food", "facility"],
    goal: "连续展示餐饮和配套权益",
    shotScale: "medium",
    cameraMovement: "轻微扫拍",
    rhythm: "权益堆叠",
    mood: "体验感",
    sellingPointTags: ["早餐", "正餐", "配套体验"],
    narrationHint: "用短句密集给出早餐、正餐、配套等具体权益",
    functionTag: "amenity_showcase",
    commercialPhase: "benefit_stack",
    commercialIntent: "让用户感觉权益密度高、东西多、很值",
    evidenceTarget: "餐饮/配套权益",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["facility", "neighborhood"],
    goal: "继续证明亲子、玩乐或周边权益",
    shotScale: "wide",
    cameraMovement: "稳定推进",
    rhythm: "权益加码",
    mood: "丰富感",
    sellingPointTags: ["儿童乐园", "运动娱乐", "周边权益"],
    narrationHint: "继续加码儿童乐园、俱乐部、课程、门票等可感知权益",
    functionTag: "facility_extension",
    commercialPhase: "benefit_stack",
    commercialIntent: "用多个实拍权益镜头扩大价值感",
    evidenceTarget: "玩乐/亲子/周边权益",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["service_detail", "food", "bathroom"],
    goal: "用服务或细节镜头做真实性证明",
    shotScale: "detail",
    cameraMovement: "微距推近",
    rhythm: "精细化",
    mood: "被照顾感",
    sellingPointTags: ["真实证明", "服务细节", "体验完成度"],
    narrationHint: "让画面证明口播利益点，不要只空说划算",
    functionTag: "service_detail",
    commercialPhase: "evidence_proof",
    commercialIntent: "让每个核心利益都有可见证据",
    evidenceTarget: "真实服务/细节证明",
    isAtmosphereInsert: false,
  },
  {
    sceneCandidates: ["neighborhood", "atmosphere", "exterior"],
    goal: "用位置、原价、品牌或环境完成价值锚定",
    shotScale: "wide",
    cameraMovement: "缓慢拉远",
    rhythm: "价值锚定",
    mood: "松弛感",
    sellingPointTags: ["区位", "原价对比", "品牌价值"],
    narrationHint: "用平日价格、品牌、位置或环境解释为什么这次划算",
    functionTag: "location_extension",
    commercialPhase: "value_anchor",
    commercialIntent: "把便宜变成有理由的划算，而不是单纯低价",
    evidenceTarget: "原价/品牌/区位价值",
    isAtmosphereInsert: true,
  },
  {
    sceneCandidates: ["atmosphere", "room", "exterior"],
    goal: "解除风险并完成行动收口",
    shotScale: "medium",
    cameraMovement: "轻柔定帧推进",
    rhythm: "收尾",
    mood: "记忆点",
    sellingPointTags: ["可退", "有效期", "行动引导"],
    narrationHint: "最后补不约可退、有效期或刷到先囤这类行动理由",
    functionTag: "closing_atmosphere",
    commercialPhase: "action_close",
    commercialIntent: "解决犹豫并告诉用户现在该做什么",
    evidenceTarget: "风险解除/行动引导",
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
      commercialPhase: "evidence_proof",
      commercialIntent: "用补充镜头继续证明前面提出的权益或体验价值",
      evidenceTarget: "中段体验补充证明",
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
  if (!eligibleCandidates.length) {
    return null;
  }
  if (input.workflowKind === "captured_material_first") {
    const unusedReferenceVideoCandidates = eligibleCandidates.filter(
      (candidate) =>
        candidate.sourceKind === "reference_video_shot" && (input.usedAssetCount.get(candidate.candidateId) ?? 0) === 0,
    );
    if (unusedReferenceVideoCandidates.length > 0) {
      eligibleCandidates = unusedReferenceVideoCandidates;
    }
  }

  const unusedCandidates = eligibleCandidates.filter((candidate) => (input.usedAssetCount.get(candidate.candidateId) ?? 0) === 0);
  if (unusedCandidates.length > 0) {
    eligibleCandidates = unusedCandidates;
  } else {
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
      commercialPhase: shot.commercialPhase ?? beat.commercialPhase,
      commercialIntent: shot.commercialIntent ?? beat.commercialIntent,
      evidenceTarget: shot.evidenceTarget ?? beat.evidenceTarget,
      conversionRole:
        shot.conversionRole ??
        (beat.commercialPhase === "risk_reversal" || beat.commercialPhase === "action_close"
          ? beat.commercialIntent
          : null),
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
