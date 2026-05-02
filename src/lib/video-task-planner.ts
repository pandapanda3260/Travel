import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import {
  formatNarrationScriptLines,
  getShotsForNarrationSegment,
  parseNarrationScriptLines,
  type NarrationScriptLine,
} from "./narration-script";
import type { ProgressCallback } from "./progress-stream";
import {
  countNarrationCharacters,
  estimateNarrationReadingSeconds,
  getNarrationEmergencyTrimCharacters,
  getNarrationLengthGuidance,
  getNarrationRepairTriggerCharacters,
  isNarrationClearlyOverDuration,
  sanitizeNarrationText,
  stripCodeFence,
  trimNarrationToCharacterLimit,
} from "./narration";
import {
  evaluateNarrationHumanizationTarget,
  NARRATION_HUMANIZATION_TARGET,
  scoreNarrationHumanization,
  shouldRewriteNarrationForHumanization,
} from "./narration-humanization-evaluator";
import {
  buildNarrationDeliveryStrategies,
  buildNarrationStandardsPromptBlock,
  inspectNarrationQuality,
} from "./narration-standards";
import {
  buildNarrationHumanizationRewriteSystemPrompt,
  buildNarrationPolishSystemPrompt,
  buildNarrationRepairSystemPrompt,
} from "./narration-prompt-library";
import { callTaskGenerationLlm, getTaskGenerationRuntime } from "./task-generation-runtime";
import {
  buildNarrationScriptFromSubtitlePlan,
  normalizeSubtitlePlanSource,
  syncNarrationScriptIntoSubtitlePlan,
  usesSegmentLevelSubtitleSource,
} from "./subtitle-plan-source";
import { extractBestJsonObject } from "./llm-json";
import { buildDirectorPlanFromTaskData, buildDraftBundleFromDirectorPlan } from "./video-task-director";
import { deriveVideoTaskStructure } from "./video-task-structure";
import { getVideoTypeCategoryPrompt, getVideoTypeAddonPrompt } from "./video-type-prompts";
import { WeightedProgressTracker } from "./weighted-progress-tracker";
import { applyHotelAssetPlanning } from "./hotel-shot-planner";
import { buildHotelCapturedMaterialContext } from "./hotel-shot-candidates";
import { buildTaskStoryboardPlan } from "./task-storyboard-plan";
import { buildCommercialStrategyPlan, buildCommercialStrategyPromptContext } from "./commercial-video-strategy";
import {
  applyAgencyGuideVoiceoverSparseCharacters,
  getAgencyGuideVoiceoverMaxCharacterShots,
} from "./agency-guide-voiceover-policy";
import {
  applyMainCharacterAppearancePolicy,
  getMainCharacterAppearancePolicy,
} from "./main-character-appearance-policy";
import {
  buildFallbackRealPhotoNarrationBlueprint,
  buildRealPhotoMaterialBrief,
  buildShotPlanFromRealPhotoNarrationBlueprint,
  normalizeRealPhotoNarrationBlueprintCandidate,
} from "./real-photo-narration-workflow";
import {
  getVideoTaskWorkflowKind,
  getVideoTaskTypeProfile,
  isHotelVideoType,
  usesCapturedMaterialFirstWorkflow,
  type ShotPlan,
  type ShotPlanItem,
  type TaskConstraints,
  type VideoTaskDirectorPlan,
  type VideoTaskDraftBundle,
  type VideoTaskParameterBundle,
  type VideoTaskSource,
  type VideoTaskVideoType,
} from "./video-task-schema";
import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import type { VideoMaterialRecord } from "./video-material-store";

function getImageOrientationLabel(size: string) {
  const [widthText, heightText] = size.split("x");
  const width = Number(widthText);
  const height = Number(heightText);

  if (!width || !height) {
    return "竖构图";
  }

  if (width === height) {
    return "方构图";
  }

  return width > height ? "横构图" : "竖构图";
}

function getPlannedStoryShotCount(parameters: VideoTaskParameterBundle) {
  return Math.max(1, parameters.video.storyShotCount || parameters.video.segmentCount);
}

function getPlannedTotalDurationSeconds(parameters: VideoTaskParameterBundle) {
  if (parameters.video.segmentMode === "hybrid_intro_plus_montage") {
    const introDuration = Math.max(
      1,
      parameters.video.introSegmentDurationSeconds ?? Math.min(3, parameters.video.durationSeconds),
    );
    if (parameters.video.segmentCount <= 1) {
      return introDuration;
    }
    return introDuration + Math.max(0, parameters.video.segmentCount - 1) * parameters.video.durationSeconds;
  }

  return parameters.video.segmentCount * parameters.video.durationSeconds;
}

function getPlannedStoryShotDurationSeconds(parameters: VideoTaskParameterBundle) {
  return Math.max(
    1,
    Number((getPlannedTotalDurationSeconds(parameters) / getPlannedStoryShotCount(parameters)).toFixed(2)),
  );
}

function roundToTimePrecision(value: number) {
  return Math.round(value * 100) / 100;
}

function parseOptionalTimeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timesMatch(left: number, right: number) {
  return Math.abs(left - right) <= 0.01;
}

function hasMaxTwoDecimalPlaces(value: number) {
  return Math.abs(value - roundToTimePrecision(value)) <= 1e-9;
}

function buildFallbackShotDurations(totalDurationSeconds: number, shotCount: number) {
  const safeShotCount = Math.max(1, shotCount);
  if (safeShotCount === 1) {
    return [roundToTimePrecision(totalDurationSeconds)];
  }

  const baseDuration = totalDurationSeconds / safeShotCount;
  const multipliers = [0.9, 1.08, 0.96, 1.12, 1, 0.94];
  const weightedDurations = Array.from(
    { length: safeShotCount },
    (_, index) => Math.max(0.8, baseDuration * multipliers[index % multipliers.length]),
  );
  const weightedTotal = weightedDurations.reduce((sum, duration) => sum + duration, 0);
  const scaledDurations = weightedDurations.map((duration) =>
    roundToTimePrecision((duration / weightedTotal) * totalDurationSeconds),
  );
  const diff = roundToTimePrecision(totalDurationSeconds - scaledDurations.reduce((sum, duration) => sum + duration, 0));
  const lastIndex = scaledDurations.length - 1;
  scaledDurations[lastIndex] = roundToTimePrecision(scaledDurations[lastIndex] + diff);

  if (scaledDurations.every((duration) => timesMatch(duration, scaledDurations[0] ?? duration))) {
    scaledDurations[0] = roundToTimePrecision(Math.max(0.8, scaledDurations[0] - 0.1));
    scaledDurations[lastIndex] = roundToTimePrecision(scaledDurations[lastIndex] + 0.1);
  }

  return scaledDurations;
}

function getPlannedNarrationSegmentDurationSeconds(parameters: VideoTaskParameterBundle, segmentIndex?: number | null) {
  if (parameters.video.segmentMode === "hybrid_intro_plus_montage" && (segmentIndex ?? 1) === 1) {
    return Math.max(1, parameters.video.introSegmentDurationSeconds ?? Math.min(3, parameters.video.durationSeconds));
  }

  return Math.max(1, parameters.video.durationSeconds);
}

function getPlannedNarrationReferenceDurationSeconds(
  parameters: VideoTaskParameterBundle,
  segmentIndex?: number | null,
) {
  return usesSegmentLevelSubtitleSource(parameters.video.videoType)
    ? getPlannedNarrationSegmentDurationSeconds(parameters, segmentIndex)
    : getPlannedStoryShotDurationSeconds(parameters);
}

function createDraftBundleProgressTracker(
  onProgress: ProgressCallback | undefined,
  parameters: VideoTaskParameterBundle,
) {
  if (!onProgress) {
    return null;
  }

  const storyShotCount = getPlannedStoryShotCount(parameters);
  const segmentCount = Math.max(1, parameters.video.segmentCount);
  const hasVoice = getVideoTaskTypeProfile(parameters.video.videoType).hasVoice;

  return new WeightedProgressTracker(
    onProgress,
    [
      {
        id: "skeleton",
        weight: 3.2 + storyShotCount * 0.22,
        estimatedMs: 7_200 + storyShotCount * 220,
      },
      { id: "repair_1", weight: 1.3, estimatedMs: 4_200 },
      { id: "repair_2", weight: 1.3, estimatedMs: 4_200 },
      {
        id: "visual_enrichment",
        weight: 1.8 + storyShotCount * 0.12,
        estimatedMs: 4_200 + storyShotCount * 130,
      },
      {
        id: "subject_enrichment",
        weight: 1.6 + storyShotCount * 0.1,
        estimatedMs: 4_000 + storyShotCount * 110,
      },
      {
        id: "subtitle_enrichment",
        weight: hasVoice ? 1.6 + segmentCount * 0.16 : 1.1,
        estimatedMs: hasVoice ? 3_900 + segmentCount * 170 : 2_600,
      },
      {
        id: "prompt_generation",
        weight: 2.3 + storyShotCount * 0.18,
        estimatedMs: 5_300 + storyShotCount * 160,
      },
      {
        id: "narration_polish",
        weight: hasVoice ? 1.7 + segmentCount * 0.14 : 0.9,
        estimatedMs: hasVoice ? 4_300 + segmentCount * 180 : 2_100,
      },
      {
        id: "narration_repair",
        weight: hasVoice ? 1.4 + segmentCount * 0.12 : 0.6,
        estimatedMs: hasVoice ? 3_700 + segmentCount * 170 : 1_400,
      },
      { id: "build_director_plan", weight: 0.9, estimatedMs: 800 },
    ],
    {
      step: "shot_plan",
      floorPercent: 2,
      capPercent: 99,
      tickMs: 400,
    },
  );
}

function getExpectedDurationRangeLabel(range: VideoTaskParameterBundle["video"]["expectedDurationRange"]) {
  switch (range) {
    case "25_35":
      return "25～35 秒";
    case "35_60":
      return "35～60 秒";
    case "15_25":
    default:
      return "15～25 秒";
  }
}

function buildSourceSummary(
  source: VideoTaskSource,
  parameters: VideoTaskParameterBundle,
  options?: {
    hotelAssets?: TaskHotelAssetRecord[];
    referenceVideoMaterial?: VideoMaterialRecord | null;
  },
) {
  const narrationGuidance = getNarrationLengthGuidance(getPlannedNarrationReferenceDurationSeconds(parameters));
  const videoTypeProfile = getVideoTaskTypeProfile(parameters.video.videoType);
  const templatePromptOnly = source.videoTemplatePrompt.trim() || null;
  const autoStructure = deriveVideoTaskStructure({
    source,
    videoType: parameters.video.videoType,
    expectedDurationRange: parameters.video.expectedDurationRange,
    requestedSegmentCount: parameters.video.segmentCount,
    requestedDurationSeconds: parameters.video.durationSeconds,
    requestedStoryShotsPerSegment: parameters.video.storyShotsPerSegment,
  });
  const capturedMaterialContext =
    isHotelVideoType(parameters.video.videoType) && usesCapturedMaterialFirstWorkflow(parameters.video.videoType)
      ? buildHotelCapturedMaterialContext({
          hotelAssets: options?.hotelAssets ?? [],
          referenceVideoMaterial: options?.referenceVideoMaterial ?? null,
          workflowKind: getVideoTaskWorkflowKind(parameters.video.videoType),
        })
      : null;

  return JSON.stringify(
    {
      productInfo: {
        title: source.productInfoTitle ?? "",
        snapshot: source.productInfoSnapshot,
      },
      videoType: {
        key: parameters.video.videoType,
        label: videoTypeProfile.label,
        description: videoTypeProfile.description,
      },
      userTypedPrompt: source.userPrompt,
      // 仅当用户选择模板时下发；镜头规划只应依据此字符串作为「视频模板提示词」
      videoTemplatePrompt: templatePromptOnly,
      imageParameters: {
        size: parameters.image.size,
        orientation: getImageOrientationLabel(parameters.image.size),
        guidanceScale: parameters.image.guidanceScale,
        watermark: parameters.image.watermark,
        seed: parameters.image.seed,
      },
      videoParameters: {
        mode: parameters.video.mode,
        segmentMode: parameters.video.segmentMode,
        expectedDurationRange: {
          key: parameters.video.expectedDurationRange,
          label: getExpectedDurationRangeLabel(parameters.video.expectedDurationRange),
        },
        segmentCount: parameters.video.segmentCount,
        storyShotCount: getPlannedStoryShotCount(parameters),
        storyShotsPerSegment: parameters.video.storyShotsPerSegment,
        durationSecondsPerSegment: parameters.video.durationSeconds,
        introSegmentDurationSeconds: parameters.video.introSegmentDurationSeconds,
        totalDurationSeconds: getPlannedTotalDurationSeconds(parameters),
        aspectRatio: parameters.video.aspectRatio,
        multiShot: parameters.video.multiShot,
        shotType: parameters.video.shotType,
        cameraControl: parameters.video.cameraControl,
        generateAudio: parameters.video.generateAudio,
        watermark: parameters.video.watermark,
        negativePrompt: parameters.video.negativePrompt,
      },
      audioParameters: {
        storyboardEnabled: parameters.audio.storyboardEnabled,
        narrationCharacterBudgetPerSegment: narrationGuidance,
      },
      structuralGuidance: {
        usedTravelGuideAutoStructure: autoStructure.usedTravelGuideAutoStructure,
        itineraryDayCount: autoStructure.itinerary.dayCount,
        itinerarySource: autoStructure.itinerary.source,
        segmentBlueprint: autoStructure.segmentBlueprint,
      },
      commercialStrategyGuidance: buildCommercialStrategyPromptContext(source, parameters.video.videoType),
      taskConstraints: {
        customRules: parameters.constraints.customRules ?? [],
        characterConsistency: parameters.constraints.characterConsistency ?? null,
        sceneConsistency: parameters.constraints.sceneConsistency ?? null,
        forbidEmptyShots: parameters.constraints.forbidEmptyShots ?? null,
        requirePeopleInEveryShot: parameters.constraints.requirePeopleInEveryShot ?? null,
      },
      systemPromptsNote:
        "镜头计划与提示词生成的系统提示词由服务端 constraint 预设与 constraint-prompt-store 注入，不在此 JSON 内展开全文。",
      automationNote:
        "输出片段数、规划镜头数、单片段时长等结构参数由视频类型与期望时长先自动推导，再作为上下文交给模型继续细化。",
      capturedMaterialContext,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Step 1: Shot Plan generation
// ---------------------------------------------------------------------------

function buildConstraintRules(constraints: TaskConstraints): string[] {
  const rules: string[] = [];

  if (constraints.peopleStructure) {
    const structureMap: Record<string, string> = {
      "2_adults_2_children": "2个大人 + 2个小孩（共4人）。大人和小孩的人数必须严格匹配，不能多也不能少。",
      "2_adults_1_child": "2个大人 + 1个小孩（共3人）。",
      "1_adult_2_children": "1个大人 + 2个小孩（共3人）。",
      "1_adult_1_child": "1个大人 + 1个小孩（共2人）。",
      couple: "2个成年人（共2人）。",
    };
    const desc = structureMap[constraints.peopleStructure] ?? constraints.peopleStructure;
    rules.push(
      `人物结构（强约束）：本视频中出镜人物固定为 ${desc} 每个有人物的镜头都必须严格遵守这个人数组合，绝对不能出现多余的人物，也不能少人。`,
    );
  }

  if (constraints.adultGenderRule === "one_male_one_female") {
    rules.push(
      "成人性别（强约束）：两个成年人必须是一男一女（father 和 mother），绝对禁止出现两个同性成年人。不能出现两位男士或两位女士并排的画面。",
    );
  }

  if (constraints.peopleStructure?.includes("children")) {
    rules.push(
      "儿童一致性（强约束）：小孩的性别、年龄段、身高比例必须在所有镜头中保持完全一致，不能在不同镜头中变成不同性别或不同年龄段的儿童。儿童的性别和年龄段应在第一个出现儿童的镜头中确定，后续所有镜头必须严格保持一致。如果用户提示词中指定了儿童的性别或年龄，必须按用户要求执行；如果没有特别指定，默认约4-8岁。",
    );
  }

  rules.push(
    "人物比例（强约束）：画面中人物的大小比例必须符合真实物理透视关系。中景人物不能比远景建筑还小，近景人物不能过大变形。大人和小孩之间的身高比例必须符合现实。",
  );
  rules.push(
    "人物行为（强约束）：不同人物之间的肢体接触和互动必须自然合理，禁止出现不合常理的亲密接触（如陌生人之间握手、拥抱等）。家庭成员之间的互动应温馨自然。",
  );

  if (constraints.requirePeopleInEveryShot) {
    rules.push("出镜约束：每个镜头必须有人物出镜，禁止纯空镜。");
  }

  if (constraints.forbidEmptyShots) {
    rules.push("空镜约束：禁止出现完全没有视觉主体的空镜。");
  }

  if (constraints.characterConsistency === "high") {
    rules.push(
      "人物一致性（高）：所有出现人物的镜头，人物外观（面容、发型、肤色）、年龄段、服装风格、身材比例必须保持完全一致，不能换人、不能变脸、不能变装。",
    );
  } else if (constraints.characterConsistency === "medium") {
    rules.push("人物一致性（中）：同一个角色在不同镜头中应保持可辨识的相似特征，包括性别、年龄段和整体外观。");
  }

  if (constraints.sceneConsistency === "high") {
    rules.push("场景一致性（高）：所有镜头保持统一的空间环境风格，不做大幅场景切换。");
  }

  for (const rule of constraints.customRules) {
    if (rule.trim()) {
      rules.push(`自定义约束：${rule.trim()}`);
    }
  }

  return rules;
}

function buildShotPlanSystemPrompt(constraints: TaskConstraints, videoType?: VideoTaskVideoType) {
  const resolvedType = videoType ?? "agency_guide_voiceover";
  const constraintRules = buildConstraintRules(constraints);
  const mainPrompt = getEffectiveConstraintPrompt("shot_plan");
  const categoryPrompt = getVideoTypeCategoryPrompt(resolvedType, "shot_plan");
  const addonPrompt = getVideoTypeAddonPrompt(resolvedType, "shot_plan");
  const capturedMaterialRules = usesCapturedMaterialFirstWorkflow(resolvedType)
    ? [
        "",
        "实拍素材优先工作流要求（必须严格遵守）：",
        "1. 先理解用户输入、商品/酒店信息、上传图片分析和参考视频分析，再决定叙事结构。",
        "2. 保留用户上传实拍素材的原始意愿：主体、空间关系、构图价值和备注不要被改写成泛泛的 AI 画面。",
        "3. 如果已有可用实拍图片，镜头数量不得超过可用实拍图片数量；允许一个镜头使用一张主图，图片多于镜头时按叙事价值筛选。",
        "4. 每个镜头都要说明画面承担的讲述功能，并尽量建立“图片/视频素材 -> 镜头 -> 台词字幕”的对应关系。",
        "5. 先判断商业打法：交易型种草、攻略路线型、品牌展示型或体验推荐型。交易型种草要按“停留钩子 -> 身份确认 -> 机会抛出 -> 核心利益 -> 权益轰炸 -> 价值锚定 -> 风险解除 -> 行动收口”推进。",
        "6. 酒店/本地生活交易型内容不是慢铺垫介绍。前 3 秒必须给地域/人群/强利益，前 8 秒必须讲清主体和机会；可以直接讲最大卖点，但不能散乱堆卖点。",
        "7. 每个镜头尽量输出 commercialPhase、commercialIntent、evidenceTarget、conversionRole：说明它在回答用户哪个决策问题、证明哪个利益点。",
        "8. 台词和字幕要像真实短视频推荐：短句、具体、有成交节奏；字幕文本必须与最终口播/音频逐字一致，禁止摘要、提炼、改写或省略。",
      ]
    : [];

  return [
    mainPrompt,
    categoryPrompt,
    addonPrompt,
    ...capturedMaterialRules,
    ...(constraintRules.length > 0
      ? ["", "本任务的专属约束（必须严格遵守）：", ...constraintRules.map((r, i) => `${i + 1}. ${r}`)]
      : []),
  ].join("\n");
}

function buildFallbackShotPlan(source: VideoTaskSource, parameters: VideoTaskParameterBundle): ShotPlan {
  const profile = getVideoTaskTypeProfile(parameters.video.videoType);
  const subject =
    source.productInfoTitle?.trim() ||
    source.userPrompt.trim().slice(0, 20) ||
    (source.videoMaterialName?.trim().slice(0, 24) ?? "") ||
    source.videoTemplatePrompt.trim().slice(0, 20) ||
    "目的地";
  const shotCount = getPlannedStoryShotCount(parameters);
  const totalDurationSeconds = getPlannedTotalDurationSeconds(parameters);
  const shotDurations = buildFallbackShotDurations(totalDurationSeconds, shotCount);
  const segmentCount = Math.max(1, parameters.video.segmentCount || 1);
  const shotsPerSegment = Math.max(1, parameters.video.storyShotsPerSegment || Math.ceil(shotCount / segmentCount));
  const commercialPlan = buildCommercialStrategyPlan({ source, videoType: parameters.video.videoType });
  const fallbackCommercialPhases = commercialPlan.beatPlan.map((beat) => beat.phase);
  const montageLike =
    parameters.video.segmentMode === "multi_shot_montage" ||
    parameters.video.segmentMode === "hybrid_intro_plus_montage";
  let nextStartAtSeconds = 0;
  const shots: ShotPlanItem[] = Array.from({ length: shotCount }, (_, i) => {
    const shotIndex = i + 1;
    const isFirst = i === 0;
    const isLast = i === shotCount - 1;
    const durationSeconds = shotDurations[i] ?? getPlannedStoryShotDurationSeconds(parameters);
    const startAtSeconds = roundToTimePrecision(nextStartAtSeconds);
    const endAtSeconds = roundToTimePrecision(startAtSeconds + durationSeconds);
    nextStartAtSeconds = endAtSeconds;
    const segmentIndex = Math.min(segmentCount, Math.floor(i / shotsPerSegment) + 1);
    const shouldVoice = profile.hasVoice
      ? !montageLike || shotCount <= 3 || isFirst || isLast || shotIndex % 2 === 1
      : false;
    const purpose = isFirst ? "hook" : isLast ? "closing" : shotIndex % 2 === 0 ? "detail" : "experience";
    const functionTag = isFirst ? "吸引" : isLast ? "转化" : purpose === "detail" ? "信息" : "情绪";
    const commercialPhase =
      fallbackCommercialPhases[Math.min(i, fallbackCommercialPhases.length - 1)] ??
      (isFirst ? "attention_hook" : isLast ? "action_close" : "evidence_proof");

    return {
      shotIndex,
      segmentIndex,
      segmentId: `segment-${segmentIndex}`,
      purpose,
      functionTag,
      sellingPointType: purpose === "detail" ? "服务" : "体验",
      location: subject,
      hasCharacters: false,
      characters: [],
      hasTalent: profile.hasTalent,
      talentCaptureMode: profile.talentCaptureMode,
      hasVoice: shouldVoice,
      hasSubtitle: profile.hasSubtitle ? shouldVoice : false,
      requiresLipSync: shouldVoice ? profile.requiresLipSync : false,
      action: isFirst ? "全景展示" : isLast ? "氛围收束" : "细节展示",
      emotion: isFirst ? "吸引好奇" : isLast ? "留下印象" : "沉浸体验",
      cameraMovement: "auto",
      startAtSeconds,
      endAtSeconds,
      durationSeconds,
      sceneDescription: isFirst
        ? `${subject}的全景画面，突出核心吸引力`
        : isLast
          ? `${subject}的收束画面，呼应开场`
          : `${subject}的体验细节`,
      commercialPhase,
      commercialIntent: commercialPlan.beatPlan.find((beat) => beat.phase === commercialPhase)?.goal ?? null,
      evidenceTarget: isFirst ? commercialPlan.coreHook : shouldVoice ? `${subject}的可感知理由` : null,
      conversionRole: isLast ? "用行动建议或记忆点收口" : null,
      narrationHint: shouldVoice
        ? isFirst
          ? "先把最想去的理由抛出来"
          : isLast
            ? "用一句话把记忆点和行动感收住"
            : shotIndex % 2 === 0
              ? "用更口语的方式补一句感受"
              : "突出当天最值得记住的体验"
        : "",
    };
  });

  return {
    shots,
    globalStyle: "真实旅行记录感，写实摄影风格",
    totalDurationSeconds,
    validationErrors: [],
  };
}

function applyVideoTypeShotPlanPolicy(plan: ShotPlan, videoType: VideoTaskVideoType) {
  const normalizedPlan = normalizeSubtitlePlanSource(plan, videoType);
  if (videoType === "agency_guide_voiceover") {
    return applyAgencyGuideVoiceoverSparseCharacters(normalizedPlan);
  }
  return normalizedPlan;
}

function parseShotPlanResponse(content: string, parameters: VideoTaskParameterBundle): ShotPlan | null {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as {
      globalStyle?: string;
      totalDurationSeconds?: number;
      styleConstraints?: Record<string, string>;
      reusableModules?: Record<string, string>;
      narrativeCurves?: Record<string, string>;
      subtitlePlan?: Array<{
        segmentIndex?: number;
        segmentId?: string;
        subtitles?: Array<{
          text?: string;
          startAtSeconds?: number;
          durationSeconds?: number;
          charCount?: number;
          coveredShotIndexes?: number[];
        }>;
      }>;
      shots?: Array<
        Partial<ShotPlanItem> & {
          visual?: Record<string, unknown>;
          subject?: Record<string, unknown>;
          cinematography?: Record<string, unknown>;
          structure?: Record<string, unknown>;
        }
      >;
    };

    if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
      return null;
    }

    const shots: ShotPlanItem[] = parsed.shots.map((raw, i) => ({
      shotIndex: raw.shotIndex ?? i + 1,
      segmentId: raw.segmentId ?? null,
      segmentIndex: raw.segmentIndex ?? null,
      purpose: raw.purpose ?? "experience",
      location: raw.location ?? "",
      hasCharacters: raw.hasCharacters ?? false,
      characters: Array.isArray(raw.characters) ? raw.characters : [],
      hasTalent: raw.hasTalent,
      talentCaptureMode: raw.talentCaptureMode,
      hasVoice: raw.hasVoice,
      hasSubtitle: raw.hasSubtitle,
      requiresLipSync: raw.requiresLipSync,
      action: raw.action ?? "",
      emotion: raw.emotion ?? "",
      cameraMovement: raw.cameraMovement ?? "auto",
      durationSeconds: Math.max(0.8, Number(raw.durationSeconds) || getPlannedStoryShotDurationSeconds(parameters)),
      sceneDescription: raw.sceneDescription ?? "",
      narrationHint: raw.narrationHint ?? "",
      startAtSeconds: parseOptionalTimeNumber(raw.startAtSeconds),
      endAtSeconds: parseOptionalTimeNumber(raw.endAtSeconds),
      functionTag: typeof raw.functionTag === "string" ? raw.functionTag : undefined,
      sellingPointType: typeof raw.sellingPointType === "string" ? raw.sellingPointType : undefined,
      commercialPhase:
        typeof raw.commercialPhase === "string"
          ? (raw.commercialPhase as ShotPlanItem["commercialPhase"])
          : null,
      commercialIntent: typeof raw.commercialIntent === "string" ? raw.commercialIntent : null,
      evidenceTarget: typeof raw.evidenceTarget === "string" ? raw.evidenceTarget : null,
      conversionRole: typeof raw.conversionRole === "string" ? raw.conversionRole : null,
      visual: raw.visual
        ? {
            sceneSetting: String(raw.visual.sceneSetting ?? ""),
            shotScale: String(raw.visual.shotScale ?? ""),
            wideContent: String(raw.visual.wideContent ?? ""),
            midContent: String(raw.visual.midContent ?? ""),
            closeContent: String(raw.visual.closeContent ?? ""),
            composition: String(raw.visual.composition ?? ""),
            colorTone: String(raw.visual.colorTone ?? ""),
            keyDetails: String(raw.visual.keyDetails ?? ""),
          }
        : undefined,
      subject: raw.subject
        ? {
            mainCharacterCount: Number(raw.subject.mainCharacterCount) || 0,
            mainCharacterGender: String(raw.subject.mainCharacterGender ?? ""),
            relationship: String(raw.subject.relationship ?? ""),
            clothing: String(raw.subject.clothing ?? ""),
            ageRange: String(raw.subject.ageRange ?? ""),
            features: String(raw.subject.features ?? ""),
            appearance: String(raw.subject.appearance ?? ""),
            style: String(raw.subject.style ?? ""),
            position: String(raw.subject.position ?? ""),
            extraCount: Number(raw.subject.extraCount) || 0,
            extraDistribution: String(raw.subject.extraDistribution ?? ""),
            extraScale: String(raw.subject.extraScale ?? ""),
          }
        : undefined,
      cinematography: raw.cinematography
        ? {
            shotType: String(raw.cinematography.shotType ?? ""),
            rhythm: String(raw.cinematography.rhythm ?? ""),
            infoDensity: String(raw.cinematography.infoDensity ?? ""),
            lighting: String(raw.cinematography.lighting ?? ""),
          }
        : undefined,
      structure: raw.structure
        ? {
            phase: String(raw.structure.phase ?? ""),
            prevTransition: String(raw.structure.prevTransition ?? ""),
            nextTransition: String(raw.structure.nextTransition ?? ""),
            transitionType: String(raw.structure.transitionType ?? ""),
          }
        : undefined,
    }));

    let computedStartTime = 0;
    for (const shot of shots) {
      if (shot.startAtSeconds == null) {
        shot.startAtSeconds = Math.round(computedStartTime * 100) / 100;
      }
      if (shot.endAtSeconds == null) {
        shot.endAtSeconds = Math.round((shot.startAtSeconds + shot.durationSeconds) * 100) / 100;
      }
      computedStartTime = shot.endAtSeconds;
    }

    const subtitlePlan = Array.isArray(parsed.subtitlePlan)
      ? parsed.subtitlePlan.map((seg) => ({
          segmentIndex: Number(seg.segmentIndex) || 0,
          segmentId: String(seg.segmentId ?? ""),
          subtitles: Array.isArray(seg.subtitles)
            ? seg.subtitles.map((sub) => ({
                text: String(sub.text ?? ""),
                startAtSeconds: Number(sub.startAtSeconds) || 0,
                durationSeconds: Number(sub.durationSeconds) || 0,
                charCount:
                  Number(sub.charCount) || String(sub.text ?? "").replace(/[^\u4e00-\u9fff\u3400-\u4dbf]/g, "").length,
                coveredShotIndexes: Array.isArray(sub.coveredShotIndexes) ? sub.coveredShotIndexes.map(Number) : [],
              }))
            : [],
        }))
      : undefined;

    return applyVideoTypeShotPlanPolicy(
      {
        shots,
        globalStyle: parsed.globalStyle?.trim() ?? "",
        totalDurationSeconds:
          Number(parsed.totalDurationSeconds) || shots.reduce((sum, s) => sum + s.durationSeconds, 0),
        validationErrors: [],
        styleConstraints: parsed.styleConstraints
          ? {
              style: String(parsed.styleConstraints.style ?? ""),
              videoType: String(parsed.styleConstraints.videoType ?? ""),
              forbidden: String(parsed.styleConstraints.forbidden ?? ""),
              realismLevel: String(parsed.styleConstraints.realismLevel ?? ""),
              styleConsistency: String(parsed.styleConstraints.styleConsistency ?? ""),
              characterConsistency: String(parsed.styleConstraints.characterConsistency ?? ""),
            }
          : undefined,
        reusableModules: parsed.reusableModules
          ? {
              characterSetting: String(parsed.reusableModules.characterSetting ?? ""),
              sceneSetting: String(parsed.reusableModules.sceneSetting ?? ""),
              actionTemplates: String(parsed.reusableModules.actionTemplates ?? ""),
              shotTemplates: String(parsed.reusableModules.shotTemplates ?? ""),
            }
          : undefined,
        narrativeCurves: parsed.narrativeCurves
          ? {
              openingStrategy: String(parsed.narrativeCurves.openingStrategy ?? ""),
              midStructure: String(parsed.narrativeCurves.midStructure ?? ""),
              closingStrategy: String(parsed.narrativeCurves.closingStrategy ?? ""),
              rhythmCurve: String(parsed.narrativeCurves.rhythmCurve ?? ""),
              emotionCurve: String(parsed.narrativeCurves.emotionCurve ?? ""),
              infoOrder: String(parsed.narrativeCurves.infoOrder ?? ""),
            }
          : undefined,
        subtitlePlan,
      },
      parameters.video.videoType,
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 2: Validation
// ---------------------------------------------------------------------------

const SHOT_PLAN_ALLOWED_PURPOSES = new Set(["hook", "experience", "detail", "transition", "closing"]);
const SHOT_PLAN_ALLOWED_FUNCTION_TAGS = new Set(["吸引", "信息", "情绪", "信任", "转化"]);
const SHOT_PLAN_SEGMENT_ID_PATTERN = /^segment-(\d+)$/;

/** 规则说明见 `system-rules-payload.ts`（与「系统规则」页同步维护）。 */
export function validateShotPlan(
  plan: ShotPlan,
  source: VideoTaskSource,
  parameters: VideoTaskParameterBundle,
): string[] {
  const errors: string[] = [];
  const expected = getPlannedStoryShotCount(parameters);
  const constraints = parameters.constraints;
  const profile = getVideoTaskTypeProfile(parameters.video.videoType);
  const sortedShots = [...plan.shots].sort((a, b) => a.shotIndex - b.shotIndex);

  if (plan.shots.length !== expected) {
    errors.push(`镜头数量应为 ${expected}，实际为 ${plan.shots.length}`);
  }

  if (!Number.isFinite(Number(plan.totalDurationSeconds)) || Number(plan.totalDurationSeconds) <= 0) {
    errors.push("totalDurationSeconds 必须是大于 0 的数字");
  } else if (!hasMaxTwoDecimalPlaces(Number(plan.totalDurationSeconds))) {
    errors.push("totalDurationSeconds 最多保留 2 位小数");
  }

  sortedShots.forEach((shot, index) => {
    const expectedShotIndex = index + 1;
    if (shot.shotIndex !== expectedShotIndex) {
      errors.push(`shotIndex 必须从 1 连续递增：第 ${expectedShotIndex} 个镜头实际为 ${shot.shotIndex}`);
    }
  });

  let expectedStartAtSeconds = 0;
  let durationTotal = 0;
  const normalizedDurations: number[] = [];
  const segmentIndexes: number[] = [];
  const closedSegmentIndexes = new Set<number>();
  const reportedReopenedSegmentIndexes = new Set<number>();
  let previousSegmentIndex: number | null = null;

  for (const shot of sortedShots) {
    const durationSeconds = Number(shot.durationSeconds);
    const startAtSeconds = Number(shot.startAtSeconds);
    const endAtSeconds = Number(shot.endAtSeconds);
    const shotLabel = `镜头 ${shot.shotIndex}`;

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      errors.push(`${shotLabel} durationSeconds 必须是大于 0 的数字`);
    } else {
      if (!hasMaxTwoDecimalPlaces(durationSeconds)) {
        errors.push(`${shotLabel} durationSeconds 最多保留 2 位小数`);
      }
      durationTotal += durationSeconds;
      normalizedDurations.push(roundToTimePrecision(durationSeconds));
    }

    if (!Number.isFinite(startAtSeconds)) {
      errors.push(`${shotLabel} startAtSeconds 必须是数字`);
    } else {
      if (!hasMaxTwoDecimalPlaces(startAtSeconds)) {
        errors.push(`${shotLabel} startAtSeconds 最多保留 2 位小数`);
      }
      if (shot.shotIndex === 1 && !timesMatch(startAtSeconds, 0)) {
        errors.push("第一个 shot.startAtSeconds 必须为 0");
      }
      if (!timesMatch(startAtSeconds, expectedStartAtSeconds)) {
        errors.push(`${shotLabel} startAtSeconds 必须等于上一个镜头的 endAtSeconds`);
      }
    }

    if (!Number.isFinite(endAtSeconds)) {
      errors.push(`${shotLabel} endAtSeconds 必须是数字`);
    } else {
      if (!hasMaxTwoDecimalPlaces(endAtSeconds)) {
        errors.push(`${shotLabel} endAtSeconds 最多保留 2 位小数`);
      }
      if (Number.isFinite(startAtSeconds) && Number.isFinite(durationSeconds)) {
        const expectedEndAtSeconds = roundToTimePrecision(startAtSeconds + durationSeconds);
        if (!timesMatch(endAtSeconds, expectedEndAtSeconds)) {
          errors.push(`${shotLabel} endAtSeconds 必须等于 startAtSeconds + durationSeconds`);
        }
      }
      expectedStartAtSeconds = endAtSeconds;
    }

    if (!SHOT_PLAN_ALLOWED_PURPOSES.has(String(shot.purpose ?? "").trim())) {
      errors.push(`${shotLabel} purpose 必须是 hook / experience / detail / transition / closing 之一`);
    }

    if (!shot.functionTag?.trim()) {
      errors.push(`${shotLabel} 缺少 functionTag`);
    } else if (!SHOT_PLAN_ALLOWED_FUNCTION_TAGS.has(shot.functionTag.trim())) {
      errors.push(`${shotLabel} functionTag 必须是 吸引 / 信息 / 情绪 / 信任 / 转化 之一`);
    }

    if (!shot.sellingPointType?.trim()) {
      errors.push(`${shotLabel} 缺少 sellingPointType`);
    }

    if (shot.segmentId || shot.segmentIndex != null) {
      const segmentId = String(shot.segmentId ?? "").trim();
      const segmentIndex = Number(shot.segmentIndex);
      const matchedSegmentId = segmentId.match(SHOT_PLAN_SEGMENT_ID_PATTERN);

      if (!matchedSegmentId) {
        errors.push(`${shotLabel} segmentId 必须符合 segment-N 格式`);
      }
      if (!Number.isInteger(segmentIndex) || segmentIndex < 1) {
        errors.push(`${shotLabel} segmentIndex 必须是从 1 开始的整数`);
      } else {
        segmentIndexes.push(segmentIndex);
        if (matchedSegmentId && Number(matchedSegmentId[1]) !== segmentIndex) {
          errors.push(`${shotLabel} segmentIndex 必须与 segmentId 的数字保持一致`);
        }
        if (previousSegmentIndex != null && previousSegmentIndex !== segmentIndex) {
          closedSegmentIndexes.add(previousSegmentIndex);
        }
        if (
          previousSegmentIndex !== segmentIndex &&
          closedSegmentIndexes.has(segmentIndex) &&
          !reportedReopenedSegmentIndexes.has(segmentIndex)
        ) {
          errors.push(`片段 ${segmentIndex} 的镜头必须连续排列，不能被其他片段打断后再次出现`);
          reportedReopenedSegmentIndexes.add(segmentIndex);
        }
        previousSegmentIndex = segmentIndex;
      }
    }

    if (!shot.hasCharacters && shot.characters.length > 0) {
      errors.push(`${shotLabel} hasCharacters=false 时 characters 必须为空数组`);
    }

    if (!shot.hasTalent && shot.talentCaptureMode && shot.talentCaptureMode !== "none") {
      errors.push(`${shotLabel} hasTalent=false 时 talentCaptureMode 必须为空或 none`);
    }

    if (shot.requiresLipSync && (!shot.hasTalent || !shot.hasVoice)) {
      errors.push(`${shotLabel} requiresLipSync=true 时必须同时 hasTalent=true 且 hasVoice=true`);
    }

    if (!shot.hasVoice && !shot.hasSubtitle && shot.narrationHint?.trim()) {
      errors.push(`${shotLabel} hasVoice=false 且 hasSubtitle=false 时 narrationHint 必须为空`);
    }

    if (shot.narrationHint?.trim() && countNarrationCharacters(shot.narrationHint) > 15) {
      errors.push(`${shotLabel} narrationHint 必须小于等于 15 个汉字`);
    }
  }

  const roundedDurationTotal = roundToTimePrecision(durationTotal);
  if (Number.isFinite(Number(plan.totalDurationSeconds)) && !timesMatch(Number(plan.totalDurationSeconds), roundedDurationTotal)) {
    errors.push("totalDurationSeconds 必须精确等于所有 shots.durationSeconds 之和");
  }

  if (
    normalizedDurations.length > 1 &&
    normalizedDurations.every((duration) => timesMatch(duration, normalizedDurations[0] ?? duration))
  ) {
    errors.push("durationSeconds 禁止全部相同，必须根据内容差异化设计");
  }

  if (segmentIndexes.length > 0) {
    const uniqueSegmentIndexes = [...new Set(segmentIndexes)].sort((a, b) => a - b);
    if (uniqueSegmentIndexes[0] !== 1) {
      errors.push("segmentIndex 必须从 1 开始");
    }
    uniqueSegmentIndexes.forEach((segmentIndex, index) => {
      const expectedSegmentIndex = index + 1;
      if (segmentIndex !== expectedSegmentIndex) {
        errors.push(`segmentIndex 必须连续递增：缺少 segment-${expectedSegmentIndex}`);
      }
    });
  }

  for (const shot of plan.shots) {
    if (!shot.sceneDescription?.trim()) {
      errors.push(`镜头 ${shot.shotIndex} 缺少 sceneDescription`);
    }

    if (
      profile.hasVoice &&
      parameters.video.segmentMode !== "single_speaking" &&
      parameters.video.segmentMode !== "single_action" &&
      (shot.hasVoice === undefined || shot.hasSubtitle === undefined)
    ) {
      errors.push(`镜头 ${shot.shotIndex} 缺少 hasVoice / hasSubtitle 标记`);
    }

    if ((shot.hasVoice || shot.hasSubtitle) && !shot.narrationHint?.trim()) {
      errors.push(`镜头 ${shot.shotIndex} 标记了口播/字幕，但 narrationHint 为空`);
    }

    if (constraints.requirePeopleInEveryShot && !shot.hasCharacters) {
      errors.push(`镜头 ${shot.shotIndex} 缺少人物出镜（当前约束要求每个镜头必须有人物）`);
    }
  }

  if (constraints.adultGenderRule === "one_male_one_female") {
    for (const shot of plan.shots) {
      if (!shot.hasCharacters || shot.characters.length === 0) {
        continue;
      }
      const adults = shot.characters.filter((c) => /father|mother|dad|mom|爸|妈|大人|adult/.test(c));
      if (adults.length >= 2) {
        const hasMale = adults.some((c) => /father|dad|爸/.test(c));
        const hasFemale = adults.some((c) => /mother|mom|妈/.test(c));
        if (!hasMale || !hasFemale) {
          errors.push(`镜头 ${shot.shotIndex} 有 ${adults.length} 个成年人但不是一男一女（需要 father + mother）`);
        }
      }
    }
  }

  if (constraints.characterConsistency === "high") {
    const allCharacterSets = plan.shots
      .filter((s) => s.hasCharacters && s.characters.length > 0)
      .map((s) => new Set(s.characters));
    if (allCharacterSets.length >= 2) {
      const union = new Set(allCharacterSets.flatMap((s) => [...s]));
      for (const shot of plan.shots) {
        if (!shot.hasCharacters) continue;
        for (const char of shot.characters) {
          if (!union.has(char)) {
            errors.push(`镜头 ${shot.shotIndex} 出现了未在其他镜头中定义的人物 "${char}"，高一致性要求人物稳定`);
          }
        }
      }
    }
  }

  if (parameters.video.videoType === "agency_guide_voiceover" && plan.shots.length > 0) {
    const characterShotCount = plan.shots.filter(
      (shot) => shot.hasCharacters || (shot.subject?.mainCharacterCount ?? 0) > 0,
    ).length;
    const maxCharacterShots = getAgencyGuideVoiceoverMaxCharacterShots(plan.shots.length);
    if (characterShotCount > maxCharacterShots) {
      errors.push(`空镜旁白类型的人物主体镜头过多：最多允许 ${maxCharacterShots} 个，当前为 ${characterShotCount} 个`);
    }
  }

  if (
    profile.hasVoice &&
    !isRealPhotoNarrationFirstPlan(plan, parameters) &&
    parameters.video.segmentMode !== "single_speaking" &&
    parameters.video.segmentMode !== "single_action" &&
    plan.shots.length >= 4
  ) {
    const voicedShots = plan.shots.filter((shot) => shot.hasVoice);
    if (voicedShots.length === plan.shots.length) {
      errors.push("旁白分布过密：混剪类视频不应该每个镜头都强行安排口播，至少保留 1 个纯画面镜头");
    }
    if (!(plan.shots[0]?.hasVoice ?? false)) {
      errors.push("开场镜头缺少钩子口播");
    }
    if (!(plan.shots[plan.shots.length - 1]?.hasVoice ?? false)) {
      errors.push("收尾镜头缺少总结口播");
    }

    let consecutiveVoicedCount = 0;
    for (const shot of plan.shots) {
      if (shot.hasVoice || shot.hasSubtitle) {
        consecutiveVoicedCount += 1;
      } else {
        consecutiveVoicedCount = 0;
      }
      if (consecutiveVoicedCount >= 4) {
        errors.push("口播连续镜头过多：混剪/攻略类视频连续 4 个镜头都在说话，容易显得密、吵、不自然");
        break;
      }
    }

    const detailOrTransitionShots = plan.shots.filter(
      (shot) => shot.purpose === "detail" || shot.purpose === "transition",
    );
    const voicedDetailOrTransitionCount = detailOrTransitionShots.filter(
      (shot) => shot.hasVoice || shot.hasSubtitle,
    ).length;
    if (
      detailOrTransitionShots.length >= 2 &&
      voicedDetailOrTransitionCount > Math.ceil(detailOrTransitionShots.length * 0.6)
    ) {
      errors.push("细节/转场镜头承担口播过多：这类镜头应该更多让画面自己说话");
    }

    const middleVoicedShots = plan.shots.slice(1, -1).filter((shot) => shot.hasVoice || shot.hasSubtitle);
    const middleHighlightShots = middleVoicedShots.filter((shot) => ["experience", "climax"].includes(shot.purpose));
    if (middleVoicedShots.length >= 3 && middleHighlightShots.length === 0) {
      errors.push("中段缺少重点句承载镜头：除了开头和收尾，中间也需要至少一个能抬情绪或提炼价值的口播镜头");
    }
  }

  if (usesCapturedMaterialFirstWorkflow(parameters.video.videoType)) {
    const commercialPlan = buildCommercialStrategyPlan({
      source,
      videoType: parameters.video.videoType,
      shotPlan: plan,
    });
    if (commercialPlan.strategyKind === "transaction_seed") {
      if (commercialPlan.score.hookScore < 12) {
        errors.push("交易型种草开场钩子偏弱：前 3 秒需要地域/人群/强利益中的至少两项");
      }
      if (commercialPlan.score.identityOpportunityScore < 12) {
        errors.push("交易型种草前 8 秒主体和机会不清晰：需要更早讲清品牌/地点/开业/促销/价格机会");
      }
      if (commercialPlan.score.totalScore < 58) {
        errors.push(`商业推进分偏低：当前 ${commercialPlan.score.totalScore}/100，需补足权益密度、素材证明或结尾转化`);
      }
    }
  }

  return errors;
}

function buildRepairPrompt(plan: ShotPlan, errors: string[]): string {
  return [
    "你上一次输出的镜头计划存在以下问题：",
    ...errors.map((e, i) => `${i + 1}. ${e}`),
    "",
    "请只修复上述问题，保持其他镜头的内容不变，重新输出完整的 JSON。",
    "",
    `当前的镜头计划：${JSON.stringify(plan, null, 2)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Step 3: Convert shot plan to draft bundle
// ---------------------------------------------------------------------------

function buildPromptGenerationSystemPrompt(parameters: VideoTaskParameterBundle) {
  const videoType = parameters.video.videoType;
  const mainPrompt = getEffectiveConstraintPrompt("prompt_generation");
  const categoryPrompt = getVideoTypeCategoryPrompt(videoType, "prompt_generation");
  const addonPrompt = getVideoTypeAddonPrompt(videoType, "prompt_generation");

  return [mainPrompt, categoryPrompt, addonPrompt, "", buildNarrationStandardsPromptBlock(videoType)].join("\n");
}

function buildPromptGenerationUserContent(
  plan: ShotPlan,
  parameters: VideoTaskParameterBundle,
  source: VideoTaskSource,
) {
  const normalizedPlan = normalizeSubtitlePlanSource(plan, parameters.video.videoType);
  const averageSegmentSubtitleDuration =
    normalizedPlan.subtitlePlan && normalizedPlan.subtitlePlan.length > 0
      ? normalizedPlan.subtitlePlan.reduce((sum, segment) => sum + (segment.subtitles[0]?.durationSeconds ?? 0), 0) /
        normalizedPlan.subtitlePlan.length
      : getPlannedNarrationReferenceDurationSeconds(parameters);
  const narrationGuidance = getNarrationLengthGuidance(
    usesSegmentLevelSubtitleSource(parameters.video.videoType)
      ? Math.max(1, Math.round(averageSegmentSubtitleDuration || parameters.video.durationSeconds))
      : getPlannedStoryShotDurationSeconds(parameters),
  );
  const voicedShots = normalizedPlan.shots.filter((shot) => shot.hasVoice || shot.hasSubtitle);
  const deliveryStrategyMap = new Map(
    buildNarrationDeliveryStrategies(
      normalizedPlan.shots.map((shot) => ({
        shotIndex: shot.shotIndex,
        purpose: shot.purpose,
        hasVoice: shot.hasVoice,
        hasSubtitle: shot.hasSubtitle,
        requiresLipSync: shot.requiresLipSync,
        hasTalent: shot.hasTalent,
        emotion: shot.emotion,
        durationSeconds: shot.durationSeconds,
      })),
      parameters.video.videoType,
    ).map((item) => [item.shotIndex, item]),
  );
  const segmentNarrationBudgets = usesSegmentLevelSubtitleSource(parameters.video.videoType)
    ? (normalizedPlan.subtitlePlan ?? []).map((segment) => {
        const segmentShots = normalizedPlan.shots.filter(
          (shot) =>
            (shot.segmentId && shot.segmentId === segment.segmentId) ||
            (!shot.segmentId && (shot.segmentIndex ?? shot.shotIndex) === segment.segmentIndex),
        );
        const durationSeconds =
          segment.subtitles[0]?.durationSeconds ||
          Number(segmentShots.reduce((sum, shot) => sum + Math.max(0.8, shot.durationSeconds || 0), 0).toFixed(2)) ||
          getPlannedNarrationSegmentDurationSeconds(parameters, segment.segmentIndex);
        const guidance = getNarrationLengthGuidance(durationSeconds);
        return {
          segmentIndex: segment.segmentIndex,
          segmentId: segment.segmentId,
          durationSeconds,
          referenceCharacterRange: [guidance.minCharacters, guidance.suggestedCharacters] as [number, number],
          referenceMaxCharacters: guidance.maxCharacters,
          coveredShotIndexes: segment.subtitles[0]?.coveredShotIndexes?.length
            ? segment.subtitles[0].coveredShotIndexes
            : segmentShots.map((shot) => shot.shotIndex),
        };
      })
    : Array.from(
        normalizedPlan.shots.reduce<
          Map<
            number,
            {
              segmentIndex: number;
              segmentId: string;
              durationSeconds: number;
              referenceCharacterRange: [number, number];
              referenceMaxCharacters: number;
              coveredShotIndexes: number[];
            }
          >
        >((map, shot) => {
          const segmentIndex = shot.segmentIndex ?? shot.shotIndex;
          const current = map.get(segmentIndex);
          const nextDuration = Number(
            ((current?.durationSeconds ?? 0) + Math.max(0.8, shot.durationSeconds || 0)).toFixed(2),
          );
          const guidance = getNarrationLengthGuidance(nextDuration);
          map.set(segmentIndex, {
            segmentIndex,
            segmentId: shot.segmentId ?? `segment-${segmentIndex}`,
            durationSeconds: nextDuration,
            referenceCharacterRange: [guidance.minCharacters, guidance.suggestedCharacters],
            referenceMaxCharacters: guidance.maxCharacters,
            coveredShotIndexes: [...(current?.coveredShotIndexes ?? []), shot.shotIndex],
          });
          return map;
        }, new Map()),
      ).map(([, item]) => item);
  const narrationExecutionNotes = usesSegmentLevelSubtitleSource(parameters.video.videoType)
    ? segmentNarrationBudgets.map((segmentBudget, index) => {
        const segmentShots = normalizedPlan.shots.filter(
          (shot) => (shot.segmentIndex ?? shot.shotIndex) === segmentBudget.segmentIndex,
        );
        const anchorShot = segmentShots[0] ?? null;
        return {
          segmentIndex: segmentBudget.segmentIndex,
          coveredShotIndexes: segmentBudget.coveredShotIndexes,
          durationSeconds: segmentBudget.durationSeconds,
          purpose: anchorShot?.purpose ?? "experience",
          emotion: anchorShot?.emotion ?? "",
          sceneDescription: segmentShots
            .map((shot) => shot.sceneDescription)
            .filter(Boolean)
            .join("；"),
          narrationHint: segmentShots
            .map((shot) => shot.narrationHint)
            .filter(Boolean)
            .join("；"),
          styleGoal: getNarrationStyleGoalForPurpose(anchorShot?.purpose ?? "experience"),
          transitionNeed: index > 0 ? "要和上一片段自然衔接" : "负责起势和钩子",
          nextShotRelation:
            index < segmentNarrationBudgets.length - 1
              ? `下一句需要顺着片段 ${segmentNarrationBudgets[index + 1]?.segmentIndex} 往下走`
              : "负责收束",
          deliveryStrategy: anchorShot?.shotIndex ? (deliveryStrategyMap.get(anchorShot.shotIndex) ?? null) : null,
        };
      })
    : voicedShots.map((shot, index) => ({
        shotIndex: shot.shotIndex,
        purpose: shot.purpose,
        durationSeconds: shot.durationSeconds,
        emotion: shot.emotion,
        styleGoal: getNarrationStyleGoalForPurpose(shot.purpose),
        transitionNeed: index > 0 ? "要考虑与上一句自然衔接" : "负责起势和钩子",
        nextShotRelation:
          index < voicedShots.length - 1
            ? `下一句需要顺着镜头 ${voicedShots[index + 1]?.shotIndex} 往下走`
            : "负责收束",
        deliveryStrategy: deliveryStrategyMap.get(shot.shotIndex) ?? null,
      }));

  return JSON.stringify(
    {
      narrationStyleBrief: buildNarrationStyleBrief(source, parameters.video.videoType, normalizedPlan),
      commercialPlan: buildCommercialStrategyPlan({
        source,
        videoType: parameters.video.videoType,
        shotPlan: normalizedPlan,
      }),
      shotPlan: normalizedPlan,
      structureBlueprint: deriveVideoTaskStructure({
        source,
        videoType: parameters.video.videoType,
        expectedDurationRange: parameters.video.expectedDurationRange,
        requestedSegmentCount: parameters.video.segmentCount,
        requestedDurationSeconds: parameters.video.durationSeconds,
        requestedStoryShotsPerSegment: parameters.video.storyShotsPerSegment,
      }).segmentBlueprint,
      imageOrientation: getImageOrientationLabel(parameters.image.size),
      imageSize: parameters.image.size,
      aspectRatio: parameters.video.aspectRatio,
      cameraControl: parameters.video.cameraControl,
      videoType: parameters.video.videoType,
      segmentMode: parameters.video.segmentMode,
      renderSegmentCount: parameters.video.segmentCount,
      plannedStoryShotCount: getPlannedStoryShotCount(parameters),
      narrationCharacterBudget: narrationGuidance,
      segmentNarrationBudgets,
      storyboardEnabled: parameters.audio.storyboardEnabled,
      characterAppearancePolicy: getMainCharacterAppearancePolicy(source),
      narrativeCurves: normalizedPlan.narrativeCurves ?? null,
      storyboardPlan: normalizedPlan.storyboard ?? null,
      narrationExecutionNotes,
    },
    null,
    2,
  );
}

function buildFallbackDraftBundleFromShotPlan(
  plan: ShotPlan,
  parameters: VideoTaskParameterBundle,
): VideoTaskDraftBundle {
  const orientation = getImageOrientationLabel(parameters.image.size);
  const normalizedPlan = normalizeSubtitlePlanSource(plan, parameters.video.videoType);

  const imageLines = normalizedPlan.shots
    .map((shot) => {
      if (shot.img2imgPrompt?.trim()) {
        return `镜头${shot.shotIndex}：${shot.img2imgPrompt.trim()}`;
      }
      const noCharacterRule =
        parameters.video.videoType === "agency_guide_voiceover"
          ? shot.hasCharacters || (shot.subject?.mainCharacterCount ?? 0) > 0
            ? "人物只在强相关体验场景中自然点缀，不抢景点主体，不成人像写真感"
            : "无主角人物出镜，不要正面人物主体，主体是景点、建筑、环境或设施本身"
          : "";
      return `镜头${shot.shotIndex}：${shot.sceneDescription}，${orientation}，写实摄影风格，电影级质感${noCharacterRule ? `，${noCharacterRule}` : ""}。no text, no letters, no words, no watermark, no collage, no split screen, single continuous image, realistic perspective and proportions。`;
    })
    .join("\n");

  const videoLines = normalizedPlan.shots
    .map(
      (shot) =>
        `镜头${shot.shotIndex}：${
          shot.i2vPrompt?.trim()
            ? shot.i2vPrompt.trim()
            : `${shot.action}，${shot.cameraMovement === "auto" ? "自然运镜" : shot.cameraMovement}，${shot.emotion}，${shot.durationSeconds}秒。`
        }`,
    )
    .join("\n");

  const narrationLines = usesSegmentLevelSubtitleSource(parameters.video.videoType)
    ? buildNarrationScriptFromSubtitlePlan(normalizedPlan, parameters.video.videoType)
    : normalizedPlan.shots
        .map(
          (shot) =>
            `镜头${shot.shotIndex}：${
              shot.hasVoice === false && shot.hasSubtitle === false
                ? ""
                : sanitizeNarrationText(shot.sourceSpokenText || shot.narrationHint)
            }`,
        )
        .join("\n");

  return {
    textToImagePrompt: imageLines,
    imageToVideoPrompt: videoLines,
    narrationScript: narrationLines,
  };
}

function buildFallbackDraftBundle(source: VideoTaskSource, parameters: VideoTaskParameterBundle): VideoTaskDraftBundle {
  const templatePrompt = source.videoTemplatePrompt.trim();
  const sourceText = [source.productInfoTitle, source.productInfoSnapshot, source.userPrompt, templatePrompt || null]
    .filter(Boolean)
    .join("，");
  const normalized = sourceText.trim() || "酒店住宿产品展示";
  const shotCount = getPlannedStoryShotCount(parameters);
  const shotDuration = getPlannedStoryShotDurationSeconds(parameters);
  const totalDurationSeconds = getPlannedTotalDurationSeconds(parameters);
  const narrationSubject = source.productInfoTitle?.trim() || "酒店亮点";
  const narrationLineCount = usesSegmentLevelSubtitleSource(parameters.video.videoType)
    ? Math.max(1, parameters.video.segmentCount)
    : shotCount;
  const narrationLabel = usesSegmentLevelSubtitleSource(parameters.video.videoType) ? "片段" : "镜头";
  const narrationLines = Array.from({ length: narrationLineCount }, (_, index) => {
    const isVoiced =
      narrationLineCount <= 3 || index === 0 || index === narrationLineCount - 1 || (index + 1) % 2 === 1;
    if (!isVoiced) {
      return `${narrationLabel}${index + 1}：`;
    }
    if (index === 0) {
      return `${narrationLabel}${index + 1}：先把${narrationSubject}最抓人的地方说出来`;
    }

    if (index === narrationLineCount - 1) {
      return `${narrationLabel}${index + 1}：最后把${narrationSubject}值得立刻出发的感觉收住`;
    }

    return `${narrationLabel}${index + 1}：把${narrationSubject}里最有画面感的一点讲清楚`;
  }).join("\n");

  return {
    textToImagePrompt: `${normalized}，${getImageOrientationLabel(parameters.image.size)}，高级感酒店宣传画面，空间通透，灯光柔和，突出客房环境、服务细节和度假氛围，主体清晰，构图适配${parameters.image.size}，写实摄影风格，电影级质感。`,
    imageToVideoPrompt: `${normalized}，输出${shotCount}个规划镜头，最终合成为${parameters.video.segmentCount}个片段，总时长约${totalDurationSeconds}秒，单镜头建议时长约${shotDuration}秒，画面比例${parameters.video.aspectRatio}，${parameters.video.multiShot ? "支持多镜头推进" : "以单镜头表达为主"}，运镜以${parameters.video.cameraControl}为主，节奏克制自然。`,
    narrationScript: narrationLines,
  };
}

// ---------------------------------------------------------------------------
// Step 3.5: Narration length repair
// ---------------------------------------------------------------------------

function getNarrationLineShots(line: NarrationScriptLine, shotPlan?: ShotPlan | null) {
  if (line.scope === "segment") {
    return getShotsForNarrationSegment(shotPlan, line.segmentIndex);
  }

  const targetShot = shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex) ?? null;
  return targetShot ? [targetShot] : [];
}

function getNarrationLineContext(line: NarrationScriptLine, shotPlan?: ShotPlan | null) {
  const relatedShots = getNarrationLineShots(line, shotPlan);
  const anchorShot = relatedShots[0] ?? shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex) ?? null;

  return {
    relatedShots,
    anchorShot,
    purpose: anchorShot?.purpose ?? "experience",
    location: Array.from(new Set(relatedShots.map((shot) => shot.location).filter(Boolean))).join("；"),
    emotion: anchorShot?.emotion ?? "",
    narrationHint: Array.from(new Set(relatedShots.map((shot) => shot.narrationHint).filter(Boolean))).join("；"),
    sceneDescription: Array.from(new Set(relatedShots.map((shot) => shot.sceneDescription).filter(Boolean))).join("；"),
    hasVoice:
      relatedShots.some((shot) => shot.hasVoice || shot.hasSubtitle) ||
      Boolean(anchorShot?.hasVoice || anchorShot?.hasSubtitle),
    hasSubtitle: relatedShots.some((shot) => shot.hasSubtitle) || Boolean(anchorShot?.hasSubtitle),
    requiresLipSync: relatedShots.some((shot) => shot.requiresLipSync) || Boolean(anchorShot?.requiresLipSync),
    hasTalent: relatedShots.some((shot) => shot.hasTalent) || Boolean(anchorShot?.hasTalent),
  };
}

function getFallbackNarrationText(line: NarrationScriptLine, shotPlan?: ShotPlan | null) {
  const context = getNarrationLineContext(line, shotPlan);
  return context.narrationHint || `${line.label}${line.index}亮点`;
}

/** 解说词超长时最多尝试缩写的轮数。 */
export const NARRATION_LENGTH_MAX_REPAIR_ROUNDS = 2;

const lowSignalNarrationPatterns = [
  /直接冲$/u,
  /太出片了$/u,
  /最值了$/u,
  /都逛完了$/u,
  /这样逛更省力$/u,
  /别乱订$/u,
  /直接抄作业/u,
  /这趟.+就值了/u,
  /顺路看/u,
  /照样轻松/u,
  /接得稳/u,
  /一落地就有人接/u,
  /快速住进.+休息/u,
  /看底蕴/u,
  /刚到门口就有度假感/u,
  /干净利落这一路线/u,
  /吃饭和遛娃都安排上了/u,
  /氛围也很放松/u,
  /整套体验都挺完整/u,
  /经典景点都逛到了/u,
];

function getNarrationDurationSecondsForShot(
  shotIndex: number,
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  const targetShot = shotPlan?.shots.find((shot) => shot.shotIndex === shotIndex) ?? null;
  if (targetShot && shotPlan?.shots?.length) {
    const segmentShots = shotPlan.shots.filter(
      (shot) =>
        (targetShot.segmentId && shot.segmentId === targetShot.segmentId) ||
        (!targetShot.segmentId && shot.segmentIndex != null && shot.segmentIndex === targetShot.segmentIndex),
    );
    const segmentDuration = segmentShots.reduce((sum, shot) => sum + Math.max(0, shot.durationSeconds || 0), 0);
    if (segmentDuration > 0) {
      return segmentDuration;
    }
    if (targetShot.durationSeconds > 0) {
      return targetShot.durationSeconds;
    }
  }

  return getPlannedNarrationReferenceDurationSeconds(parameters, targetShot?.segmentIndex ?? shotIndex);
}

function getNarrationLineDurationSeconds(
  line: NarrationScriptLine,
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  if (line.scope === "segment") {
    const segmentDuration = getShotsForNarrationSegment(shotPlan, line.segmentIndex).reduce(
      (sum, shot) => sum + Math.max(0, shot.durationSeconds || 0),
      0,
    );
    if (segmentDuration > 0) {
      return segmentDuration;
    }
  }

  return getNarrationDurationSecondsForShot(line.shotIndex, parameters, shotPlan);
}

function getNarrationStyleGoalForPurpose(purpose: string) {
  switch (purpose) {
    case "hook":
      return "快速抛出看点，建立继续看的兴趣";
    case "detail":
      return "聚焦一个具体亮点，少而准，不要把信息塞满";
    case "transition":
      return "负责承接和推进节奏，允许更轻、更短、更有留白";
    case "closing":
      return "收住价值和情绪，留下记忆点或行动感";
    case "climax":
      return "提气、拉情绪，把最有冲击力的一点说亮";
    case "experience":
    default:
      return "把当前镜头最值得说的体验、价值或感受讲清楚";
  }
}

type NarrationStyleSourceContext = Pick<
  VideoTaskSource,
  "productInfoTitle" | "productInfoSnapshot" | "userPrompt" | "videoTemplatePrompt"
>;

function inferNarrationAudience(source: NarrationStyleSourceContext, videoType: VideoTaskVideoType) {
  const context = [source.productInfoTitle, source.productInfoSnapshot, source.userPrompt, source.videoTemplatePrompt]
    .filter(Boolean)
    .join("\n");
  const audiences: string[] = [];

  if (/孩子|带娃|亲子|家庭|小朋友/u.test(context)) {
    audiences.push("带孩子或家庭出行的人");
  }
  if (/情侣|夫妻|约会|蜜月/u.test(context)) {
    audiences.push("情侣或夫妻客群");
  }
  if (/老人|父母|长辈|爸妈/u.test(context)) {
    audiences.push("带父母或长辈的人");
  }
  if (/商务|差旅|会议|通勤/u.test(context)) {
    audiences.push("商务差旅或高效率出行的人");
  }
  if (/学生|年轻|闺蜜|朋友|周末/u.test(context)) {
    audiences.push("年轻朋友或周末短途人群");
  }
  if (/采购|囤货|试吃|超市|卖场|选购/u.test(context)) {
    audiences.push("想高效选购和发现划算好物的人");
  }

  if (audiences.length > 0) {
    return Array.from(new Set(audiences)).join("、");
  }
  if (String(videoType).startsWith("hotel_")) {
    return "正在比较住宿体验、位置、服务和性价比的人";
  }
  if (String(videoType).startsWith("retail_")) {
    return "想知道有什么值得逛、怎么买更省心的人";
  }
  if (String(videoType).startsWith("agency_")) {
    return "想少踩坑、把路线和体验安排明白的人";
  }
  return "正在做选择、需要真实理由和体验感的人";
}

function buildNarrationStyleBrief(
  source: NarrationStyleSourceContext,
  videoType: VideoTaskVideoType,
  shotPlan?: ShotPlan | null,
) {
  const typeProfile = getVideoTaskTypeProfile(videoType);
  const hasVoiceOrSubtitle = shotPlan?.shots.some((shot) => shot.hasVoice || shot.hasSubtitle) ?? true;

  return {
    videoType,
    videoTypeLabel: typeProfile.label,
    appliesWhen: hasVoiceOrSubtitle
      ? "本视频存在台词/字幕，必须执行真人推荐标准"
      : "如本类型无台词/字幕，则 narrationScript 保持为空",
    likelyAudience: inferNarrationAudience(source, videoType),
    scriptMission: "写成真人在推荐一个具体选择：先建立对象感和判断，再给画面可验证的理由，最后自然收束到行动或记忆点。",
    trustEntryOptions: [
      "指出一个常见误区或选择坑",
      "先给明确判断，再补为什么",
      "用具体场景说明谁适合",
      "用画面细节证明体验或服务价值",
    ],
    valueProofChecklist: [
      "对象：这句话是在对谁说",
      "原因：为什么推荐或为什么这样安排",
      "证据：画面、动线、服务、空间、商品、体验里哪个细节能证明",
      "情绪：听起来是真实感受，不是广告口号",
    ],
    continuityGoal: "整条脚本要有开场钩子、中段理由、结尾收束的连续推进；不要让每个镜头像互不相关的宣传短句。",
    commercialPlan: buildCommercialStrategyPlan({ source, videoType, shotPlan }),
    lowQualitySignals: [
      "只说省心、轻松、舒服、值得，但没有原因",
      "只罗列地点、空间、商品或服务名",
      "直接抄作业、这趟就值了、顺路看、照样轻松、经典都逛到这类口号",
      "每句都像独立标题，前后没有承接",
    ],
    narrativeCurves: shotPlan?.narrativeCurves ?? null,
  };
}

async function polishNarrationScriptQuality(
  script: string,
  source: VideoTaskSource,
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  if (!shotPlan?.shots?.length) {
    return script;
  }

  const runtime = getTaskGenerationRuntime();
  if (!runtime.liveEnabled) {
    return script;
  }

  const parsedLines = parseNarrationScriptLines(script, shotPlan);
  if (parsedLines.length === 0) {
    return script;
  }

  const currentLineMap = new Map(
    parsedLines.map((line) => [
      line.shotIndex,
      sanitizeNarrationText(line.text, {
        stripLeadingDayPrefix: true,
      }),
    ]),
  );
  const voicedLines = parsedLines.filter((line) => {
    const context = getNarrationLineContext(line, shotPlan);
    return context.hasVoice || context.hasSubtitle;
  });
  if (voicedLines.length === 0) {
    return script;
  }

  try {
    const deliveryStrategyMap = new Map(
      buildNarrationDeliveryStrategies(
        voicedLines.map((line) => {
          const context = getNarrationLineContext(line, shotPlan);
          return {
            shotIndex: line.shotIndex,
            purpose: context.purpose,
            hasVoice: context.hasVoice,
            hasSubtitle: context.hasSubtitle,
            requiresLipSync: context.requiresLipSync,
            hasTalent: context.hasTalent,
            emotion: context.emotion,
            durationSeconds: getNarrationLineDurationSeconds(line, parameters, shotPlan),
          };
        }),
        parameters.video.videoType,
      ).map((item) => [item.shotIndex, item]),
    );
    const payload = {
      narrationStyleBrief: buildNarrationStyleBrief(source, parameters.video.videoType, shotPlan),
      sourceContext: {
        productTitle: source.productInfoTitle?.trim() || "",
        userPrompt: source.userPrompt.trim(),
        referenceTemplate: source.videoTemplatePrompt.trim().slice(0, 800),
        expectedDurationRange: getExpectedDurationRangeLabel(parameters.video.expectedDurationRange),
        videoType: parameters.video.videoType,
      },
      shots: voicedLines.map((line, index) => {
        const context = getNarrationLineContext(line, shotPlan);
        const durationSeconds = getNarrationLineDurationSeconds(line, parameters, shotPlan);
        const guidance = getNarrationLengthGuidance(durationSeconds);
        const previousVoicedLine = index > 0 ? voicedLines[index - 1] : null;
        const nextVoicedLine = index < voicedLines.length - 1 ? voicedLines[index + 1] : null;
        const previousContext = previousVoicedLine ? getNarrationLineContext(previousVoicedLine, shotPlan) : null;
        const nextContext = nextVoicedLine ? getNarrationLineContext(nextVoicedLine, shotPlan) : null;
        const previousText = previousVoicedLine ? (currentLineMap.get(previousVoicedLine.shotIndex) ?? "") : "";
        const nextText = nextVoicedLine ? (currentLineMap.get(nextVoicedLine.shotIndex) ?? "") : "";
        return {
          shotIndex: line.shotIndex,
          displayLabel: line.label,
          displayIndex: line.index,
          purpose: context.purpose,
          durationSeconds,
          maxCharacters: guidance.maxCharacters,
          suggestedCharacters: guidance.suggestedCharacters,
          location: context.location,
          emotion: context.emotion,
          narrationHint: context.narrationHint,
          sceneDescription: context.sceneDescription,
          styleGoal: getNarrationStyleGoalForPurpose(context.purpose),
          previousShotPurpose: previousContext?.purpose ?? null,
          nextShotPurpose: nextContext?.purpose ?? null,
          previousText,
          nextText,
          transitionNeed: previousVoicedLine ? "要顺着上一句自然承接" : "负责起势和建立兴趣",
          deliveryStrategy: deliveryStrategyMap.get(line.shotIndex) ?? null,
          currentText: currentLineMap.get(line.shotIndex) ?? "",
        };
      }),
      fullCurrentScript: voicedLines.map((line) => ({
        shotIndex: line.shotIndex,
        displayLabel: line.label,
        displayIndex: line.index,
        text: currentLineMap.get(line.shotIndex) ?? "",
      })),
    };

    const repaired = await callTaskGenerationLlm({
      systemPrompt: buildNarrationPolishSystemPrompt(parameters.video.videoType),
      userContent: JSON.stringify(payload, null, 2),
      temperature: 0.45,
      maxCompletionTokens: 2500,
    });

    if (!repaired) {
      return script;
    }

    const parsed = JSON.parse(stripCodeFence(repaired)) as Array<{ shotIndex?: number; text?: string }>;
    if (!Array.isArray(parsed)) {
      return script;
    }

    const repairedMap = new Map(
      parsed
        .filter((item) => item.shotIndex && typeof item.text === "string")
        .map((item) => [
          item.shotIndex!,
          sanitizeNarrationText(item.text, {
            stripLeadingDayPrefix: true,
          }),
        ]),
    );

    const lines = parsedLines.map((line) => {
      const context = getNarrationLineContext(line, shotPlan);
      return {
        ...line,
        text:
          context.hasVoice || context.hasSubtitle
            ? (repairedMap.get(line.shotIndex) ??
              currentLineMap.get(line.shotIndex) ??
              sanitizeNarrationText(getFallbackNarrationText(line, shotPlan), {
                stripLeadingDayPrefix: true,
              }))
            : "",
      };
    });

    return formatNarrationScriptLines(normalizeNarrationLines(lines, parameters, shotPlan));
  } catch {
    return script;
  }
}

export const NARRATION_HUMANIZATION_MAX_REWRITE_ROUNDS = 2;
export const NARRATION_HUMANIZATION_MIN_ACCEPT_IMPROVEMENT = 6;

async function rewriteNarrationForHumanizationIfNeeded(
  script: string,
  source: VideoTaskSource,
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  if (!shotPlan?.shots?.length) {
    return script;
  }

  const runtime = getTaskGenerationRuntime();
  if (!runtime.liveEnabled) {
    return script;
  }

  let currentScript = script;
  let currentScore = scoreNarrationHumanization(currentScript);
  if (!shouldRewriteNarrationForHumanization(currentScore)) {
    return currentScript;
  }

  for (let attempt = 0; attempt < NARRATION_HUMANIZATION_MAX_REWRITE_ROUNDS; attempt += 1) {
    const parsedLines = parseNarrationScriptLines(currentScript, shotPlan);
    const voicedLines = parsedLines.filter((line) => {
      const context = getNarrationLineContext(line, shotPlan);
      return context.hasVoice || context.hasSubtitle;
    });
    if (voicedLines.length === 0) {
      return currentScript;
    }

    try {
      const payload = {
        target: NARRATION_HUMANIZATION_TARGET,
        currentEvaluation: {
          ...currentScore,
          targetResult: evaluateNarrationHumanizationTarget([currentScore]),
        },
        narrationStyleBrief: buildNarrationStyleBrief(source, parameters.video.videoType, shotPlan),
        sourceContext: {
          productTitle: source.productInfoTitle?.trim() || "",
          productSnapshot: source.productInfoSnapshot?.trim().slice(0, 1000) || "",
          userPrompt: source.userPrompt.trim(),
          referenceTemplate: source.videoTemplatePrompt.trim().slice(0, 1200),
          videoType: parameters.video.videoType,
        },
        fullCurrentScript: voicedLines.map((line) => ({
          shotIndex: line.shotIndex,
          displayLabel: line.label,
          displayIndex: line.index,
          text: line.text,
        })),
        lines: voicedLines.map((line, index) => {
          const context = getNarrationLineContext(line, shotPlan);
          const durationSeconds = getNarrationLineDurationSeconds(line, parameters, shotPlan);
          const guidance = getNarrationLengthGuidance(durationSeconds);
          return {
            shotIndex: line.shotIndex,
            displayLabel: line.label,
            displayIndex: line.index,
            currentText: line.text,
            durationSeconds,
            maxCharacters: guidance.maxCharacters,
            suggestedCharacters: guidance.suggestedCharacters,
            purpose: context.purpose,
            location: context.location,
            emotion: context.emotion,
            narrationHint: context.narrationHint,
            sceneDescription: context.sceneDescription,
            previousText: index > 0 ? (voicedLines[index - 1]?.text ?? "") : "",
            nextText: index < voicedLines.length - 1 ? (voicedLines[index + 1]?.text ?? "") : "",
            requiredImprovement:
              index === 0
                ? "开场补足对象、痛点、判断或反差"
                : index === voicedLines.length - 1
                  ? "收尾补足具体价值和行动感"
                  : "中段补足动作画面、体验理由和前后承接",
          };
        }),
      };

      const rewritten = await callTaskGenerationLlm({
        systemPrompt: buildNarrationHumanizationRewriteSystemPrompt(parameters.video.videoType),
        userContent: JSON.stringify(payload, null, 2),
        temperature: 0.48,
        maxCompletionTokens: 3200,
      });
      if (!rewritten) {
        break;
      }

      const parsed = JSON.parse(stripCodeFence(rewritten)) as Array<{ shotIndex?: number; text?: string }>;
      if (!Array.isArray(parsed)) {
        break;
      }

      const rewriteMap = new Map(
        parsed
          .filter((item) => item.shotIndex && item.text?.trim())
          .map((item) => [
            item.shotIndex!,
            sanitizeNarrationText(item.text, {
              stripLeadingDayPrefix: true,
            }),
          ]),
      );
      const nextLines = parsedLines.map((line) => {
        const context = getNarrationLineContext(line, shotPlan);
        return {
          ...line,
          text: context.hasVoice || context.hasSubtitle ? (rewriteMap.get(line.shotIndex) ?? line.text) : "",
        };
      });
      const nextScript = formatNarrationScriptLines(normalizeNarrationLines(nextLines, parameters, shotPlan));
      const nextScore = scoreNarrationHumanization(nextScript);
      const targetPassed = !shouldRewriteNarrationForHumanization(nextScore);
      const improvedEnough =
        nextScore.score >= currentScore.score + NARRATION_HUMANIZATION_MIN_ACCEPT_IMPROVEMENT ||
        (nextScore.score > currentScore.score &&
          (nextScore.metrics.trust > currentScore.metrics.trust ||
            nextScore.metrics.imagery > currentScore.metrics.imagery ||
            nextScore.metrics.continuity > currentScore.metrics.continuity));

      if (!targetPassed && !improvedEnough) {
        break;
      }

      currentScript = nextScript;
      currentScore = nextScore;
      if (targetPassed) {
        break;
      }
    } catch {
      break;
    }
  }

  return currentScript;
}

function normalizeNarrationLines(
  lines: NarrationScriptLine[],
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  const dayPrefixCount = lines.filter((line) =>
    /^(?:第[一二三四五六七八九十两\d]+天|Day\s*\d+)/i.test(line.text.trim()),
  ).length;

  return lines.map((line) => {
    const durationSeconds = getNarrationLineDurationSeconds(line, parameters, shotPlan);
    const guidance = getNarrationLengthGuidance(durationSeconds);
    const repairTriggerCharacters = getNarrationRepairTriggerCharacters(durationSeconds);
    const emergencyTrimCharacters = getNarrationEmergencyTrimCharacters(durationSeconds);
    let text = sanitizeNarrationText(line.text, {
      stripLeadingDayPrefix: dayPrefixCount >= 2,
    });
    const charCount = countNarrationCharacters(text);
    const needsEmergencyTrim =
      charCount > emergencyTrimCharacters ||
      estimateNarrationReadingSeconds(text) > durationSeconds + Math.max(2.2, durationSeconds * 0.6);
    if (needsEmergencyTrim) {
      text = trimNarrationToCharacterLimit(text, Math.max(guidance.maxCharacters, repairTriggerCharacters));
    }
    return {
      ...line,
      text,
    };
  });
}

function findNarrationRepairCandidates(
  lines: NarrationScriptLine[],
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  const dayPrefixCount = lines.filter((line) =>
    /^(?:第[一二三四五六七八九十两\d]+天|Day\s*\d+)/i.test(line.text.trim()),
  ).length;
  const normalizedCounts = lines.reduce<Map<string, number>>((map, line) => {
    const normalized = sanitizeNarrationText(line.text, {
      stripLeadingDayPrefix: true,
    });
    if (!normalized) {
      return map;
    }
    map.set(normalized, (map.get(normalized) ?? 0) + 1);
    return map;
  }, new Map());
  const qualityIssues = inspectNarrationQuality(
    lines.map((line) => ({
      shotIndex: line.shotIndex,
      text: line.text,
      durationSeconds: getNarrationLineDurationSeconds(line, parameters, shotPlan),
      purpose: getNarrationLineContext(line, shotPlan).purpose,
    })),
  );
  const issueMessageMap = qualityIssues.reduce<Map<number, string[]>>((map, issue) => {
    const current = map.get(issue.shotIndex) ?? [];
    current.push(issue.message);
    map.set(issue.shotIndex, current);
    return map;
  }, new Map());

  return lines
    .map((line) => {
      const durationSeconds = getNarrationLineDurationSeconds(line, parameters, shotPlan);
      const guidance = getNarrationLengthGuidance(durationSeconds);
      const trimmedText = line.text.trim();
      const normalizedText = sanitizeNarrationText(trimmedText, {
        stripLeadingDayPrefix: true,
      });
      const lowSignal =
        normalizedText.length > 0 &&
        (normalizedText.length <= Math.max(6, Math.floor(guidance.suggestedCharacters * 0.5)) ||
          lowSignalNarrationPatterns.some((pattern) => pattern.test(normalizedText)));
      return {
        ...line,
        shotIndex: line.shotIndex,
        text: trimmedText,
        durationSeconds,
        guidance,
        overLimit:
          countNarrationCharacters(trimmedText) > getNarrationRepairTriggerCharacters(durationSeconds) ||
          isNarrationClearlyOverDuration(trimmedText, durationSeconds),
        hasDayPrefix: dayPrefixCount >= 2 && /^(?:第[一二三四五六七八九十两\d]+天|Day\s*\d+)/i.test(trimmedText),
        hasTerminalOh: /哦+[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]*$/u.test(trimmedText),
        hasTerminalPunctuation: /[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]$/u.test(trimmedText),
        duplicated: normalizedText ? (normalizedCounts.get(normalizedText) ?? 0) > 1 : false,
        lowSignal,
        qualityMessages: issueMessageMap.get(line.shotIndex) ?? [],
      };
    })
    .filter(
      (line) =>
        line.text &&
        (line.overLimit ||
          line.hasDayPrefix ||
          line.hasTerminalOh ||
          line.hasTerminalPunctuation ||
          line.duplicated ||
          line.lowSignal ||
          line.qualityMessages.length > 0),
    );
}

async function repairNarrationIfOverLimit(
  script: string,
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
  source?: VideoTaskSource | null,
): Promise<string> {
  let lines = parseNarrationScriptLines(script, shotPlan);
  if (lines.length === 0) return script;

  lines = normalizeNarrationLines(lines, parameters, shotPlan);

  const runtime = getTaskGenerationRuntime();
  if (!runtime.liveEnabled) {
    return formatNarrationScriptLines(lines);
  }

  for (let attempt = 0; attempt < NARRATION_LENGTH_MAX_REPAIR_ROUNDS; attempt += 1) {
    const candidateLines = findNarrationRepairCandidates(lines, parameters, shotPlan);
    if (candidateLines.length === 0) break;
    const deliveryStrategyMap = new Map(
      buildNarrationDeliveryStrategies(
        lines.map((line) => ({
          shotIndex: line.shotIndex,
          purpose: getNarrationLineContext(line, shotPlan).purpose,
          hasVoice: getNarrationLineContext(line, shotPlan).hasVoice,
          hasSubtitle: getNarrationLineContext(line, shotPlan).hasSubtitle,
          requiresLipSync: getNarrationLineContext(line, shotPlan).requiresLipSync,
          hasTalent: getNarrationLineContext(line, shotPlan).hasTalent,
          emotion: getNarrationLineContext(line, shotPlan).emotion,
          durationSeconds: getNarrationLineDurationSeconds(line, parameters, shotPlan),
        })),
        parameters.video.videoType,
      ).map((item) => [item.shotIndex, item]),
    );

    try {
      const repairRequest = {
        narrationStyleBrief: buildNarrationStyleBrief(
          source ?? { productInfoTitle: "", productInfoSnapshot: "", userPrompt: "", videoTemplatePrompt: "" },
          parameters.video.videoType,
          shotPlan,
        ),
        fullCurrentScript: lines.map((line) => ({
          shotIndex: line.shotIndex,
          displayLabel: line.label,
          displayIndex: line.index,
          text: line.text,
        })),
        repairItems: candidateLines.map((line) => {
          const lineIndex = lines.findIndex((item) => item.shotIndex === line.shotIndex);
          return {
            shotIndex: line.shotIndex,
            displayLabel: line.label,
            displayIndex: line.index,
            previousText: lineIndex > 0 ? (lines[lineIndex - 1]?.text ?? "") : "",
            nextText: lineIndex >= 0 && lineIndex < lines.length - 1 ? (lines[lineIndex + 1]?.text ?? "") : "",
            currentText: line.text,
            currentLength: countNarrationCharacters(line.text),
            durationSeconds: line.durationSeconds,
            maxCharacters: line.guidance.maxCharacters,
            suggestedCharacters: line.guidance.suggestedCharacters,
            issues: Array.from(
              new Set(
                [
                  line.overLimit ? "超时风险" : null,
                  line.hasDayPrefix ? "机械化 Day/第X天 开头" : null,
                  line.hasTerminalOh ? "句尾带哦" : null,
                  line.hasTerminalPunctuation ? "句尾带标点" : null,
                  line.duplicated ? "与其他镜头台词重复" : null,
                  line.lowSignal ? "信息量偏低或像口号" : null,
                  ...line.qualityMessages,
                ].filter(Boolean),
              ),
            ),
            deliveryStrategy: deliveryStrategyMap.get(line.shotIndex) ?? null,
          };
        }),
      };

      const repaired = await callTaskGenerationLlm({
        systemPrompt: buildNarrationRepairSystemPrompt(parameters.video.videoType),
        userContent: JSON.stringify(repairRequest, null, 2),
        temperature: 0.2,
        maxCompletionTokens: 2000,
      });

      if (!repaired) break;

      const parsed = JSON.parse(stripCodeFence(repaired)) as Array<{ shotIndex?: number; text?: string }>;
      if (!Array.isArray(parsed)) break;

      const repairMap = new Map(
        parsed
          .filter((item) => item.shotIndex && item.text?.trim())
          .map((item) => [item.shotIndex!, item.text!.trim()]),
      );

      lines = lines.map((l) => ({
        ...l,
        text: sanitizeNarrationText(repairMap.get(l.shotIndex) ?? l.text),
      }));
      lines = normalizeNarrationLines(lines, parameters, shotPlan);
    } catch {
      break;
    }
  }

  return formatNarrationScriptLines(normalizeNarrationLines(lines, parameters, shotPlan));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** 镜头计划校验未通过时，最多调用 LLM 修复的轮数（与「系统规则」说明一致）。 */
export const SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS = 2;

export type DraftBundleWithShotPlan = {
  draftBundle: VideoTaskDraftBundle;
  shotPlan: ShotPlan | null;
  directorPlan: VideoTaskDirectorPlan;
};

function isRealPhotoNarrationFirstPlan(plan: ShotPlan | null | undefined, parameters: VideoTaskParameterBundle) {
  return usesCapturedMaterialFirstWorkflow(parameters.video.videoType) && Boolean(plan?.realPhotoNarrationBlueprint);
}

function buildRealPhotoNarrationBlueprintSystemPrompt(videoType: VideoTaskVideoType) {
  return [
    "你是商业短视频的叙事导演和真人口播编剧。当前是实拍素材成片工作流，必须先生成表达和台词，再由台词反推镜头。",
    "",
    "核心目标：让视频像真实探店/推荐博主在说话，而不是 AI 按镜头硬凑字幕。",
    "",
    "必须遵守：",
    "1. 不要一上来就堆卖点。开篇先制造停留理由、真实疑问或判断场景。",
    "2. 叙事骨架有 60 分作用力：它是引导，不是旅行社式硬模板。允许根据素材自然调整，但不能结构异常。",
    "3. 先写 spokenText，再决定该句对应哪张图。每句台词必须有对应素材证据。",
    "4. 镜头数不得超过可用素材数；素材多于镜头时筛选，素材少时减少镜头。",
    "5. spokenText 要像真人短视频口播：具体、短句、有承接，不要宣传片腔、不要空泛形容词。",
    "6. subtitleText 必须与 spokenText 逐字一致，用于后续 TTS 与字幕同源；禁止摘要、提炼、改写或省略。",
    "7. targetMaterialIds 只能使用输入里给出的 assetId，不要编造。",
    "8. materialBrief.items 中 mustUse=true 的素材必须出现在至少一个 beat 的 targetMaterialIds 中，不能跳过。",
    "9. materialBrief.items 中 forbidden=true 的素材禁止出现在任何 beat 的 targetMaterialIds 中。",
    "10. 如果 mustUse 素材多于原计划镜头数，优先增加或调整 beat，而不是丢弃 mustUse 素材。",
    "11. 优先参考 recommendedPosition、sellingPoints、durationSuggestion 和 compositionScore 来决定素材放在哪个叙事阶段。",
    "",
    `视频类型：${videoType}`,
    "",
    "只输出 JSON 对象，不要 Markdown，不要解释。格式：",
    JSON.stringify(
      {
        narrativeSummary: "整体讲述逻辑",
        speakingStyle: "口播风格",
        targetAudience: "目标用户",
        coreQuestion: "本视频回答的核心购买问题",
        materialStrategy: "素材如何服务台词",
        beats: [
          {
            phase: "opening_hook",
            title: "阶段标题",
            intent: "这一句在商业叙事中的作用",
            spokenText: "真人口播台词",
            subtitleText: "与 spokenText 完全一致的字幕文本",
            targetMaterialIds: ["asset-id"],
            materialReason: "为什么这张素材证明这句台词",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildRealPhotoNarrationBlueprintUserContent(input: {
  source: VideoTaskSource;
  parameters: VideoTaskParameterBundle;
  materialBrief: ReturnType<typeof buildRealPhotoMaterialBrief>;
  fallbackBlueprint: ReturnType<typeof buildFallbackRealPhotoNarrationBlueprint>;
}) {
  return JSON.stringify(
    {
      productInfo: {
        title: input.source.productInfoTitle ?? "",
        snapshot: input.source.productInfoSnapshot,
      },
      userPrompt: input.source.userPrompt,
      optimizedUserPrompt: input.source.optimizedUserPrompt ?? "",
      referenceVideo: {
        materialId: input.source.videoMaterialId,
        name: input.source.videoMaterialName,
        templatePrompt: input.source.videoTemplatePrompt,
      },
      parameters: {
        expectedDurationRange: input.parameters.video.expectedDurationRange,
        requestedStoryShotCount: input.parameters.video.storyShotCount,
        requestedSegmentCount: input.parameters.video.segmentCount,
        aspectRatio: input.parameters.video.aspectRatio,
        generateAudio: input.parameters.video.generateAudio,
        enableSubtitle: input.parameters.audio.enableSubtitle,
      },
      materialBrief: input.materialBrief,
      fallbackStructureForReference: input.fallbackBlueprint,
    },
    null,
    2,
  );
}

async function buildCapturedMaterialNarrationFirstShotPlan(input: {
  source: VideoTaskSource;
  parameters: VideoTaskParameterBundle;
  liveEnabled: boolean;
  hotelAssets?: TaskHotelAssetRecord[];
}) {
  const materialBrief = buildRealPhotoMaterialBrief({
    source: input.source,
    hotelAssets: input.hotelAssets ?? [],
  });
  const fallbackBlueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: input.source,
    parameters: input.parameters,
    materialBrief,
  });
  let narrationBlueprint = fallbackBlueprint;

  if (input.liveEnabled) {
    try {
      const content = await callTaskGenerationLlm({
        systemPrompt: buildRealPhotoNarrationBlueprintSystemPrompt(input.parameters.video.videoType),
        userContent: buildRealPhotoNarrationBlueprintUserContent({
          source: input.source,
          parameters: input.parameters,
          materialBrief,
          fallbackBlueprint,
        }),
        temperature: 0.52,
        maxCompletionTokens: 4200,
      });
      const json = content ? extractBestJsonObject(content, ["beats"]) : null;
      const parsed = json ? (JSON.parse(json) as unknown) : null;
      narrationBlueprint = normalizeRealPhotoNarrationBlueprintCandidate({
        candidate: parsed,
        fallback: fallbackBlueprint,
        materialBrief,
      });
    } catch {
      narrationBlueprint = fallbackBlueprint;
    }
  }

  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint: narrationBlueprint,
    materialBrief,
    parameters: input.parameters,
  });

  shotPlan.validationErrors = validateShotPlan(shotPlan, input.source, input.parameters);
  return shotPlan;
}

async function generateCapturedMaterialNarrationFirstDraftBundle(input: {
  source: VideoTaskSource;
  parameters: VideoTaskParameterBundle;
  liveEnabled: boolean;
  progressTracker?: WeightedProgressTracker | null;
  options?: {
    hotelAssets?: TaskHotelAssetRecord[];
    referenceVideoMaterial?: VideoMaterialRecord | null;
  };
}): Promise<DraftBundleWithShotPlan> {
  input.progressTracker?.start("skeleton", "理解实拍素材并生成台词蓝图...");
  let shotPlan = await buildCapturedMaterialNarrationFirstShotPlan({
    source: input.source,
    parameters: input.parameters,
    liveEnabled: input.liveEnabled,
    hotelAssets: input.options?.hotelAssets ?? [],
  });
  shotPlan = attachCapturedMaterialStoryboardPlan({
    source: input.source,
    parameters: input.parameters,
    shotPlan,
    hotelAssets: input.options?.hotelAssets ?? [],
    referenceVideoMaterial: input.options?.referenceVideoMaterial ?? null,
  });
  input.progressTracker?.complete("skeleton", "台词蓝图与镜头计划完成");

  input.progressTracker?.skip("repair_1", "叙事优先流程跳过旧镜头修复轮次 1");
  input.progressTracker?.skip("repair_2", "叙事优先流程跳过旧镜头修复轮次 2");
  input.progressTracker?.skip("visual_enrichment", "实拍素材已绑定镜头，跳过旧视觉扩写");
  input.progressTracker?.skip("subject_enrichment", "实拍素材已保留原始主体，跳过旧人物扩写");
  input.progressTracker?.skip("subtitle_enrichment", "字幕来自台词蓝图，跳过旧字幕反推");

  input.progressTracker?.start("prompt_generation", "整理叙事与画面提示词...");
  const draftBundle = buildFallbackDraftBundleFromShotPlan(shotPlan, input.parameters);
  input.progressTracker?.complete("prompt_generation", "叙事与画面提示词完成");

  input.progressTracker?.skip("narration_polish", "台词已在蓝图阶段生成，跳过旧台词二次生成");
  input.progressTracker?.skip("narration_repair", "视频时长后续跟随音频，跳过按固定镜头时长压缩台词");

  input.progressTracker?.start("build_director_plan", "整理镜头计划...");
  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle,
    shotPlan,
    parameters: input.parameters,
  });
  input.progressTracker?.complete("build_director_plan", "镜头计划已保存");
  input.progressTracker?.finish("镜头计划生成完成");

  return {
    draftBundle: buildDraftBundleFromDirectorPlan(directorPlan),
    shotPlan,
    directorPlan,
  };
}

// ---------------------------------------------------------------------------
// Shot Plan Enrichment Steps (2-4)
// ---------------------------------------------------------------------------

function buildVisualEnrichmentPrompt(shotPlan: ShotPlan, source: VideoTaskSource, videoType: VideoTaskVideoType) {
  const mainPrompt = getEffectiveConstraintPrompt("shot_plan_visual");
  const categoryPrompt = getVideoTypeCategoryPrompt(videoType, "shot_plan_visual");
  const addonPrompt = getVideoTypeAddonPrompt(videoType, "shot_plan_visual");

  return {
    systemPrompt: [mainPrompt, categoryPrompt, addonPrompt].filter(Boolean).join("\n"),
    userContent: JSON.stringify(
      {
        sourceContext: { title: source.productInfoTitle ?? "", userPrompt: source.userPrompt },
        shotPlanSkeleton: shotPlan,
      },
      null,
      2,
    ),
  };
}

function parseVisualEnrichmentResponse(content: string, shotPlan: ShotPlan): ShotPlan {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as {
      shots?: Array<{
        shotIndex?: number;
        visual?: Record<string, unknown>;
        cinematography?: Record<string, unknown>;
        structure?: Record<string, unknown>;
      }>;
    };
    if (!Array.isArray(parsed.shots)) return shotPlan;

    for (const enriched of parsed.shots) {
      const target = shotPlan.shots.find((s) => s.shotIndex === enriched.shotIndex);
      if (!target) continue;
      if (enriched.visual) {
        target.visual = {
          sceneSetting: String(enriched.visual.sceneSetting ?? ""),
          shotScale: String(enriched.visual.shotScale ?? ""),
          wideContent: String(enriched.visual.wideContent ?? ""),
          midContent: String(enriched.visual.midContent ?? ""),
          closeContent: String(enriched.visual.closeContent ?? ""),
          composition: String(enriched.visual.composition ?? ""),
          colorTone: String(enriched.visual.colorTone ?? ""),
          keyDetails: String(enriched.visual.keyDetails ?? ""),
        };
      }
      if (enriched.cinematography) {
        target.cinematography = {
          shotType: String(enriched.cinematography.shotType ?? ""),
          rhythm: String(enriched.cinematography.rhythm ?? ""),
          infoDensity: String(enriched.cinematography.infoDensity ?? ""),
          lighting: String(enriched.cinematography.lighting ?? ""),
        };
      }
      if (enriched.structure) {
        target.structure = {
          phase: String(enriched.structure.phase ?? ""),
          prevTransition: String(enriched.structure.prevTransition ?? ""),
          nextTransition: String(enriched.structure.nextTransition ?? ""),
          transitionType: String(enriched.structure.transitionType ?? ""),
        };
      }
    }
  } catch {
    /* parsing failed, keep original shotPlan */
  }
  return shotPlan;
}

function buildSubjectEnrichmentPrompt(shotPlan: ShotPlan, source: VideoTaskSource, videoType: VideoTaskVideoType) {
  const mainPrompt = getEffectiveConstraintPrompt("shot_plan_subject");
  const categoryPrompt = getVideoTypeCategoryPrompt(videoType, "shot_plan_subject");
  const addonPrompt = getVideoTypeAddonPrompt(videoType, "shot_plan_subject");
  const characterAppearancePolicy = getMainCharacterAppearancePolicy(source);
  const characterPresencePolicy =
    videoType === "agency_guide_voiceover"
      ? {
          mode: "sparse_characters",
          summary:
            "这是空镜旁白类型。绝大多数镜头应为纯景色/景点/环境展示，只有极少数和真实体验强相关的镜头允许人物点缀出镜。",
          maxCharacterShots: getAgencyGuideVoiceoverMaxCharacterShots(shotPlan.shots.length),
          strongSceneExamples: ["入住办理", "服务互动", "亲子体验", "用餐品尝", "活动体验", "乘坐交通工具"],
          hardRules: [
            "普通景色、地标、建筑、环境、设施、菜品、夜景镜头默认不要主角人物。",
            "允许人物的镜头里，人物也只能点缀出镜，不能长期占据画面主体。",
            "不要为所有镜头都建立统一主角锚点；如果人物镜头极少，reusableModules.characterSetting 可以为空。",
            "如果 maxCharacterShots = 0，则所有镜头的 subject.mainCharacterCount 都应为 0。",
          ],
        }
      : null;

  return {
    systemPrompt: [mainPrompt, categoryPrompt, addonPrompt].filter(Boolean).join("\n"),
    userContent: JSON.stringify(
      {
        sourceContext: { title: source.productInfoTitle ?? "", userPrompt: source.userPrompt },
        characterAppearancePolicy,
        characterPresencePolicy,
        shotPlanWithVisual: shotPlan,
      },
      null,
      2,
    ),
  };
}

function parseSubjectEnrichmentResponse(
  content: string,
  shotPlan: ShotPlan,
  videoType: VideoTaskVideoType,
  source: VideoTaskSource,
): ShotPlan {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as {
      styleConstraints?: Record<string, string>;
      reusableModules?: Record<string, string>;
      shots?: Array<{
        shotIndex?: number;
        subject?: Record<string, unknown>;
      }>;
    };

    if (parsed.styleConstraints) {
      shotPlan.styleConstraints = {
        style: String(parsed.styleConstraints.style ?? ""),
        videoType: String(parsed.styleConstraints.videoType ?? ""),
        forbidden: String(parsed.styleConstraints.forbidden ?? ""),
        realismLevel: String(parsed.styleConstraints.realismLevel ?? ""),
        styleConsistency: String(parsed.styleConstraints.styleConsistency ?? ""),
        characterConsistency: String(parsed.styleConstraints.characterConsistency ?? ""),
      };
    }
    if (parsed.reusableModules) {
      shotPlan.reusableModules = {
        characterSetting: String(parsed.reusableModules.characterSetting ?? ""),
        sceneSetting: String(parsed.reusableModules.sceneSetting ?? ""),
        actionTemplates: String(parsed.reusableModules.actionTemplates ?? ""),
        shotTemplates: String(parsed.reusableModules.shotTemplates ?? ""),
      };
    }
    if (Array.isArray(parsed.shots)) {
      for (const enriched of parsed.shots) {
        const target = shotPlan.shots.find((s) => s.shotIndex === enriched.shotIndex);
        if (!target || !enriched.subject) continue;
        target.subject = {
          mainCharacterCount: Number(enriched.subject.mainCharacterCount) || 0,
          mainCharacterGender: String(enriched.subject.mainCharacterGender ?? ""),
          relationship: String(enriched.subject.relationship ?? ""),
          clothing: String(enriched.subject.clothing ?? ""),
          ageRange: String(enriched.subject.ageRange ?? ""),
          features: String(enriched.subject.features ?? ""),
          appearance: String(enriched.subject.appearance ?? ""),
          style: String(enriched.subject.style ?? ""),
          position: String(enriched.subject.position ?? ""),
          extraCount: Number(enriched.subject.extraCount) || 0,
          extraDistribution: String(enriched.subject.extraDistribution ?? ""),
          extraScale: String(enriched.subject.extraScale ?? ""),
        };
      }
    }
  } catch {
    /* parsing failed, keep original shotPlan */
  }
  return applyVideoTypeShotPlanPolicy(applyMainCharacterAppearancePolicy(shotPlan, source), videoType);
}

function buildSubtitleEnrichmentPrompt(shotPlan: ShotPlan, source: VideoTaskSource, videoType: VideoTaskVideoType) {
  const mainPrompt = getEffectiveConstraintPrompt("shot_plan_subtitle");
  const categoryPrompt = getVideoTypeCategoryPrompt(videoType, "shot_plan_subtitle");
  const addonPrompt = getVideoTypeAddonPrompt(videoType, "shot_plan_subtitle");
  const segmentGuidance = Array.from(
    shotPlan.shots.reduce<
      Map<
        number,
        {
          segmentIndex: number;
          segmentId: string;
          durationSeconds: number;
          referenceMaxCharacters: number;
          referenceCharacterRange: [number, number];
          coveredShotIndexes: number[];
          sceneSummary: string;
          narrationHints: string[];
        }
      >
    >((map, shot) => {
      const segmentIndex = shot.segmentIndex ?? shot.shotIndex;
      const existing = map.get(segmentIndex);
      const durationSeconds = Math.max(0.8, shot.durationSeconds || 0);
      const guidance = getNarrationLengthGuidance(durationSeconds);

      if (!existing) {
        map.set(segmentIndex, {
          segmentIndex,
          segmentId: shot.segmentId ?? `segment-${segmentIndex}`,
          durationSeconds,
          referenceMaxCharacters: guidance.maxCharacters,
          referenceCharacterRange: [guidance.minCharacters, guidance.suggestedCharacters],
          coveredShotIndexes: [shot.shotIndex],
          sceneSummary: shot.sceneDescription,
          narrationHints: shot.narrationHint ? [shot.narrationHint] : [],
        });
        return map;
      }

      const nextDuration = Number((existing.durationSeconds + durationSeconds).toFixed(2));
      const nextGuidance = getNarrationLengthGuidance(nextDuration);
      existing.durationSeconds = nextDuration;
      existing.referenceMaxCharacters = nextGuidance.maxCharacters;
      existing.referenceCharacterRange = [nextGuidance.minCharacters, nextGuidance.suggestedCharacters];
      existing.coveredShotIndexes.push(shot.shotIndex);
      existing.sceneSummary = [existing.sceneSummary, shot.sceneDescription].filter(Boolean).join("；");
      if (shot.narrationHint) {
        existing.narrationHints.push(shot.narrationHint);
      }
      return map;
    }, new Map()),
  ).map(([, value]) => ({
    ...value,
    narrationHints: Array.from(new Set(value.narrationHints)).slice(0, 4),
  }));

  return {
    systemPrompt: [mainPrompt, categoryPrompt, addonPrompt, "", buildNarrationStandardsPromptBlock(videoType)]
      .filter(Boolean)
      .join("\n"),
    userContent: JSON.stringify(
      {
        narrationStyleBrief: buildNarrationStyleBrief(source, videoType, shotPlan),
        sourceContext: {
          productTitle: source.productInfoTitle?.trim() || "",
          productSnapshot: source.productInfoSnapshot?.trim() || "",
          userPrompt: source.userPrompt,
          referenceTemplatePrompt: source.videoTemplatePrompt.trim().slice(0, 1200),
        },
        segmentGuidance,
        completeShotPlan: shotPlan,
      },
      null,
      2,
    ),
  };
}

function parseSubtitleEnrichmentResponse(content: string, shotPlan: ShotPlan, videoType: VideoTaskVideoType): ShotPlan {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as {
      narrativeCurves?: Record<string, string>;
      subtitlePlan?: Array<{
        segmentIndex?: number;
        segmentId?: string;
        subtitles?: Array<{
          text?: string;
          startAtSeconds?: number;
          durationSeconds?: number;
          charCount?: number;
          coveredShotIndexes?: number[];
        }>;
      }>;
    };

    if (parsed.narrativeCurves) {
      shotPlan.narrativeCurves = {
        openingStrategy: String(parsed.narrativeCurves.openingStrategy ?? ""),
        midStructure: String(parsed.narrativeCurves.midStructure ?? ""),
        closingStrategy: String(parsed.narrativeCurves.closingStrategy ?? ""),
        rhythmCurve: String(parsed.narrativeCurves.rhythmCurve ?? ""),
        emotionCurve: String(parsed.narrativeCurves.emotionCurve ?? ""),
        infoOrder: String(parsed.narrativeCurves.infoOrder ?? ""),
      };
    }
    if (Array.isArray(parsed.subtitlePlan)) {
      shotPlan.subtitlePlan = parsed.subtitlePlan.map((seg) => ({
        segmentIndex: Number(seg.segmentIndex) || 0,
        segmentId: String(seg.segmentId ?? ""),
        subtitles: Array.isArray(seg.subtitles)
          ? seg.subtitles.map((sub) => ({
              text: sanitizeNarrationText(String(sub.text ?? ""), {
                stripLeadingDayPrefix: true,
              }),
              startAtSeconds: Number(sub.startAtSeconds) || 0,
              durationSeconds: Number(sub.durationSeconds) || 0,
              charCount:
                Number(sub.charCount) ||
                countNarrationCharacters(
                  sanitizeNarrationText(String(sub.text ?? ""), {
                    stripLeadingDayPrefix: true,
                  }),
                ),
              coveredShotIndexes: Array.isArray(sub.coveredShotIndexes) ? sub.coveredShotIndexes.map(Number) : [],
            }))
          : [],
      }));
    }
  } catch {
    /* parsing failed, keep original shotPlan */
  }
  return normalizeSubtitlePlanSource(shotPlan, videoType);
}

async function enrichShotPlan(
  shotPlan: ShotPlan,
  source: VideoTaskSource,
  parameters: VideoTaskParameterBundle,
  progressTracker?: WeightedProgressTracker | null,
): Promise<ShotPlan> {
  const videoType = parameters.video.videoType;

  // Step 2: Visual & Cinematography enrichment
  progressTracker?.start("visual_enrichment", "视觉设计中...");
  try {
    const visual = buildVisualEnrichmentPrompt(shotPlan, source, videoType);
    const visualContent = await callTaskGenerationLlm({
      systemPrompt: visual.systemPrompt,
      userContent: visual.userContent,
      temperature: 0.3,
      maxCompletionTokens: 5000,
    });
    if (visualContent) {
      shotPlan = parseVisualEnrichmentResponse(visualContent, shotPlan);
    }
  } catch {
    /* visual enrichment failed, continue */
  }
  progressTracker?.complete("visual_enrichment", "视觉设计完成");

  // Step 3: Subject & Style enrichment
  progressTracker?.start("subject_enrichment", "人物与风格设计中...");
  try {
    const subject = buildSubjectEnrichmentPrompt(shotPlan, source, videoType);
    const subjectContent = await callTaskGenerationLlm({
      systemPrompt: subject.systemPrompt,
      userContent: subject.userContent,
      temperature: 0.3,
      maxCompletionTokens: 5000,
    });
    if (subjectContent) {
      shotPlan = parseSubjectEnrichmentResponse(subjectContent, shotPlan, videoType, source);
    }
  } catch {
    /* subject enrichment failed, continue */
  }
  progressTracker?.complete("subject_enrichment", "人物与风格完成");

  // Step 4: Subtitle & Narrative enrichment
  progressTracker?.start("subtitle_enrichment", "字幕与叙事规划中...");
  try {
    const subtitle = buildSubtitleEnrichmentPrompt(shotPlan, source, videoType);
    const subtitleContent = await callTaskGenerationLlm({
      systemPrompt: subtitle.systemPrompt,
      userContent: subtitle.userContent,
      temperature: 0.3,
      maxCompletionTokens: 4000,
    });
    if (subtitleContent) {
      shotPlan = parseSubtitleEnrichmentResponse(subtitleContent, shotPlan, videoType);
    }
  } catch {
    /* subtitle enrichment failed, continue */
  }
  progressTracker?.complete("subtitle_enrichment", "字幕规划完成");

  return applyMainCharacterAppearancePolicy(shotPlan, source);
}

function attachCapturedMaterialStoryboardPlan(input: {
  source: VideoTaskSource;
  parameters: VideoTaskParameterBundle;
  shotPlan: ShotPlan;
  hotelAssets?: TaskHotelAssetRecord[];
  referenceVideoMaterial?: VideoMaterialRecord | null;
}): ShotPlan {
  if (!usesCapturedMaterialFirstWorkflow(input.parameters.video.videoType)) {
    return input.shotPlan;
  }

  const storyboard = buildTaskStoryboardPlan({
    source: input.source,
    parameters: input.parameters,
    shotPlan: input.shotPlan,
    hotelAssets: input.hotelAssets ?? [],
    referenceVideoMaterial: input.referenceVideoMaterial ?? null,
  });

  return {
    ...input.shotPlan,
    storyboard: {
      ...storyboard,
      realPhotoMaterialBrief: input.shotPlan.realPhotoMaterialBrief,
      realPhotoNarrationBlueprint: input.shotPlan.realPhotoNarrationBlueprint,
    },
  };
}

export async function generateVideoTaskDraftBundle(
  source: VideoTaskSource,
  parameters: VideoTaskParameterBundle,
  onProgress?: ProgressCallback,
  options?: {
    hotelAssets?: TaskHotelAssetRecord[];
    referenceVideoMaterial?: VideoMaterialRecord | null;
  },
): Promise<DraftBundleWithShotPlan> {
  const runtime = getTaskGenerationRuntime();
  const progressTracker = createDraftBundleProgressTracker(onProgress, parameters);

  try {
    if (usesCapturedMaterialFirstWorkflow(parameters.video.videoType)) {
      return await generateCapturedMaterialNarrationFirstDraftBundle({
        source,
        parameters,
        liveEnabled: runtime.liveEnabled,
        progressTracker,
        options,
      });
    }

    if (!runtime.liveEnabled) {
      progressTracker?.start("skeleton", "当前模型离线，切换本地兜底...");
      let fallbackPlan = buildFallbackShotPlan(source, parameters);
      if (isHotelVideoType(parameters.video.videoType) && usesCapturedMaterialFirstWorkflow(parameters.video.videoType)) {
        fallbackPlan = applyHotelAssetPlanning({
          shotPlan: fallbackPlan,
          hotelAssets: options?.hotelAssets ?? [],
          referenceVideoMaterial: options?.referenceVideoMaterial ?? null,
          workflowKind: getVideoTaskWorkflowKind(parameters.video.videoType),
        });
      }
      fallbackPlan = attachCapturedMaterialStoryboardPlan({
        source,
        parameters,
        shotPlan: fallbackPlan,
        hotelAssets: options?.hotelAssets ?? [],
        referenceVideoMaterial: options?.referenceVideoMaterial ?? null,
      });
      progressTracker?.complete("skeleton", "已生成兜底镜头规划");
      progressTracker?.skip("repair_1", "跳过修复轮次 1");
      progressTracker?.skip("repair_2", "跳过修复轮次 2");
      progressTracker?.skip("visual_enrichment", "跳过视觉增强");
      progressTracker?.skip("subject_enrichment", "跳过人物增强");
      progressTracker?.skip("subtitle_enrichment", "跳过字幕增强");
      progressTracker?.skip("prompt_generation", "直接使用兜底提示词");
      progressTracker?.skip("narration_polish", "跳过台词润色");
      progressTracker?.skip("narration_repair", "跳过台词校验");
      progressTracker?.start("build_director_plan", "整理镜头计划...");
      const directorPlan = buildDirectorPlanFromTaskData({
        draftBundle: buildFallbackDraftBundleFromShotPlan(fallbackPlan, parameters),
        shotPlan: fallbackPlan,
        parameters,
      });
      progressTracker?.complete("build_director_plan", "镜头计划已整理");
      progressTracker?.finish("镜头计划生成完成");
      return {
        draftBundle: buildDraftBundleFromDirectorPlan(directorPlan),
        shotPlan: fallbackPlan,
        directorPlan,
      };
    }

    // Step 1: Generate shot plan skeleton
    progressTracker?.start("skeleton", "生成镜头骨架...");
    let shotPlan: ShotPlan | null = null;
    try {
      const shotPlanContent = await callTaskGenerationLlm({
        systemPrompt: buildShotPlanSystemPrompt(parameters.constraints, parameters.video.videoType),
        userContent: buildSourceSummary(source, parameters, {
          hotelAssets: options?.hotelAssets ?? [],
          referenceVideoMaterial: options?.referenceVideoMaterial ?? null,
        }),
        temperature: 0.35,
        maxCompletionTokens: 5000,
      });

      if (shotPlanContent) {
        shotPlan = parseShotPlanResponse(shotPlanContent, parameters);
      }
    } catch {
      // shot plan generation failed, continue with fallback
    }

    if (!shotPlan) {
      shotPlan = buildFallbackShotPlan(source, parameters);
    }
    progressTracker?.complete("skeleton", "镜头骨架完成");

    // Step 2: Validate and repair
    let validationErrors = validateShotPlan(shotPlan, source, parameters);
    let performedRepairRounds = 0;

    for (
      let attempt = 0;
      attempt < SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS && validationErrors.length > 0;
      attempt += 1
    ) {
      performedRepairRounds = attempt + 1;
      const repairUnitId = `repair_${attempt + 1}` as const;
      progressTracker?.start(repairUnitId, `校验并修复镜头规划（第 ${attempt + 1} 轮）...`);
      try {
        const repairContent = await callTaskGenerationLlm({
          systemPrompt: buildShotPlanSystemPrompt(parameters.constraints, parameters.video.videoType),
          userContent: buildRepairPrompt(shotPlan, validationErrors),
          temperature: 0.2,
          maxCompletionTokens: 5000,
        });

        if (repairContent) {
          const repaired = parseShotPlanResponse(repairContent, parameters);
          if (repaired) {
            shotPlan = repaired;
            validationErrors = validateShotPlan(shotPlan, source, parameters);
          }
        }
      } catch {
        progressTracker?.complete(repairUnitId, `第 ${attempt + 1} 轮修复中断，继续后续流程`);
        break;
      }
      progressTracker?.complete(
        repairUnitId,
        validationErrors.length > 0 ? `第 ${attempt + 1} 轮修复完成，继续复检` : `第 ${attempt + 1} 轮修复通过`,
      );
    }

    if (performedRepairRounds < SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS) {
      for (let attempt = performedRepairRounds; attempt < SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS; attempt += 1) {
        progressTracker?.skip(`repair_${attempt + 1}`, `跳过修复轮次 ${attempt + 1}`);
      }
    }

    shotPlan.validationErrors = validationErrors;

    // Steps 2-4: Enrich shot plan with visual, subject, subtitle details
    shotPlan = await enrichShotPlan(shotPlan, source, parameters, progressTracker);
    if (isHotelVideoType(parameters.video.videoType) && usesCapturedMaterialFirstWorkflow(parameters.video.videoType)) {
      shotPlan = applyHotelAssetPlanning({
        shotPlan,
        hotelAssets: options?.hotelAssets ?? [],
        referenceVideoMaterial: options?.referenceVideoMaterial ?? null,
        workflowKind: getVideoTaskWorkflowKind(parameters.video.videoType),
      });
    }
    shotPlan = attachCapturedMaterialStoryboardPlan({
      source,
      parameters,
      shotPlan,
      hotelAssets: options?.hotelAssets ?? [],
      referenceVideoMaterial: options?.referenceVideoMaterial ?? null,
    });

    // Step 5: Generate prompts from shot plan
    progressTracker?.start("prompt_generation", "生成提示词...");
    let draftBundle: VideoTaskDraftBundle | null = null;
    try {
      const promptContent = await callTaskGenerationLlm({
        systemPrompt: buildPromptGenerationSystemPrompt(parameters),
        userContent: buildPromptGenerationUserContent(shotPlan, parameters, source),
        temperature: 0.3,
        maxCompletionTokens: 7000,
      });

      if (promptContent) {
        const parsed = JSON.parse(stripCodeFence(promptContent)) as Partial<VideoTaskDraftBundle>;
        const fallback = buildFallbackDraftBundleFromShotPlan(shotPlan, parameters);

        draftBundle = {
          textToImagePrompt: parsed.textToImagePrompt?.trim() || fallback.textToImagePrompt,
          imageToVideoPrompt: parsed.imageToVideoPrompt?.trim() || fallback.imageToVideoPrompt,
          narrationScript: parsed.narrationScript?.trim() || fallback.narrationScript,
        };
      }
    } catch {
      // prompt generation failed, use fallback
    }

    if (!draftBundle) {
      draftBundle = buildFallbackDraftBundleFromShotPlan(shotPlan, parameters);
    }

    if (usesSegmentLevelSubtitleSource(parameters.video.videoType)) {
      shotPlan =
        syncNarrationScriptIntoSubtitlePlan(shotPlan, draftBundle.narrationScript, parameters.video.videoType) ??
        shotPlan;
      draftBundle.narrationScript =
        buildNarrationScriptFromSubtitlePlan(shotPlan, parameters.video.videoType) || draftBundle.narrationScript;
    }

    progressTracker?.complete("prompt_generation", "提示词完成");

    // Step 3.5: Polish narration quality before timing repair
    progressTracker?.start("narration_polish", "台词润色中...");
    draftBundle.narrationScript = await polishNarrationScriptQuality(
      draftBundle.narrationScript,
      source,
      parameters,
      shotPlan,
    );
    draftBundle.narrationScript = await rewriteNarrationForHumanizationIfNeeded(
      draftBundle.narrationScript,
      source,
      parameters,
      shotPlan,
    );
    if (usesSegmentLevelSubtitleSource(parameters.video.videoType)) {
      shotPlan =
        syncNarrationScriptIntoSubtitlePlan(shotPlan, draftBundle.narrationScript, parameters.video.videoType) ??
        shotPlan;
      draftBundle.narrationScript =
        buildNarrationScriptFromSubtitlePlan(shotPlan, parameters.video.videoType) || draftBundle.narrationScript;
    }
    progressTracker?.complete("narration_polish", "台词润色与真人化完成");

    // Step 3.6: Check narration quality / timing and repair risky lines
    progressTracker?.start("narration_repair", "校验解说时长...");
    draftBundle.narrationScript = await repairNarrationIfOverLimit(
      draftBundle.narrationScript,
      parameters,
      shotPlan,
      source,
    );
    if (usesSegmentLevelSubtitleSource(parameters.video.videoType)) {
      shotPlan =
        syncNarrationScriptIntoSubtitlePlan(shotPlan, draftBundle.narrationScript, parameters.video.videoType) ??
        shotPlan;
      draftBundle.narrationScript =
        buildNarrationScriptFromSubtitlePlan(shotPlan, parameters.video.videoType) || draftBundle.narrationScript;
    }
    progressTracker?.complete("narration_repair", "解说时长校验完成");

    progressTracker?.start("build_director_plan", "整理镜头计划...");
    const directorPlan = buildDirectorPlanFromTaskData({
      draftBundle,
      shotPlan,
      parameters,
    });
    progressTracker?.complete("build_director_plan", "镜头计划已保存");
    progressTracker?.finish("镜头计划生成完成");

    return {
      draftBundle: buildDraftBundleFromDirectorPlan(directorPlan),
      shotPlan,
      directorPlan,
    };
  } finally {
    progressTracker?.dispose();
  }
}
