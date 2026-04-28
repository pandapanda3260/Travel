import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import type { VideoMaterialRecord } from "./video-material-store";
import type {
  HotelAssetSceneType,
  ShotPlan,
  ShotPlanItem,
  StoryboardMaterialIntent,
  StoryboardNarrativeBeat,
  StoryboardShotBinding,
  TaskStoryboardPlan,
  VideoTaskAssetSourceType,
  VideoTaskParameterBundle,
  VideoTaskSource,
} from "./video-task-schema";

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

type StoryPhase = StoryboardNarrativeBeat["phase"];

function normalizeText(text: string | null | undefined) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function getShotPhase(shot: ShotPlanItem, index: number, shotCount: number): StoryPhase {
  const text = [
    shot.functionTag,
    shot.purpose,
    shot.sellingPointType,
    shot.sceneType,
    shot.sceneDescription,
    shot.narrationHint,
  ]
    .filter(Boolean)
    .join(" ");

  if (index === 0 || /(hook|hero|opening|开篇|开场|吸引)/iu.test(text)) {
    return "opening_hook";
  }
  if (index === shotCount - 1 || /(closing|收尾|转化|建议|行动)/iu.test(text)) {
    return "closing";
  }
  if (/(促销|活动|开业|价格|优惠|权益|信息|arrival|location)/iu.test(text)) {
    return "commercial_info";
  }
  if (/(套餐|房型|客房|早餐|餐饮|设施|卖点|room|amenity|package)/iu.test(text)) {
    return "package_value";
  }
  if (/(购买|适合|建议|人群|预订|转化)/iu.test(text)) {
    return "purchase_advice";
  }
  return "experience";
}

const phaseMeta: Record<
  StoryPhase,
  {
    title: string;
    defaultGoal: string;
    durationRangeLabel: string;
    materialStrategy: string;
    narrationStrategy: string;
  }
> = {
  opening_hook: {
    title: "开篇钩子",
    defaultGoal: "用最有记忆点的实拍画面和利益点让用户停留",
    durationRangeLabel: "2.5~5.5 秒",
    materialStrategy: "优先使用门头、外观、大堂、最强房型或最有冲击力的实拍素材",
    narrationStrategy: "第一句话要短、有画面感，直接抛出入住理由或活动利益点",
  },
  commercial_info: {
    title: "信息建立",
    defaultGoal: "交代开业、促销、活动、区位或基础权益，让用户快速理解产品",
    durationRangeLabel: "10~15 秒",
    materialStrategy: "选择可证明信息的空间、服务、区位或活动相关画面",
    narrationStrategy: "信息表达要口语化，少堆名词，多用用户能立刻理解的场景语言",
  },
  package_value: {
    title: "套餐卖点讲解",
    defaultGoal: "围绕套餐内容、核心卖点、房型餐饮和体验价值展开",
    durationRangeLabel: "10~20 秒",
    materialStrategy: "按房型、餐饮、设施、服务细节的体验顺序组织素材",
    narrationStrategy: "每个卖点都要落到具体体验，避免像清单播报",
  },
  purchase_advice: {
    title: "购买建议",
    defaultGoal: "告诉用户适合谁、什么时候买、为什么现在值得下单",
    durationRangeLabel: "5~10 秒",
    materialStrategy: "使用能支持决策的体验镜头或服务细节镜头",
    narrationStrategy: "像朋友给建议一样表达，强调适合人群和行动理由",
  },
  closing: {
    title: "收尾转化",
    defaultGoal: "用氛围和行动建议收住整条视频，形成转化闭环",
    durationRangeLabel: "3~6 秒",
    materialStrategy: "用氛围镜头、外观、房间记忆点或最稳定画面做收尾",
    narrationStrategy: "一句话收束记忆点，不拖尾，不硬广",
  },
  experience: {
    title: "体验展开",
    defaultGoal: "补足真实入住体验和空间动线，让叙事更连贯",
    durationRangeLabel: "4~8 秒",
    materialStrategy: "跟随用户素材顺序和场景覆盖组织镜头",
    narrationStrategy: "用自然体验描述承接前后镜头，避免跳跃",
  },
};

function buildNarrativeSummary(source: VideoTaskSource, plan: ShotPlan) {
  const subject = normalizeText(source.productInfoTitle) || normalizeText(source.userPrompt).slice(0, 24) || "这组实拍素材";
  const shotCount = plan.shots.length;
  const materialDrivenCount = plan.shots.filter((shot) => shot.assetId || shot.referenceImageUrl).length;
  return `${subject}将以“先抓注意力、再讲清信息、随后展开套餐/体验卖点、最后给出购买建议”的顺序组织，${shotCount} 个镜头中 ${materialDrivenCount} 个优先承接用户实拍素材。`;
}

function buildStoryboardBeats(plan: ShotPlan) {
  const sortedShots = [...plan.shots].sort((left, right) => left.shotIndex - right.shotIndex);
  const phaseMap = new Map<StoryPhase, ShotPlanItem[]>();

  sortedShots.forEach((shot, index) => {
    const phase = getShotPhase(shot, index, sortedShots.length);
    phaseMap.set(phase, [...(phaseMap.get(phase) ?? []), shot]);
  });

  return Array.from(phaseMap.entries()).map(([phase, shots], index): StoryboardNarrativeBeat => {
    const meta = phaseMeta[phase];
    const goals = shots
      .map((shot) => normalizeText(shot.narrationHint) || normalizeText(shot.sceneDescription) || normalizeText(shot.purpose))
      .filter(Boolean);
    return {
      beatId: `${index + 1}-${phase}`,
      title: meta.title,
      phase,
      goal: goals[0] || meta.defaultGoal,
      durationRangeLabel: meta.durationRangeLabel,
      targetShotIndexes: shots.map((shot) => shot.shotIndex),
      materialStrategy: meta.materialStrategy,
      narrationStrategy: meta.narrationStrategy,
    };
  });
}

function getAssetPriority(asset: TaskHotelAssetRecord): StoryboardMaterialIntent["priority"] {
  if (asset.isHeroCandidate || asset.sceneType === "exterior" || asset.sceneType === "room") {
    return "hero";
  }
  if (asset.commercialScore >= 75 || asset.sceneType === "food" || asset.sceneType === "facility") {
    return "core";
  }
  if (asset.reviewStatus === "rejected" || asset.commercialScore < 45) {
    return "backup";
  }
  return "support";
}

function getAssetRecommendedRole(asset: TaskHotelAssetRecord) {
  const sceneLabel = sceneLabelMap[asset.sceneType] ?? "素材";
  if (asset.userNote) {
    return `优先尊重用户备注，用于表现${asset.userNote}`;
  }
  if (asset.isHeroCandidate) {
    return `适合做开篇或重点转场的${sceneLabel}镜头`;
  }
  if (asset.isCloseupCandidate) {
    return `适合做细节补充的${sceneLabel}镜头`;
  }
  return `适合支撑${sceneLabel}相关讲述`;
}

function buildMaterialIntents(input: {
  hotelAssets: TaskHotelAssetRecord[];
  referenceVideoMaterial?: VideoMaterialRecord | null;
  shots: ShotPlanItem[];
}) {
  const mappedShotIndexesByAsset = new Map<string, number[]>();
  for (const shot of input.shots) {
    if (!shot.assetId) {
      continue;
    }
    mappedShotIndexesByAsset.set(shot.assetId, [...(mappedShotIndexesByAsset.get(shot.assetId) ?? []), shot.shotIndex]);
  }

  const photoIntents: StoryboardMaterialIntent[] = input.hotelAssets.map((asset) => ({
    assetId: asset.assetId,
    displayName: asset.displayName || asset.fileName || `实拍图 ${asset.sortOrder + 1}`,
    sourceType: "user_upload",
    sceneType: asset.sceneType,
    originalUserNote: asset.userNote,
    analysisSummary:
      asset.subjectSummary ||
      [sceneLabelMap[asset.sceneType], asset.tags.join("、")].filter(Boolean).join("，") ||
      "待补充素材分析",
    recommendedRole: getAssetRecommendedRole(asset),
    mappedShotIndexes: mappedShotIndexesByAsset.get(asset.assetId) ?? [],
    priority: getAssetPriority(asset),
  }));

  const videoIntent: StoryboardMaterialIntent[] =
    input.referenceVideoMaterial?.materialId && input.shots.some((shot) => shot.sourceMaterialId === input.referenceVideoMaterial?.materialId)
      ? [
          {
            assetId: input.referenceVideoMaterial.materialId,
            displayName: input.referenceVideoMaterial.name || "实拍视频素材",
            sourceType: "user_video",
            sceneType: null,
            originalUserNote: input.referenceVideoMaterial.videoTemplatePrompt ?? "",
            analysisSummary: input.referenceVideoMaterial.videoTemplatePrompt || "来自视频拆解素材库的实拍视频镜头",
            recommendedRole: "用于承接连续动线、空间转场或可直接裁剪的视频片段",
            mappedShotIndexes: input.shots
              .filter((shot) => shot.sourceMaterialId === input.referenceVideoMaterial?.materialId)
              .map((shot) => shot.shotIndex),
            priority: "core",
          },
        ]
      : [];

  return [...photoIntents, ...videoIntent];
}

function buildShotBinding(input: {
  shot: ShotPlanItem;
  assetById: Map<string, StoryboardMaterialIntent>;
}): StoryboardShotBinding {
  const asset = input.shot.assetId ? input.assetById.get(input.shot.assetId) : null;
  const sourceType =
    input.shot.assetSourceType ??
    (input.shot.sourceMaterialId ? "user_video" : input.shot.generationMode === "ai_generated_broll" ? "ai_generated" : null);
  const primaryAssetLabel =
    asset?.displayName ||
    input.shot.sourceTimeRangeLabel ||
    (input.shot.generationMode === "ai_generated_broll" ? "AI 补镜头" : "未绑定素材");
  const narrationGoal = normalizeText(input.shot.narrationHint) || normalizeText(input.shot.sceneDescription);

  return {
    shotIndex: input.shot.shotIndex,
    segmentIndex: input.shot.segmentIndex ?? null,
    primaryAssetId: input.shot.assetId ?? input.shot.sourceMaterialId ?? null,
    primaryAssetLabel,
    sourceType: sourceType as VideoTaskAssetSourceType | "user_video" | null,
    supportingAssetIds: [],
    bindingReason:
      asset?.recommendedRole ||
      (input.shot.referenceImageUrl
        ? "使用实拍参考帧保持真实空间结构"
        : input.shot.generationMode === "ai_generated_broll"
          ? "当前叙事段缺少直接匹配素材，标记为 AI 补镜头"
          : "根据镜头叙事目标保留素材占位"),
    userIntentPreserved:
      asset?.originalUserNote ||
      asset?.analysisSummary ||
      input.shot.assetSubjectSummary ||
      (input.shot.referenceImageUrl ? "保留用户实拍素材的真实空间、构图和主体" : "未绑定用户素材"),
    narrationGoal,
    subtitleGoal: narrationGoal ? `字幕突出：${narrationGoal}` : "字幕保持短句、口语化、可快速扫读",
    needsAiFallback: input.shot.generationMode === "ai_generated_broll" || !input.shot.assetId,
  };
}

export function buildTaskStoryboardPlan(input: {
  source: VideoTaskSource;
  parameters: VideoTaskParameterBundle;
  shotPlan: ShotPlan;
  hotelAssets?: TaskHotelAssetRecord[];
  referenceVideoMaterial?: VideoMaterialRecord | null;
}): TaskStoryboardPlan {
  const sortedShots = [...input.shotPlan.shots].sort((left, right) => left.shotIndex - right.shotIndex);
  const materialIntents = buildMaterialIntents({
    hotelAssets: input.hotelAssets ?? [],
    referenceVideoMaterial: input.referenceVideoMaterial,
    shots: sortedShots,
  });
  const assetById = new Map(materialIntents.map((asset) => [asset.assetId, asset]));
  const shotBindings = sortedShots.map((shot) => buildShotBinding({ shot, assetById }));
  const unboundMaterialCount = materialIntents.filter((asset) => asset.mappedShotIndexes.length === 0).length;
  const aiFallbackCount = shotBindings.filter((binding) => binding.needsAiFallback).length;
  const warnings = [
    unboundMaterialCount > 0 ? `${unboundMaterialCount} 个用户素材暂未绑定到镜头，可在素材确认阶段手动替换或调整顺序。` : "",
    aiFallbackCount > 0 ? `${aiFallbackCount} 个镜头需要 AI 补镜头，建议确认是否缺少对应实拍素材。` : "",
  ].filter(Boolean);

  return {
    version: 1,
    narrativeSummary: buildNarrativeSummary(input.source, input.shotPlan),
    speakingStyle: "像真人探店推荐一样表达：短句、具体、带感受，不堆砌酒店参数，不机械播报套餐清单。",
    editingGuidance: "先确认叙事段落和图片顺序，再调整台词与字幕；替换图片时优先保持同一叙事段的画面功能不变。",
    beats: buildStoryboardBeats(input.shotPlan),
    materialIntents,
    shotBindings,
    reviewChecklist: [
      "镜头数量不超过可用实拍图片数量，除非明确需要 AI 补镜头。",
      "每个主镜头都能解释为什么使用这张图或这段视频。",
      "开篇 3 秒内有强画面或强利益点。",
      "台词听起来像真人推荐，不像参数说明书。",
      "字幕短句化，和口播含义一致但不必逐字相同。",
    ],
    warnings,
    generatedAt: new Date().toISOString(),
  };
}
