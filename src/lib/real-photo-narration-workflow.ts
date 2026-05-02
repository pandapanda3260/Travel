import { estimateNarrationReadingSeconds, normalizeNarrationSpokenText, sanitizeNarrationText } from "./narration";
import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import type {
  CommercialBeatPhase,
  HotelAssetSceneType,
  RealPhotoMaterialBrief,
  RealPhotoMaterialBriefItem,
  RealPhotoMaterialPriority,
  RealPhotoNarrationBeat,
  RealPhotoNarrationBlueprint,
  RealPhotoNarrationPhase,
  ShotPlan,
  ShotPlanItem,
  ShotSourceTrace,
  VideoTaskAssetSourceType,
  VideoTaskParameterBundle,
  VideoTaskSource,
} from "./video-task-schema";

export type BuildRealPhotoMaterialBriefInput = {
  source: VideoTaskSource;
  hotelAssets?: TaskHotelAssetRecord[];
  now?: string;
};

export type BuildFallbackRealPhotoNarrationBlueprintInput = {
  source: VideoTaskSource;
  parameters: VideoTaskParameterBundle;
  materialBrief: RealPhotoMaterialBrief;
  now?: string;
};

export type BuildShotPlanFromRealPhotoNarrationBlueprintInput = {
  blueprint: RealPhotoNarrationBlueprint;
  materialBrief: RealPhotoMaterialBrief;
  parameters: VideoTaskParameterBundle;
};

export type NormalizeRealPhotoNarrationBlueprintCandidateInput = {
  candidate: unknown;
  fallback: RealPhotoNarrationBlueprint;
  materialBrief: RealPhotoMaterialBrief;
  now?: string;
};

export type RealPhotoNarrationWorkflowFallback = {
  materialBrief: RealPhotoMaterialBrief;
  narrationBlueprint: RealPhotoNarrationBlueprint;
  shotPlan: ShotPlan;
};

type PhaseTemplate = {
  phase: RealPhotoNarrationPhase;
  title: string;
  intent: string;
  scenePreference: HotelAssetSceneType[];
  strength: RealPhotoNarrationBeat["structureStrength"];
  buildSpokenText: (context: RealPhotoNarrationTextContext) => string;
};

type RealPhotoNarrationTextContext = {
  productTitle: string;
  productSummary: string;
  userIntent: string;
  templateSummary: string;
  materialSummary: string;
};

const phaseTemplates: PhaseTemplate[] = [
  {
    phase: "opening_hook",
    title: "先制造停留理由",
    intent: "开篇先抛出用户真实顾虑，让画面有停留感，再进入产品信息。",
    scenePreference: ["exterior", "lobby", "atmosphere", "neighborhood", "other"],
    strength: "medium",
    buildSpokenText: () => "先别急着看价格，真正适不适合亲子度假，先看孩子能不能玩得住。",
  },
  {
    phase: "context_setup",
    title: "交代地点和进入感",
    intent: "用到达、环境、第一印象承接开篇，不直接堆卖点。",
    scenePreference: ["lobby", "exterior", "room", "atmosphere", "other"],
    strength: "medium",
    buildSpokenText: (context) =>
      `${context.productTitle}的第一眼，重点不是豪不豪华，而是有没有那种一到就放松下来的度假感。`,
  },
  {
    phase: "material_evidence",
    title: "用素材证明体验",
    intent: "把房间、餐饮、活动等实拍证据串成一句用户能理解的理由。",
    scenePreference: ["facility", "room", "dining", "food", "service_detail", "other"],
    strength: "medium",
    buildSpokenText: () => "房间、餐厅和活动区放在一起看，逻辑就清楚了：大人省心，孩子有事做。",
  },
  {
    phase: "offer_value",
    title: "自然落到套餐价值",
    intent: "说明套餐为什么值得，但保持真人推荐的口吻。",
    scenePreference: ["dining", "food", "room", "facility", "service_detail", "other"],
    strength: "medium",
    buildSpokenText: () => "如果套餐把餐、住、玩都包进去，预算反而更好算，临时加项也少。",
  },
  {
    phase: "action_close",
    title: "给出购买判断",
    intent: "收束到适合人群和行动建议，让用户知道下一步怎么判断。",
    scenePreference: ["room", "facility", "exterior", "lobby", "atmosphere", "other"],
    strength: "soft",
    buildSpokenText: () => "所以你要的是周边轻度假，又带孩子，重点就看日期和房型，合适就可以下手。",
  },
];

function nowIso(now?: string) {
  return now ?? new Date().toISOString();
}

function compactText(value: string | null | undefined, fallback = "") {
  return String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, limit: number) {
  const compact = compactText(value);
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function buildNarrationHintFromBeat(beat: Pick<RealPhotoNarrationBeat, "title" | "intent" | "phase">) {
  const source = compactText(beat.title || beat.intent || beat.phase);
  return Array.from(source).slice(0, 15).join("");
}

function normalizeTags(tags: string[] | null | undefined) {
  return Array.from(new Set((tags ?? []).map((tag) => compactText(tag)).filter(Boolean))).slice(0, 8);
}

function normalizePriority(asset: TaskHotelAssetRecord, index: number): RealPhotoMaterialPriority {
  if (asset.isHeroCandidate || index === 0) {
    return "hero";
  }
  if (asset.commercialScore >= 75 || asset.qualityScore >= 80) {
    return "core";
  }
  if (asset.canDirectI2V) {
    return "support";
  }
  return "backup";
}

function buildAssetRecommendedRole(asset: TaskHotelAssetRecord) {
  const roleByScene: Partial<Record<HotelAssetSceneType, string>> = {
    exterior: "开篇建立第一眼和地点感",
    lobby: "承接到达感和服务氛围",
    room: "证明住宿体验和适合人群",
    bathroom: "补充房间细节可信度",
    dining: "证明餐饮和一价全包价值",
    food: "做套餐价值和细节特写",
    facility: "证明活动、亲子和体验丰富度",
    neighborhood: "补充周边位置与出行理由",
    service_detail: "补充服务细节和安心感",
    atmosphere: "制造情绪和节奏过渡",
    other: "作为补充镜头使用",
  };
  return roleByScene[asset.sceneType] ?? roleByScene.other ?? "作为补充镜头使用";
}

function summarizeSourceProduct(source: VideoTaskSource) {
  return truncateText(
    [source.productInfoTitle, source.productInfoSnapshot].map((item) => compactText(item)).filter(Boolean).join("："),
    220,
  );
}

function summarizeUserIntent(source: VideoTaskSource) {
  return truncateText(
    [source.userPrompt, source.optimizedUserPrompt].map((item) => compactText(item)).filter(Boolean).join(" / "),
    220,
  );
}

function summarizeTemplate(source: VideoTaskSource) {
  return truncateText(
    [source.videoMaterialName, source.videoTemplatePrompt].map((item) => compactText(item)).filter(Boolean).join("："),
    220,
  );
}

export function buildRealPhotoMaterialBrief(input: BuildRealPhotoMaterialBriefInput): RealPhotoMaterialBrief {
  const assets = (input.hotelAssets ?? [])
    .filter((asset) => asset.reviewStatus !== "rejected")
    .slice()
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      if (a.isHeroCandidate !== b.isHeroCandidate) {
        return a.isHeroCandidate ? -1 : 1;
      }
      return b.commercialScore + b.qualityScore - (a.commercialScore + a.qualityScore);
    });

  const items: RealPhotoMaterialBriefItem[] = assets.map((asset, index) => ({
    assetId: asset.assetId,
    displayName: asset.displayName || asset.fileName || asset.assetId,
    sourceType: asset.sourceType,
    sceneType: asset.sceneType,
    subjectSummary: compactText(asset.subjectSummary || asset.displayName || asset.fileName),
    tags: normalizeTags(asset.tags),
    originalUserIntent: compactText(asset.userNote),
    analysisSummary: truncateText(
      [asset.subjectSummary, asset.compositionType, normalizeTags(asset.tags).join("、")].filter(Boolean).join("；"),
      160,
    ),
    recommendedRole: buildAssetRecommendedRole(asset),
    priority: normalizePriority(asset, index),
    sortOrder: asset.sortOrder,
    qualityScore: asset.qualityScore,
    commercialScore: asset.commercialScore,
    fileUrl: asset.fileUrl,
    canDirectI2V: asset.canDirectI2V,
    needEnhancement: asset.needEnhancement,
    recommendedPosition: asset.recommendedPosition,
    sellingPoints: asset.sellingPoints,
    durationSuggestion: asset.durationSuggestion,
    compositionScore: asset.compositionScore,
    mustUse: asset.mustUse,
    forbidden: asset.forbidden,
  }));

  if (!items.length && input.source.videoMaterialId) {
    items.push({
      assetId: input.source.videoMaterialId,
      displayName: input.source.videoMaterialName ?? "参考拆解视频素材",
      sourceType: "video_material",
      sceneType: "other",
      subjectSummary: compactText(input.source.videoTemplatePrompt, "参考拆解视频素材"),
      tags: ["参考视频"],
      originalUserIntent: "用户选择的视频拆解素材",
      analysisSummary: truncateText(input.source.videoTemplatePrompt, 160),
      recommendedRole: "用于承接参考视频节奏和叙事结构",
      priority: "hero",
      sortOrder: 0,
      qualityScore: 80,
      commercialScore: 80,
      fileUrl: null,
      canDirectI2V: false,
      needEnhancement: false,
    });
  }

  const warnings: string[] = [];
  if (!items.length) {
    warnings.push("未找到可用实拍图片或视频拆解素材，后续会退回文字规划。");
  }

  return {
    version: 1,
    productSummary: summarizeSourceProduct(input.source),
    userIntentSummary: summarizeUserIntent(input.source),
    templateSummary: summarizeTemplate(input.source),
    items,
    warnings,
    generatedAt: nowIso(input.now),
  };
}

function getTargetBeatCount(input: BuildFallbackRealPhotoNarrationBlueprintInput) {
  const materialCount = getAssignableMaterialItems(input.materialBrief).length;
  const requested = Math.max(1, Math.round(input.parameters.video.storyShotCount || input.parameters.video.segmentCount || 5));
  if (materialCount > 0) {
    return Math.max(1, Math.min(phaseTemplates.length, requested, materialCount));
  }
  return Math.max(1, Math.min(phaseTemplates.length, requested));
}

function selectTemplatesForCount(count: number) {
  if (count >= phaseTemplates.length) {
    return phaseTemplates;
  }
  if (count === 4) {
    return [phaseTemplates[0], phaseTemplates[1], phaseTemplates[2], phaseTemplates[4]];
  }
  if (count === 3) {
    return [phaseTemplates[0], phaseTemplates[2], phaseTemplates[4]];
  }
  if (count === 2) {
    return [phaseTemplates[0], phaseTemplates[4]];
  }
  return [phaseTemplates[0]];
}

function materialMatchesScene(material: RealPhotoMaterialBriefItem, sceneTypes: HotelAssetSceneType[]) {
  return material.sceneType ? sceneTypes.includes(material.sceneType) : false;
}

function getAssignableMaterialItems(materialBrief: RealPhotoMaterialBrief) {
  return materialBrief.items.filter((item) => !item.forbidden);
}

function chooseMaterialForTemplate(
  template: PhaseTemplate,
  materialBrief: RealPhotoMaterialBrief,
  usedMaterialIds: Set<string>,
) {
  const assignable = getAssignableMaterialItems(materialBrief);
  const unused = assignable.filter((item) => !usedMaterialIds.has(item.assetId));
  const preferredMustUse = unused.find((item) => item.mustUse && materialMatchesScene(item, template.scenePreference));
  if (preferredMustUse) {
    return preferredMustUse;
  }
  const anyMustUse = unused.find((item) => item.mustUse);
  if (anyMustUse) {
    return anyMustUse;
  }
  const preferred = unused.find((item) => materialMatchesScene(item, template.scenePreference));
  if (preferred) {
    return preferred;
  }
  return unused[0] ?? assignable.find((item) => materialMatchesScene(item, template.scenePreference)) ?? null;
}

function estimateBeatDurationSeconds(text: string) {
  const estimated = estimateNarrationReadingSeconds(text);
  const rounded = Math.round(Math.max(2.8, estimated) * 10) / 10;
  return Math.min(12, rounded);
}

function buildBeatId(index: number, phase: RealPhotoNarrationPhase) {
  return `real-photo-beat-${index + 1}-${phase.replace(/_/g, "-")}`;
}

function isRealPhotoNarrationPhase(value: unknown): value is RealPhotoNarrationPhase {
  return (
    value === "opening_hook" ||
    value === "context_setup" ||
    value === "material_evidence" ||
    value === "offer_value" ||
    value === "action_close"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => readString(item)).filter(Boolean) : [];
}

function buildTextContext(source: VideoTaskSource, materialBrief: RealPhotoMaterialBrief): RealPhotoNarrationTextContext {
  const productTitle = compactText(source.productInfoTitle, "这家店");
  const topMaterial = getAssignableMaterialItems(materialBrief)
    .slice(0, 4)
    .map((item) => item.subjectSummary)
    .filter(Boolean)
    .join("、");

  return {
    productTitle,
    productSummary: materialBrief.productSummary,
    userIntent: materialBrief.userIntentSummary,
    templateSummary: materialBrief.templateSummary,
    materialSummary: topMaterial,
  };
}

export function buildFallbackRealPhotoNarrationBlueprint(
  input: BuildFallbackRealPhotoNarrationBlueprintInput,
): RealPhotoNarrationBlueprint {
  const count = getTargetBeatCount(input);
  const templates = selectTemplatesForCount(count);
  const usedMaterialIds = new Set<string>();
  const textContext = buildTextContext(input.source, input.materialBrief);

  const beats = templates.map<RealPhotoNarrationBeat>((template, index) => {
    const material = chooseMaterialForTemplate(template, input.materialBrief, usedMaterialIds);
    if (material) {
      usedMaterialIds.add(material.assetId);
    }

    const spokenText = sanitizeNarrationText(
      normalizeNarrationSpokenText(template.buildSpokenText(textContext), {
        stripLeadingDayPrefix: true,
        removeTerminalOh: true,
      }),
      {
        stripLeadingDayPrefix: true,
        removeTerminalOh: true,
      },
    );
    const subtitleText = spokenText;

    return {
      beatId: buildBeatId(index, template.phase),
      phase: template.phase,
      title: template.title,
      intent: template.intent,
      spokenText,
      subtitleText,
      estimatedDurationSeconds: estimateBeatDurationSeconds(spokenText),
      targetMaterialIds: material ? [material.assetId] : [],
      materialReason: material
        ? `${material.displayName}：${material.originalUserIntent || material.recommendedRole}`
        : "没有可用实拍素材，需后续人工补充或使用兜底画面。",
      structureStrength: template.strength,
    };
  });

  return {
    version: 1,
    structureInfluenceScore: 60,
    narrativeSummary: "先用真实问题制造停留，再用实拍素材证明体验，最后自然落到套餐价值和购买判断。",
    speakingStyle: "像短视频探店博主自然讲述，允许口语停顿，但不堆形容词、不硬塞卖点。",
    targetAudience: textContext.productSummary.includes("亲子") || textContext.userIntent.includes("亲子") ? "亲子度假用户" : "正在做消费决策的潜在用户",
    coreQuestion: "这个产品到底适不适合我，现在下手值不值？",
    beats,
    totalEstimatedDurationSeconds: Math.round(beats.reduce((sum, beat) => sum + beat.estimatedDurationSeconds, 0) * 10) / 10,
    materialStrategy: "每个镜头优先绑定一个最能证明当前台词的实拍素材，素材不足时减少镜头而不是一张图反复硬拆。",
    warnings: [
      ...input.materialBrief.warnings,
      ...input.materialBrief.items
        .filter((item) => item.forbidden)
        .map((item) => `${item.displayName} 已被用户标记为禁止使用，兜底镜头规划不会分配这张图。`),
    ],
    generatedAt: nowIso(input.now),
  };
}

function applyMaterialPreferenceRules(input: {
  beats: RealPhotoNarrationBeat[];
  materialBrief: RealPhotoMaterialBrief;
}): { beats: RealPhotoNarrationBeat[]; warnings: string[] } {
  const forbiddenIds = new Set(input.materialBrief.items.filter((item) => item.forbidden).map((item) => item.assetId));
  const mustUseIds = input.materialBrief.items
    .filter((item) => item.mustUse && !item.forbidden)
    .map((item) => item.assetId);
  const warnings: string[] = [];

  const sanitizedBeats = input.beats.map((beat) => {
    const targetMaterialIds = beat.targetMaterialIds.filter((assetId) => !forbiddenIds.has(assetId));
    return targetMaterialIds.length === beat.targetMaterialIds.length
      ? { ...beat, targetMaterialIds: [...beat.targetMaterialIds] }
      : { ...beat, targetMaterialIds };
  });

  for (const forbiddenId of forbiddenIds) {
    if (input.beats.some((beat) => beat.targetMaterialIds.includes(forbiddenId))) {
      warnings.push(`素材 ${forbiddenId} 被用户标记为禁止使用，已从镜头绑定中移除。`);
    }
  }

  const usedIds = new Set(sanitizedBeats.flatMap((beat) => beat.targetMaterialIds));
  const missedMustUseIds = mustUseIds.filter((assetId) => !usedIds.has(assetId));
  for (const assetId of missedMustUseIds) {
    const targetBeat =
      sanitizedBeats.find((beat) => !beat.targetMaterialIds.length) ??
      sanitizedBeats.find((beat) => !beat.targetMaterialIds.some((targetId) => mustUseIds.includes(targetId))) ??
      null;
    if (!targetBeat) {
      warnings.push(`素材 ${assetId} 被用户标记为必须使用，但当前没有可分配镜头，请增加镜头数或调整素材标记。`);
      continue;
    }
    targetBeat.targetMaterialIds = [assetId, ...targetBeat.targetMaterialIds.filter((targetId) => targetId !== assetId)].slice(
      0,
      3,
    );
    warnings.push(`素材 ${assetId} 被用户标记为必须使用，已优先分配到 ${targetBeat.title}。`);
  }

  return { beats: sanitizedBeats, warnings };
}

export function normalizeRealPhotoNarrationBlueprintCandidate(
  input: NormalizeRealPhotoNarrationBlueprintCandidateInput,
): RealPhotoNarrationBlueprint {
  const candidate = asRecord(input.candidate);
  if (!candidate) {
    return input.fallback;
  }

  const candidateBeats = Array.isArray(candidate.beats)
    ? candidate.beats.map(asRecord).filter((beat): beat is Record<string, unknown> => Boolean(beat))
    : [];
  if (!candidateBeats.length) {
    return input.fallback;
  }

  const allowedMaterialIds = new Set(input.materialBrief.items.map((item) => item.assetId));
  const forbiddenMaterialIds = new Set(input.materialBrief.items.filter((item) => item.forbidden).map((item) => item.assetId));
  const candidateByPhase = new Map<RealPhotoNarrationPhase, Record<string, unknown>>();
  const candidateByIndex = new Map<number, Record<string, unknown>>();

  candidateBeats.forEach((beat, index) => {
    const phase = beat ? beat.phase : null;
    if (isRealPhotoNarrationPhase(phase)) {
      candidateByPhase.set(phase, beat);
    }
    if (beat) {
      candidateByIndex.set(index, beat);
    }
  });

  const beats = input.fallback.beats.map<RealPhotoNarrationBeat>((fallbackBeat, index) => {
    const candidateBeat = candidateByPhase.get(fallbackBeat.phase) ?? candidateByIndex.get(index) ?? null;
    if (!candidateBeat) {
      return fallbackBeat;
    }

    const spokenText =
      sanitizeNarrationText(
        normalizeNarrationSpokenText(readString(candidateBeat.spokenText), {
          stripLeadingDayPrefix: true,
          removeTerminalOh: true,
        }),
        {
          stripLeadingDayPrefix: true,
          removeTerminalOh: true,
        },
      ) || fallbackBeat.spokenText;
    const subtitleText = spokenText;
    const targetMaterialIds = readStringArray(candidateBeat.targetMaterialIds).filter(
      (assetId) => allowedMaterialIds.has(assetId) && !forbiddenMaterialIds.has(assetId),
    );

    return {
      ...fallbackBeat,
      title: readString(candidateBeat.title) || fallbackBeat.title,
      intent: readString(candidateBeat.intent) || fallbackBeat.intent,
      spokenText,
      subtitleText,
      estimatedDurationSeconds: estimateBeatDurationSeconds(spokenText),
      targetMaterialIds: targetMaterialIds.length ? targetMaterialIds.slice(0, 3) : fallbackBeat.targetMaterialIds,
      materialReason: readString(candidateBeat.materialReason) || fallbackBeat.materialReason,
    };
  });

  const preferenceResult = applyMaterialPreferenceRules({
    beats,
    materialBrief: input.materialBrief,
  });

  return {
    ...input.fallback,
    structureInfluenceScore: 60,
    narrativeSummary: readString(candidate.narrativeSummary) || input.fallback.narrativeSummary,
    speakingStyle: readString(candidate.speakingStyle) || input.fallback.speakingStyle,
    targetAudience: readString(candidate.targetAudience) || input.fallback.targetAudience,
    coreQuestion: readString(candidate.coreQuestion) || input.fallback.coreQuestion,
    beats: preferenceResult.beats,
    totalEstimatedDurationSeconds:
      Math.round(preferenceResult.beats.reduce((sum, beat) => sum + beat.estimatedDurationSeconds, 0) * 10) / 10,
    materialStrategy: readString(candidate.materialStrategy) || input.fallback.materialStrategy,
    warnings: [...input.fallback.warnings, ...preferenceResult.warnings],
    generatedAt: nowIso(input.now),
  };
}

function mapPhaseToCommercialPhase(phase: RealPhotoNarrationPhase): CommercialBeatPhase {
  switch (phase) {
    case "opening_hook":
      return "attention_hook";
    case "context_setup":
      return "identity_confirmation";
    case "material_evidence":
      return "evidence_proof";
    case "offer_value":
      return "value_anchor";
    case "action_close":
      return "action_close";
  }
}

function mapSourceTrace(sourceType: RealPhotoMaterialBriefItem["sourceType"] | null | undefined): ShotSourceTrace | null {
  switch (sourceType) {
    case "user_upload":
      return "user_photo";
    case "enhanced":
      return "enhanced_from_user_photo";
    case "video_material":
    case "user_video":
      return "reference_video_keyframe";
    case "ai_generated":
      return "ai_generated";
    default:
      return null;
  }
}

function mapAssetSourceType(sourceType: RealPhotoMaterialBriefItem["sourceType"] | null | undefined): VideoTaskAssetSourceType | null {
  switch (sourceType) {
    case "user_upload":
    case "enhanced":
    case "ai_generated":
    case "video_material":
      return sourceType;
    default:
      return null;
  }
}

function computeShotRollSeconds(input: {
  phase: RealPhotoNarrationPhase;
  index: number;
  totalCount: number;
}): { preRollSeconds: number; postRollSeconds: number } {
  if (input.totalCount <= 1) {
    return { preRollSeconds: 0.5, postRollSeconds: 0.5 };
  }
  if (input.index === 0) {
    return { preRollSeconds: 0.8, postRollSeconds: 0.3 };
  }
  if (input.index === input.totalCount - 1) {
    return { preRollSeconds: 0.3, postRollSeconds: 0.8 };
  }
  return { preRollSeconds: 0.3, postRollSeconds: 0.3 };
}

function decideFallbackNeed(
  material: RealPhotoMaterialBriefItem | null,
): { needsAiFallback: boolean; fallbackReason: string | null } {
  if (!material) {
    return { needsAiFallback: true, fallbackReason: "该镜头没有匹配到可用的用户上传素材" };
  }
  if (material.forbidden) {
    return { needsAiFallback: true, fallbackReason: "用户已禁止使用该素材" };
  }
  if (material.qualityScore < 30) {
    return { needsAiFallback: true, fallbackReason: `素材质量评分过低（${material.qualityScore}/100）` };
  }
  if (!material.canDirectI2V && !material.needEnhancement) {
    return { needsAiFallback: true, fallbackReason: "素材不适合直接图生视频，且没有可用增强路径" };
  }
  return { needsAiFallback: false, fallbackReason: null };
}

function buildShotFromBeat(input: {
  beat: RealPhotoNarrationBeat;
  index: number;
  material: RealPhotoMaterialBriefItem | null;
  parameters: VideoTaskParameterBundle;
  startAtSeconds: number;
  totalCount: number;
}): ShotPlanItem {
  const shotIndex = input.index + 1;
  const material = input.material;
  const durationSeconds = input.beat.estimatedDurationSeconds;
  const sceneSummary = material?.subjectSummary || input.beat.title;
  const location = material?.sceneType ? `${material.sceneType}` : "实拍素材";
  const primaryAssetId = material?.assetId ?? input.beat.targetMaterialIds[0] ?? null;
  const backupAssetIds = input.beat.targetMaterialIds.filter((assetId) => assetId !== primaryAssetId);
  const { needsAiFallback, fallbackReason } = decideFallbackNeed(material);
  const generationMode = needsAiFallback
    ? "ai_generated_broll"
    : material?.needEnhancement
      ? "photo_enhanced_i2v"
      : "photo_direct_i2v";
  const resolvedTargetMaterialIds = needsAiFallback ? [] : input.beat.targetMaterialIds;
  const resolvedBackupAssetIds = needsAiFallback ? [] : backupAssetIds;

  return {
    shotId: `shot-${shotIndex}`,
    shotIndex,
    segmentId: `segment-${shotIndex}`,
    segmentIndex: shotIndex,
    sceneType: material?.sceneType ?? "other",
    purpose: input.beat.intent,
    location,
    hasCharacters: false,
    characters: [],
    hasTalent: false,
    talentCaptureMode: "none",
    hasVoice: input.parameters.video.generateAudio,
    hasSubtitle: input.parameters.audio.enableSubtitle,
    requiresLipSync: false,
    action: `${sceneSummary}，画面服务于台词“${input.beat.subtitleText}”。`,
    emotion: input.beat.phase === "opening_hook" ? "好奇、停留" : input.beat.phase === "action_close" ? "笃定、给建议" : "真实、松弛",
    cameraMovement: input.beat.phase === "material_evidence" ? "缓慢推进并保留细节" : "稳定轻推，避免炫技",
    durationSeconds,
    sceneDescription: material
      ? `${material.displayName}。${material.analysisSummary || material.recommendedRole}`
      : input.beat.intent,
    contentDescription: material?.analysisSummary ?? input.beat.intent,
    narrationHint: buildNarrationHintFromBeat(input.beat),
    startAtSeconds: input.startAtSeconds,
    endAtSeconds: Math.round((input.startAtSeconds + durationSeconds) * 10) / 10,
    functionTag: input.beat.phase,
    commercialPhase: mapPhaseToCommercialPhase(input.beat.phase),
    commercialIntent: input.beat.intent,
    evidenceTarget: material?.recommendedRole ?? input.beat.materialReason,
    conversionRole: input.beat.phase === "action_close" ? "close" : input.beat.phase === "offer_value" ? "value" : "attention",
    narrationBeatId: input.beat.beatId,
    narrationPhase: input.beat.phase,
    narrationIntent: input.beat.intent,
    sourceSpokenText: input.beat.spokenText,
    sourceSubtitleText: input.beat.subtitleText,
    narrationEstimatedDurationSeconds: input.beat.estimatedDurationSeconds,
    targetMaterialIds: resolvedTargetMaterialIds,
    shotScale: input.beat.phase === "offer_value" ? "medium/detail" : "medium",
    compositionHint: "保留用户上传图片的主体与真实意图，必要时只做轻度运动。",
    rhythmTag: input.beat.phase === "opening_hook" ? "hook" : input.beat.phase === "action_close" ? "close" : "proof",
    mood: input.beat.phase === "opening_hook" ? "带问题感" : "自然可信",
    sellingPointTags: [input.beat.phase, ...(material?.tags ?? [])].slice(0, 6),
    assetId: needsAiFallback ? null : primaryAssetId,
    backupAssetIds: resolvedBackupAssetIds,
    assetSourceType: needsAiFallback ? null : mapAssetSourceType(material?.sourceType),
    assetSubjectSummary: material?.subjectSummary ?? null,
    sourceMaterialId:
      !needsAiFallback && (material?.sourceType === "video_material" || material?.sourceType === "user_video")
        ? material.assetId
        : null,
    sourceStartAtSeconds: null,
    sourceEndAtSeconds: null,
    sourceTimeRangeLabel: null,
    referenceImageUrl: needsAiFallback ? null : (material?.fileUrl ?? null),
    generationMode,
    sourceTrace: needsAiFallback ? null : mapSourceTrace(material?.sourceType),
    needsAiFallback,
    fallbackReason,
    ...computeShotRollSeconds({ phase: input.beat.phase, index: input.index, totalCount: input.totalCount }),
    transitionType: "narration-led",
    negativePrompt: null,
    userOverride: false,
    needImageEnhancement: needsAiFallback ? false : (material?.needEnhancement ?? false),
    needImageToVideo: true,
    isAtmosphereInsert: input.beat.phase === "context_setup" && material?.priority === "support",
    img2imgPrompt: null,
    i2vPrompt: `${input.beat.spokenText} 画面只强化实拍素材中真实存在的内容，不凭空添加无关卖点。`,
    visual: {
      sceneSetting: sceneSummary,
      composition: "以用户素材主体为中心，保留原始取景意愿",
      keyDetails: material?.originalUserIntent || material?.recommendedRole || input.beat.intent,
    },
    cinematography: {
      shotType: "real-photo-i2v",
      rhythm: input.beat.phase === "opening_hook" ? "先停后进" : "顺着口播轻运动",
      infoDensity: input.beat.phase === "material_evidence" ? "中高" : "中",
    },
    structure: {
      phase: input.beat.phase,
      prevTransition: shotIndex === 1 ? "开场直接进入问题" : "承接上一句的用户判断",
      nextTransition: input.beat.phase === "action_close" ? "收束" : "自然引到下一个证据",
      transitionType: "narration-led",
    },
  };
}

function decideSubShotCount(beat: RealPhotoNarrationBeat): number {
  if (beat.targetMaterialIds.length <= 1) {
    return 1;
  }
  if (beat.estimatedDurationSeconds < 4) {
    return 1;
  }
  return Math.min(beat.targetMaterialIds.length, Math.floor(beat.estimatedDurationSeconds / 2.5), 3);
}

function distributeSubShotDurations(totalDuration: number, count: number): number[] {
  if (count <= 1) {
    return [totalDuration];
  }
  const firstRatio = count === 2 ? 0.55 : 0.4;
  const first = Math.round(totalDuration * firstRatio * 10) / 10;
  const remainderPerShot = Math.round(((totalDuration - first) / (count - 1)) * 10) / 10;
  const result = [first];
  for (let i = 1; i < count - 1; i++) {
    result.push(remainderPerShot);
  }
  result.push(Math.round((totalDuration - result.reduce((sum, d) => sum + d, 0)) * 10) / 10);
  return result;
}

function buildSubShotsFromBeat(input: {
  beat: RealPhotoNarrationBeat;
  beatIndex: number;
  materialById: Map<string, RealPhotoMaterialBriefItem>;
  parameters: VideoTaskParameterBundle;
  startAtSeconds: number;
  shotIndexOffset: number;
  totalBeatCount: number;
}): ShotPlanItem[] {
  const count = decideSubShotCount(input.beat);
  if (count <= 1) {
    const material =
      input.beat.targetMaterialIds.map((id) => input.materialById.get(id) ?? null).find(Boolean) ?? null;
    return [
      buildShotFromBeat({
        beat: input.beat,
        index: input.shotIndexOffset,
        material,
        parameters: input.parameters,
        startAtSeconds: input.startAtSeconds,
        totalCount: input.totalBeatCount,
      }),
    ];
  }

  const durations = distributeSubShotDurations(input.beat.estimatedDurationSeconds, count);
  const rolls = computeShotRollSeconds({
    phase: input.beat.phase,
    index: input.beatIndex,
    totalCount: input.totalBeatCount,
  });
  const result: ShotPlanItem[] = [];
  let cursor = input.startAtSeconds;

  for (let sub = 0; sub < count; sub++) {
    const materialId = input.beat.targetMaterialIds[sub];
    const material = materialId ? (input.materialById.get(materialId) ?? null) : null;
    const subDuration = durations[sub];

    if (sub === 0) {
      const shot = buildShotFromBeat({
        beat: { ...input.beat, estimatedDurationSeconds: subDuration },
        index: input.shotIndexOffset,
        material,
        parameters: input.parameters,
        startAtSeconds: Math.round(cursor * 10) / 10,
        totalCount: input.totalBeatCount,
      });
      shot.preRollSeconds = rolls.preRollSeconds;
      shot.postRollSeconds = 0;
      result.push(shot);
    } else {
      const primary = result[0];
      const { needsAiFallback, fallbackReason } = decideFallbackNeed(material);
      const shotIndex = input.shotIndexOffset + sub + 1;
      result.push({
        ...primary,
        shotId: `${primary.shotId}-sub-${sub + 1}`,
        shotIndex,
        durationSeconds: subDuration,
        startAtSeconds: Math.round(cursor * 10) / 10,
        endAtSeconds: Math.round((cursor + subDuration) * 10) / 10,
        hasVoice: false,
        hasSubtitle: false,
        sourceSpokenText: null,
        sourceSubtitleText: null,
        narrationEstimatedDurationSeconds: 0,
        assetId: needsAiFallback ? null : (material?.assetId ?? null),
        referenceImageUrl: needsAiFallback ? null : (material?.fileUrl ?? null),
        assetSourceType: needsAiFallback ? null : mapAssetSourceType(material?.sourceType),
        assetSubjectSummary: material?.subjectSummary ?? null,
        sourceTrace: needsAiFallback ? null : mapSourceTrace(material?.sourceType),
        targetMaterialIds: needsAiFallback ? [] : (materialId ? [materialId] : []),
        backupAssetIds: [],
        generationMode: needsAiFallback
          ? "ai_generated_broll"
          : material?.needEnhancement
            ? "photo_enhanced_i2v"
            : "photo_direct_i2v",
        needsAiFallback,
        fallbackReason,
        needImageEnhancement: needsAiFallback ? false : (material?.needEnhancement ?? false),
        preRollSeconds: 0,
        postRollSeconds: sub === count - 1 ? rolls.postRollSeconds : 0,
        userOverride: false,
      });
    }
    cursor += subDuration;
  }

  return result;
}

export function buildShotPlanFromRealPhotoNarrationBlueprint(
  input: BuildShotPlanFromRealPhotoNarrationBlueprintInput,
): ShotPlan {
  const materialById = new Map(input.materialBrief.items.map((item) => [item.assetId, item]));
  const totalCount = input.blueprint.beats.length;
  let cursor = 0;
  let shotIndexOffset = 0;
  const shots = input.blueprint.beats.flatMap((beat, beatIndex) => {
    const subShots = buildSubShotsFromBeat({
      beat,
      beatIndex,
      materialById,
      parameters: input.parameters,
      startAtSeconds: Math.round(cursor * 10) / 10,
      shotIndexOffset,
      totalBeatCount: totalCount,
    });
    for (const s of subShots) cursor += s.durationSeconds;
    shotIndexOffset += subShots.length;
    return subShots;
  });

  return {
    shots,
    globalStyle: "真实实拍素材驱动，先有真人表达，再让镜头服务台词和素材证据。",
    totalDurationSeconds: Math.round(shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) * 10) / 10,
    validationErrors: input.materialBrief.items.length ? [] : ["缺少实拍素材，镜头计划仅为文字兜底。"],
    realPhotoMaterialBrief: input.materialBrief,
    realPhotoNarrationBlueprint: input.blueprint,
  };
}

export function buildRealPhotoNarrationWorkflowFallback(input: {
  source: VideoTaskSource;
  parameters: VideoTaskParameterBundle;
  hotelAssets?: TaskHotelAssetRecord[];
  now?: string;
}): RealPhotoNarrationWorkflowFallback {
  const materialBrief = buildRealPhotoMaterialBrief({
    source: input.source,
    hotelAssets: input.hotelAssets,
    now: input.now,
  });
  const narrationBlueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: input.source,
    parameters: input.parameters,
    materialBrief,
    now: input.now,
  });
  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint: narrationBlueprint,
    materialBrief,
    parameters: input.parameters,
  });

  return {
    materialBrief,
    narrationBlueprint,
    shotPlan,
  };
}
