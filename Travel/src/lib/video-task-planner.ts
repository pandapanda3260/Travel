import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import {
  countNarrationCharacters,
  getNarrationLengthGuidance,
  sanitizeNarrationText,
  stripCodeFence,
  trimNarrationToCharacterLimit,
} from "./narration";
import {
  buildNarrationDeliveryStrategies,
  buildNarrationStandardsPromptBlock,
  inspectNarrationQuality,
} from "./narration-standards";
import { buildNarrationPolishSystemPrompt, buildNarrationRepairSystemPrompt } from "./narration-prompt-library";
import { PROMPT_GENERATION_RUNTIME_HARD_RULES, SHOT_PLAN_RUNTIME_HARD_RULES } from "./prompt-runtime-library";
import { callTaskGenerationLlm, getTaskGenerationRuntime } from "./task-generation-runtime";
import { buildDirectorPlanFromTaskData, buildDraftBundleFromDirectorPlan } from "./video-task-director";
import { deriveVideoTaskStructure } from "./video-task-structure";
import {
  getVideoTaskTypeProfile,
  type ShotPlan,
  type ShotPlanItem,
  type TaskConstraints,
  type VideoTaskDirectorPlan,
  type VideoTaskDraftBundle,
  type VideoTaskParameterBundle,
  type VideoTaskSource,
} from "./video-task-schema";

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

function buildSourceSummary(source: VideoTaskSource, parameters: VideoTaskParameterBundle) {
  const narrationGuidance = getNarrationLengthGuidance(getPlannedStoryShotDurationSeconds(parameters));
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
    rules.push(`人物结构约束：本视频的人物组合为 ${constraints.peopleStructure}。`);
  }

  if (constraints.adultGenderRule === "one_male_one_female") {
    rules.push("性别约束：如果有两个成年人出镜，必须设定为一男一女（father 和 mother），禁止两个同性成年人组合。");
  }

  if (constraints.requirePeopleInEveryShot) {
    rules.push("出镜约束：每个镜头必须有人物出镜，禁止纯空镜。");
  }

  if (constraints.forbidEmptyShots) {
    rules.push("空镜约束：禁止出现完全没有视觉主体的空镜。");
  }

  if (constraints.characterConsistency === "high") {
    rules.push("人物一致性（高）：所有出现人物的镜头，人物外观、年龄段、服装风格必须保持一致，不能换人。");
  } else if (constraints.characterConsistency === "medium") {
    rules.push("人物一致性（中）：同一个角色在不同镜头中应保持可辨识的相似特征。");
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

function buildShotPlanSystemPrompt(constraints: TaskConstraints) {
  const constraintRules = buildConstraintRules(constraints);
  const basePrompt = getEffectiveConstraintPrompt("shot_plan");

  return [
    basePrompt,
    "",
    "系统底线要求（始终生效）：",
    ...SHOT_PLAN_RUNTIME_HARD_RULES.map((rule, index) => `${index + 1}. ${rule}`),
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
  const shotDuration = getPlannedStoryShotDurationSeconds(parameters);
  const montageLike =
    parameters.video.segmentMode === "multi_shot_montage" ||
    parameters.video.segmentMode === "hybrid_intro_plus_montage";
  const shots: ShotPlanItem[] = Array.from({ length: shotCount }, (_, i) => {
    const shotIndex = i + 1;
    const isFirst = i === 0;
    const isLast = i === shotCount - 1;
    const shouldVoice = profile.hasVoice
      ? !montageLike || shotCount <= 3 || isFirst || isLast || shotIndex % 2 === 1
      : false;
    const purpose = isFirst ? "hook" : isLast ? "closing" : shotIndex % 2 === 0 ? "detail" : "experience";

    return {
      shotIndex,
      purpose,
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
      durationSeconds: shotDuration,
      sceneDescription: isFirst
        ? `${subject}的全景画面，突出核心吸引力`
        : isLast
          ? `${subject}的收束画面，呼应开场`
          : `${subject}的体验细节`,
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
    totalDurationSeconds: getPlannedTotalDurationSeconds(parameters),
    validationErrors: [],
  };
}

function parseShotPlanResponse(content: string, parameters: VideoTaskParameterBundle): ShotPlan | null {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as {
      globalStyle?: string;
      totalDurationSeconds?: number;
      shots?: Array<Partial<ShotPlanItem>>;
    };

    if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
      return null;
    }

    const shots: ShotPlanItem[] = parsed.shots.map((raw, i) => ({
      shotIndex: raw.shotIndex ?? i + 1,
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
    }));

    return {
      shots,
      globalStyle: parsed.globalStyle?.trim() ?? "",
      totalDurationSeconds: Number(parsed.totalDurationSeconds) || shots.reduce((sum, s) => sum + s.durationSeconds, 0),
      validationErrors: [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 2: Validation
// ---------------------------------------------------------------------------

/** 规则说明见 `system-rules-payload.ts`（与「系统规则」页同步维护）。 */
function validateShotPlan(plan: ShotPlan, _source: VideoTaskSource, parameters: VideoTaskParameterBundle): string[] {
  const errors: string[] = [];
  const expected = getPlannedStoryShotCount(parameters);
  const constraints = parameters.constraints;
  const profile = getVideoTaskTypeProfile(parameters.video.videoType);

  if (plan.shots.length !== expected) {
    errors.push(`镜头数量应为 ${expected}，实际为 ${plan.shots.length}`);
  }

  for (const shot of plan.shots) {
    if (shot.durationSeconds <= 0) {
      errors.push(`镜头 ${shot.shotIndex} 时长必须大于 0 秒`);
    }

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

  if (
    profile.hasVoice &&
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
  return [
    getEffectiveConstraintPrompt("prompt_generation"),
    "",
    "以下是始终生效的底线要求：",
    ...PROMPT_GENERATION_RUNTIME_HARD_RULES.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    buildNarrationStandardsPromptBlock(parameters.video.videoType),
  ].join("\n");
}

function buildPromptGenerationUserContent(
  plan: ShotPlan,
  parameters: VideoTaskParameterBundle,
  source: VideoTaskSource,
) {
  const narrationGuidance = getNarrationLengthGuidance(getPlannedStoryShotDurationSeconds(parameters));
  const voicedShots = plan.shots.filter((shot) => shot.hasVoice || shot.hasSubtitle);
  const deliveryStrategyMap = new Map(
    buildNarrationDeliveryStrategies(
      plan.shots.map((shot) => ({
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

  return JSON.stringify(
    {
      shotPlan: plan,
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
      storyboardEnabled: parameters.audio.storyboardEnabled,
      narrationExecutionNotes: voicedShots.map((shot, index) => ({
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
      })),
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

  const imageLines = plan.shots
    .map((shot) => `镜头${shot.shotIndex}：${shot.sceneDescription}，${orientation}，写实摄影风格，电影级质感。`)
    .join("\n");

  const videoLines = plan.shots
    .map(
      (shot) =>
        `镜头${shot.shotIndex}：${shot.action}，${shot.cameraMovement === "auto" ? "自然运镜" : shot.cameraMovement}，${shot.emotion}，${shot.durationSeconds}秒。`,
    )
    .join("\n");

  const narrationLines = plan.shots
    .map(
      (shot) =>
        `镜头${shot.shotIndex}：${shot.hasVoice === false && shot.hasSubtitle === false ? "" : sanitizeNarrationText(shot.narrationHint)}`,
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
  const narrationLines = Array.from({ length: shotCount }, (_, index) => {
    const isVoiced = shotCount <= 3 || index === 0 || index === shotCount - 1 || (index + 1) % 2 === 1;
    if (!isVoiced) {
      return `镜头${index + 1}：`;
    }
    if (index === 0) {
      return `镜头${index + 1}：先把${narrationSubject}最抓人的地方说出来`;
    }

    if (index === shotCount - 1) {
      return `镜头${index + 1}：最后把${narrationSubject}值得立刻出发的感觉收住`;
    }

    return `镜头${index + 1}：把${narrationSubject}里最有画面感的一点讲清楚`;
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

function parseNarrationLines(script: string): Array<{ shotIndex: number; text: string }> {
  const pattern = /镜头\s*(\d+)\s*[.．、:：]?\s*/g;
  const matches = Array.from(script.matchAll(pattern));
  if (matches.length === 0) return [];
  return matches.map((match, mi) => {
    const startIdx = (match.index ?? 0) + match[0].length;
    const endIdx = matches[mi + 1]?.index ?? script.length;
    return { shotIndex: Number(match[1]), text: script.slice(startIdx, endIdx).trim() };
  });
}

function reassembleNarrationScript(lines: Array<{ shotIndex: number; text: string }>): string {
  return lines.map((l) => `镜头${l.shotIndex}：${l.text}`).join("\n");
}

/** 解说词超长时最多尝试缩写的轮数。 */
export const NARRATION_LENGTH_MAX_REPAIR_ROUNDS = 2;

const lowSignalNarrationPatterns = [/直接冲$/u, /太出片了$/u, /最值了$/u, /都逛完了$/u, /这样逛更省力$/u, /别乱订$/u];

function getNarrationLineDurationSeconds(
  shotIndex: number,
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  return (
    shotPlan?.shots.find((shot) => shot.shotIndex === shotIndex)?.durationSeconds ??
    getPlannedStoryShotDurationSeconds(parameters)
  );
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

  const currentLineMap = new Map(
    parseNarrationLines(script).map((line) => [
      line.shotIndex,
      sanitizeNarrationText(line.text, {
        stripLeadingDayPrefix: true,
      }),
    ]),
  );
  const voicedShots = shotPlan.shots.filter((shot) => shot.hasVoice || shot.hasSubtitle);
  if (voicedShots.length === 0) {
    return script;
  }

  try {
    const deliveryStrategyMap = new Map(
      buildNarrationDeliveryStrategies(
        shotPlan.shots.map((shot) => ({
          shotIndex: shot.shotIndex,
          purpose: shot.purpose,
          hasVoice: shot.hasVoice,
          hasSubtitle: shot.hasSubtitle,
          requiresLipSync: shot.requiresLipSync,
          hasTalent: shot.hasTalent,
          emotion: shot.emotion,
          durationSeconds: getNarrationLineDurationSeconds(shot.shotIndex, parameters, shotPlan),
        })),
        parameters.video.videoType,
      ).map((item) => [item.shotIndex, item]),
    );
    const payload = {
      sourceContext: {
        productTitle: source.productInfoTitle?.trim() || "",
        userPrompt: source.userPrompt.trim(),
        referenceTemplate: source.videoTemplatePrompt.trim().slice(0, 800),
        expectedDurationRange: getExpectedDurationRangeLabel(parameters.video.expectedDurationRange),
        videoType: parameters.video.videoType,
      },
      shots: voicedShots.map((shot) => {
        const durationSeconds = getNarrationLineDurationSeconds(shot.shotIndex, parameters, shotPlan);
        const guidance = getNarrationLengthGuidance(durationSeconds);
        const shotIndex = shot.shotIndex;
        const currentVoicedIndex = voicedShots.findIndex((item) => item.shotIndex === shotIndex);
        const previousVoicedShot = currentVoicedIndex > 0 ? voicedShots[currentVoicedIndex - 1] : null;
        const nextVoicedShot =
          currentVoicedIndex >= 0 && currentVoicedIndex < voicedShots.length - 1
            ? voicedShots[currentVoicedIndex + 1]
            : null;
        return {
          shotIndex,
          purpose: shot.purpose,
          durationSeconds,
          maxCharacters: guidance.maxCharacters,
          suggestedCharacters: guidance.suggestedCharacters,
          location: shot.location,
          emotion: shot.emotion,
          narrationHint: shot.narrationHint,
          sceneDescription: shot.sceneDescription,
          styleGoal: getNarrationStyleGoalForPurpose(shot.purpose),
          previousShotPurpose: previousVoicedShot?.purpose ?? null,
          nextShotPurpose: nextVoicedShot?.purpose ?? null,
          transitionNeed: previousVoicedShot ? "要顺着上一句自然承接" : "负责起势和建立兴趣",
          deliveryStrategy: deliveryStrategyMap.get(shotIndex) ?? null,
          currentText: currentLineMap.get(shot.shotIndex) ?? "",
        };
      }),
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

    const lines = shotPlan.shots.map((shot) => ({
      shotIndex: shot.shotIndex,
      text:
        shot.hasVoice || shot.hasSubtitle
          ? (repairedMap.get(shot.shotIndex) ??
            currentLineMap.get(shot.shotIndex) ??
            sanitizeNarrationText(shot.narrationHint, {
              stripLeadingDayPrefix: true,
            }))
          : "",
    }));

    return reassembleNarrationScript(normalizeNarrationLines(lines, parameters, shotPlan));
  } catch {
    return script;
  }
}

function normalizeNarrationLines(
  lines: Array<{ shotIndex: number; text: string }>,
  parameters: VideoTaskParameterBundle,
  shotPlan?: ShotPlan | null,
) {
  const dayPrefixCount = lines.filter((line) =>
    /^(?:第[一二三四五六七八九十两\d]+天|Day\s*\d+)/i.test(line.text.trim()),
  ).length;

  return lines.map((line) => {
    const durationSeconds = getNarrationLineDurationSeconds(line.shotIndex, parameters, shotPlan);
    const guidance = getNarrationLengthGuidance(durationSeconds);
    let text = sanitizeNarrationText(line.text, {
      stripLeadingDayPrefix: dayPrefixCount >= 2,
    });
    if (countNarrationCharacters(text) > guidance.maxCharacters) {
      text = trimNarrationToCharacterLimit(text, guidance.maxCharacters);
    }
    return {
      shotIndex: line.shotIndex,
      text,
    };
  });
}

function findNarrationRepairCandidates(
  lines: Array<{ shotIndex: number; text: string }>,
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
      durationSeconds: getNarrationLineDurationSeconds(line.shotIndex, parameters, shotPlan),
      purpose: shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex)?.purpose ?? null,
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
      const durationSeconds = getNarrationLineDurationSeconds(line.shotIndex, parameters, shotPlan);
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
        shotIndex: line.shotIndex,
        text: trimmedText,
        durationSeconds,
        guidance,
        overLimit: countNarrationCharacters(trimmedText) > guidance.maxCharacters,
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
): Promise<string> {
  let lines = parseNarrationLines(script);
  if (lines.length === 0) return script;

  lines = normalizeNarrationLines(lines, parameters, shotPlan);

  const runtime = getTaskGenerationRuntime();
  if (!runtime.liveEnabled) {
    return reassembleNarrationScript(lines);
  }

  for (let attempt = 0; attempt < NARRATION_LENGTH_MAX_REPAIR_ROUNDS; attempt += 1) {
    const candidateLines = findNarrationRepairCandidates(lines, parameters, shotPlan);
    if (candidateLines.length === 0) break;
    const deliveryStrategyMap = new Map(
      buildNarrationDeliveryStrategies(
        lines.map((line) => ({
          shotIndex: line.shotIndex,
          purpose: shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex)?.purpose ?? "experience",
          hasVoice: shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex)?.hasVoice ?? true,
          hasSubtitle: shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex)?.hasSubtitle ?? true,
          requiresLipSync: shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex)?.requiresLipSync ?? false,
          hasTalent: shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex)?.hasTalent ?? false,
          emotion: shotPlan?.shots.find((shot) => shot.shotIndex === line.shotIndex)?.emotion ?? "",
          durationSeconds: getNarrationLineDurationSeconds(line.shotIndex, parameters, shotPlan),
        })),
        parameters.video.videoType,
      ).map((item) => [item.shotIndex, item]),
    );

    try {
      const repairRequest = candidateLines.map((line) => ({
        shotIndex: line.shotIndex,
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
      }));

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
        shotIndex: l.shotIndex,
        text: sanitizeNarrationText(repairMap.get(l.shotIndex) ?? l.text),
      }));
      lines = normalizeNarrationLines(lines, parameters, shotPlan);
    } catch {
      break;
    }
  }

  return reassembleNarrationScript(normalizeNarrationLines(lines, parameters, shotPlan));
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

export async function generateVideoTaskDraftBundle(
  source: VideoTaskSource,
  parameters: VideoTaskParameterBundle,
): Promise<DraftBundleWithShotPlan> {
  const runtime = getTaskGenerationRuntime();

  if (!runtime.liveEnabled) {
    const fallbackPlan = buildFallbackShotPlan(source, parameters);
    const directorPlan = buildDirectorPlanFromTaskData({
      draftBundle: buildFallbackDraftBundleFromShotPlan(fallbackPlan, parameters),
      shotPlan: fallbackPlan,
      parameters,
    });
    return {
      draftBundle: buildDraftBundleFromDirectorPlan(directorPlan),
      shotPlan: fallbackPlan,
      directorPlan,
    };
  }

  // Step 1: Generate shot plan
  let shotPlan: ShotPlan | null = null;
  try {
    const shotPlanContent = await callTaskGenerationLlm({
      systemPrompt: buildShotPlanSystemPrompt(parameters.constraints),
      userContent: buildSourceSummary(source, parameters),
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

  // Step 2: Validate and repair
  let validationErrors = validateShotPlan(shotPlan, source, parameters);

  for (let attempt = 0; attempt < SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS && validationErrors.length > 0; attempt += 1) {
    try {
      const repairContent = await callTaskGenerationLlm({
        systemPrompt: buildShotPlanSystemPrompt(parameters.constraints),
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
      break;
    }
  }

  shotPlan.validationErrors = validationErrors;

  // Step 3: Generate prompts from shot plan
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

  // Step 3.5: Polish narration quality before timing repair
  draftBundle.narrationScript = await polishNarrationScriptQuality(
    draftBundle.narrationScript,
    source,
    parameters,
    shotPlan,
  );

  // Step 3.6: Check narration quality / timing and repair risky lines
  draftBundle.narrationScript = await repairNarrationIfOverLimit(draftBundle.narrationScript, parameters, shotPlan);

  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle,
    shotPlan,
    parameters,
  });

  return {
    draftBundle: buildDraftBundleFromDirectorPlan(directorPlan),
    shotPlan,
    directorPlan,
  };
}
