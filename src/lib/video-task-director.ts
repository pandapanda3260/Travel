import {
  buildNarrationScriptFromSubtitlePlan,
  getSegmentSubtitleEntry,
  normalizeSubtitlePlanSource,
  usesSegmentLevelSubtitleSource,
} from "./subtitle-plan-source";
import {
  countNarrationCharacters,
  getNarrationEmergencyTrimCharacters,
  getNarrationLengthGuidance,
  getNarrationRepairTriggerCharacters,
  isNarrationClearlyOverDuration,
  sanitizeNarrationText,
  trimNarrationToCharacterLimit,
} from "./narration";
import { buildIndexedBlockText, parseIndexedTextBlocks, type IndexedTextBlock } from "./indexed-text-blocks";
import {
  getRealPhotoMaterialBriefFromShotPlan,
  getRealPhotoNarrationBlueprintFromShotPlan,
  resolveRealPhotoShotNarrationSource,
  restoreRealPhotoNarrationFieldsForShot,
  restoreRealPhotoNarrationShotPlan,
} from "./real-photo-narration-source";
import { clampSeedanceSegmentDurationSeconds } from "./video-duration-constraints";
import { isSeedanceProvider } from "./video-provider-config";
import {
  computeVideoTaskStoryShotCount,
  getVideoTaskTypeProfile,
  type DirectorAudioCue,
  type DirectorRenderSegment,
  type DirectorStoryShot,
  type ShotPlan,
  type ShotPlanItem,
  type VideoTaskDirectorPlan,
  type VideoTaskDraftBundle,
  type VideoTaskParameterBundle,
  type VideoTaskRecord,
} from "./video-task-schema";

function normalizeInlineText(text: string | null | undefined) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNarrationText(text: string | null | undefined) {
  return sanitizeNarrationText(text);
}

function trimNarrationToDuration(text: string, durationSeconds: number, fallback: string) {
  const normalized =
    sanitizeNarrationText(text, { stripTerminalPunctuation: false }) ||
    sanitizeNarrationText(fallback, { stripTerminalPunctuation: false });
  if (!normalized) {
    return "";
  }

  const guidance = getNarrationLengthGuidance(durationSeconds);
  const repairTriggerCharacters = getNarrationRepairTriggerCharacters(durationSeconds);
  const emergencyTrimCharacters = getNarrationEmergencyTrimCharacters(durationSeconds);
  const charCount = countNarrationCharacters(normalized);

  if (charCount <= emergencyTrimCharacters && !isNarrationClearlyOverDuration(normalized, durationSeconds)) {
    return sanitizeNarrationText(normalized);
  }

  return trimNarrationToCharacterLimit(normalized, Math.max(guidance.maxCharacters, repairTriggerCharacters));
}

function mergeTexts(texts: Array<string | null | undefined>, fallback = "") {
  const normalized = texts.map((text) => normalizeInlineText(text)).filter(Boolean);

  if (!normalized.length) {
    return normalizeInlineText(fallback);
  }

  return normalized
    .join("，")
    .replace(/[，。！？；、]{2,}/g, "，")
    .trim();
}

function getClauseDedupKey(text: string) {
  return normalizeInlineText(text).replace(/[，。！？；、\s]+/g, "");
}

function joinUniqueTextClauses(clauses: Array<string | null | undefined>, fallback = "") {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const clause of clauses) {
    const normalizedClause = normalizeInlineText(clause);
    const key = getClauseDedupKey(normalizedClause);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalizedClause);
  }

  return mergeTexts(result, fallback);
}

function cleanupPromptClause(text: string) {
  return normalizeInlineText(text)
    .replace(/^[，。！？；、]+|[，。！？；、]+$/g, "")
    .replace(/[，。！？；、]{2,}/g, "，")
    .replace(/(?:与|和|及|、)+(?:$|(?=[，。！？；、]))/g, "")
    .replace(/^[与和及、]+|[与和及、]+$/g, "")
    .trim();
}

function splitPromptClauses(prompt: string) {
  return normalizeInlineText(prompt)
    .split(/[，；\n]+/)
    .map((clause) => cleanupPromptClause(clause))
    .filter(Boolean);
}

type CompoundSceneCategory = {
  key: string;
  label: string;
  summary: string;
  pattern: RegExp;
};

type FocusedScenePrompt = {
  sceneDescription: string;
  imagePrompt: string;
  videoPrompt: string;
};

const SINGLE_SCENE_RULE = "单一连续画面，只展示一个主要场景或空间，不要多区域拼接或上下分区";

const GENERIC_PROMPT_CLAUSE_PATTERN =
  /(竖构图|横构图|方构图|9:16|16:9|1:1|远景|中景|近景|特写|大全景|构图|三分法|对称|居中|引导线|暖色|冷色|色调|自然光|日光|晨光|夕阳|光线|光影|写实|摄影|电影级|纪实|高级感|质感|细节|通透|比例|透视|no text|no letters|no words|no watermark|no collage|no split screen|single continuous image|realistic perspective and proportions|无主角人物出镜|若有.*点缀|不要.*(拼接|分屏|文字|水印|摆拍|写真)|主体.*(景点|建筑|环境|设施)|人物.*(小比例|不居中|不抢主体|自然合理))/iu;

const COMPOUND_SCENE_CATEGORIES: CompoundSceneCategory[] = [
  {
    key: "hotel_room",
    label: "酒店客房空间",
    summary: "酒店客房空间，床品与休息区细节",
    pattern: /(客房|房间|卧室|大床|双床|套房|床铺|床品|床头|窗景|窗边|写字台|桌面|洗漱台|卫浴|沙发区)/u,
  },
  {
    key: "hotel_dining",
    label: "酒店早餐或夜宵餐区",
    summary: "酒店早餐或夜宵餐区，取餐台与餐食细节",
    pattern: /(早餐|夜宵|餐区|餐台|取餐台|餐盘|咖啡机|热食|粥品|自助餐|下午茶|茶点|用餐区)/u,
  },
  {
    key: "hotel_public",
    label: "酒店大堂或公共区域",
    summary: "酒店大堂或公共区域，前台与休息区氛围",
    pattern: /(大堂|前台|公区|公共区域|书吧|休息区|走廊|电梯厅|前厅|外立面|门头|入口)/u,
  },
  {
    key: "transport",
    label: "接送站与交通动线",
    summary: "接送站与交通动线，车辆与上客区场景",
    pattern: /(接机|接站|送机|送站|上车点|下车点|车辆|出租车|专车|机场|高铁站|车站|站台|候车|车门|行李|上客区)/u,
  },
  {
    key: "landmark",
    label: "单一景点或地标外景",
    summary: "单一景点或地标外景，环境与建筑主体清楚",
    pattern: /(故宫|长城|天安门|圆明园|颐和园|天坛|鸟巢|水立方|什刹海|地标|园林|广场|寺庙|博物馆|宫殿|古建筑|风光|湖景|山景|海景)/u,
  },
];

function getSceneCategoriesForText(text: string) {
  return COMPOUND_SCENE_CATEGORIES.filter((category) => category.pattern.test(text));
}

function isGenericPromptClause(clause: string) {
  const matchedCategories = getSceneCategoriesForText(clause);
  if (matchedCategories.length > 0) {
    return false;
  }

  return GENERIC_PROMPT_CLAUSE_PATTERN.test(clause) || matchedCategories.length === 0;
}

function collectGenericPromptClauses(prompt: string) {
  return splitPromptClauses(prompt).filter((clause) => isGenericPromptClause(clause));
}

function resolveShotText(
  blocks: IndexedTextBlock[],
  shotIndex: number,
  segmentIndex: number,
  segmentCount: number,
) {
  if (!blocks.length) {
    return "";
  }

  if (blocks.length === segmentCount) {
    return getPromptBlockForIndex(blocks, segmentIndex);
  }

  return getPromptBlockForIndex(blocks, shotIndex);
}

function buildShotImagePromptFromScope(input: {
  sceneDescription?: string | null;
  segmentPrompt?: string | null;
  shotScopedPrompt?: string | null;
  hasShotScopedPrompt: boolean;
}) {
  const sceneDescription = normalizeInlineText(input.sceneDescription);
  const shotScopedPrompt = normalizeInlineText(input.shotScopedPrompt);
  const segmentPrompt = normalizeInlineText(input.segmentPrompt);

  if (input.hasShotScopedPrompt && shotScopedPrompt) {
    return joinUniqueTextClauses([shotScopedPrompt, SINGLE_SCENE_RULE], shotScopedPrompt);
  }

  return joinUniqueTextClauses(
    [sceneDescription, ...collectGenericPromptClauses(segmentPrompt), SINGLE_SCENE_RULE],
    sceneDescription || segmentPrompt,
  );
}

function buildShotVideoPromptFromScope(input: {
  sceneDescription?: string | null;
  action?: string | null;
  emotion?: string | null;
  cameraMovement?: string | null;
  segmentPrompt?: string | null;
  shotScopedPrompt?: string | null;
  hasShotScopedPrompt: boolean;
}) {
  const shotScopedPrompt = normalizeInlineText(input.shotScopedPrompt);
  if (input.hasShotScopedPrompt && shotScopedPrompt) {
    return shotScopedPrompt;
  }

  const movement =
    normalizeInlineText(input.cameraMovement) && normalizeInlineText(input.cameraMovement) !== "auto"
      ? normalizeInlineText(input.cameraMovement)
      : "自然运镜";

  return joinUniqueTextClauses(
    [
      input.sceneDescription,
      input.action,
      movement,
      input.emotion,
      ...collectGenericPromptClauses(input.segmentPrompt ?? ""),
    ],
    shotScopedPrompt || normalizeInlineText(input.segmentPrompt),
  );
}

function getDetectedCompoundSceneCategories(prompt: string, sceneDescription: string) {
  const sourceText = mergeTexts([sceneDescription, prompt]);
  return COMPOUND_SCENE_CATEGORIES.map((category) => ({
    category,
    position: sourceText.search(category.pattern),
  }))
    .filter((entry) => entry.position >= 0)
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.category)
    .slice(0, 3);
}

function filterClauseForSceneCategory(
  clause: string,
  focusCategory: CompoundSceneCategory,
  detectedCategories: CompoundSceneCategory[],
) {
  if (isGenericPromptClause(clause)) {
    return clause;
  }

  const matchedCategories = detectedCategories.filter((category) => category.pattern.test(clause));
  if (!matchedCategories.some((category) => category.key === focusCategory.key)) {
    return "";
  }

  if (matchedCategories.length === 1) {
    return clause;
  }

  let filtered = clause;
  for (const category of matchedCategories) {
    if (category.key === focusCategory.key) {
      continue;
    }
    filtered = filtered.replace(category.pattern, "");
  }

  return cleanupPromptClause(filtered);
}

function buildFocusedScenePrompt(
  basePrompt: string,
  baseVideoPrompt: string,
  focusCategory: CompoundSceneCategory,
  detectedCategories: CompoundSceneCategory[],
): FocusedScenePrompt {
  const excludedLabels = detectedCategories
    .filter((category) => category.key !== focusCategory.key)
    .map((category) => category.label);
  const focusRule =
    excludedLabels.length > 0
      ? `当前子镜头只聚焦${focusCategory.label}，保持单一连续画面，不要与${excludedLabels.join("、")}同框拼接`
      : `当前子镜头只聚焦${focusCategory.label}，保持单一连续画面`;

  const focusedImageClauses = splitPromptClauses(basePrompt)
    .map((clause) => filterClauseForSceneCategory(clause, focusCategory, detectedCategories))
    .filter(Boolean);
  const focusedVideoClauses = splitPromptClauses(baseVideoPrompt)
    .map((clause) => filterClauseForSceneCategory(clause, focusCategory, detectedCategories))
    .filter(Boolean);

  return {
    sceneDescription: focusCategory.summary,
    imagePrompt: joinUniqueTextClauses([focusCategory.summary, ...focusedImageClauses, focusRule], basePrompt),
    videoPrompt: joinUniqueTextClauses([focusCategory.summary, ...focusedVideoClauses, focusRule], baseVideoPrompt),
  };
}

function distributeExpandedShotDurations(totalDurationSeconds: number, parts: number) {
  if (parts <= 1) {
    return [Number(totalDurationSeconds.toFixed(2))];
  }

  if (totalDurationSeconds < parts * 0.8) {
    return null;
  }

  const durations: number[] = [];
  let remaining = totalDurationSeconds;

  for (let index = 0; index < parts; index += 1) {
    const remainingParts = parts - index;
    if (remainingParts === 1) {
      durations.push(Number(remaining.toFixed(2)));
      break;
    }

    const rawDuration = Math.max(0.8, remaining / remainingParts);
    const duration = Number(rawDuration.toFixed(2));
    durations.push(duration);
    remaining -= duration;
  }

  return durations;
}

function expandCompoundSceneStoryShots(
  shots: DirectorStoryShot[],
  segmentMode: VideoTaskParameterBundle["video"]["segmentMode"],
) {
  if (segmentMode !== "multi_shot_montage") {
    return shots;
  }

  return shots.flatMap((shot) => {
    if (shot.requiresLipSync) {
      return [shot];
    }

    const detectedCategories = getDetectedCompoundSceneCategories(shot.imagePrompt, shot.sceneDescription);
    if (detectedCategories.length < 2) {
      return [shot];
    }

    const expandedPrompts = detectedCategories.map((category) =>
      buildFocusedScenePrompt(shot.imagePrompt, shot.videoPrompt, category, detectedCategories),
    );
    const durations = distributeExpandedShotDurations(shot.durationSeconds, expandedPrompts.length);

    if (!durations || durations.length !== expandedPrompts.length) {
      return [shot];
    }

    return expandedPrompts.map((focusedPrompt, index) => ({
      ...shot,
      shotId: index === 0 ? shot.shotId : `${shot.shotId}-${index + 1}`,
      shotIndex: index === 0 ? shot.shotIndex : Number((shot.shotIndex + index / 10).toFixed(2)),
      title: index === 0 ? shot.title : `${shot.title}-${index + 1}`,
      durationSeconds: durations[index] ?? shot.durationSeconds,
      sceneDescription: focusedPrompt.sceneDescription,
      imagePrompt: focusedPrompt.imagePrompt,
      videoPrompt: focusedPrompt.videoPrompt,
      hasVoice: index === 0 ? shot.hasVoice : false,
      hasSubtitle: index === 0 ? shot.hasSubtitle : false,
      requiresLipSync: index === 0 ? shot.requiresLipSync : false,
      narrationText: index === 0 ? shot.narrationText : "",
      subtitleText: index === 0 ? shot.subtitleText : "",
    }));
  });
}

function getPromptBlockForIndex(blocks: IndexedTextBlock[], index: number) {
  return blocks.find((block) => block.index === index)?.text ?? blocks[index - 1]?.text ?? blocks[0]?.text ?? "";
}

function resolveSegmentText(blocks: IndexedTextBlock[], segmentIndex: number, shotIndexes: number[], segmentCount: number) {
  if (!blocks.length) {
    return "";
  }

  if (blocks.length === segmentCount) {
    return getPromptBlockForIndex(blocks, segmentIndex);
  }
  return mergeTexts(
    shotIndexes.map((shotIndex) => getPromptBlockForIndex(blocks, shotIndex)),
    getPromptBlockForIndex(blocks, segmentIndex),
  );
}

function getSegmentDurationSeconds(parameters: VideoTaskParameterBundle["video"], segmentIndex: number, shotPlanItems?: ShotPlanItem[]) {
  if (shotPlanItems && shotPlanItems.length > 0) {
    const segmentShots = shotPlanItems.filter((item) => (item.segmentIndex ?? 0) === segmentIndex);
    if (segmentShots.length > 0) {
      const sumDuration = segmentShots.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
      if (sumDuration > 0) {
        return isSeedanceProvider() ? clampSeedanceSegmentDurationSeconds(sumDuration) : sumDuration;
      }
    }
  }

  if (parameters.segmentMode === "hybrid_intro_plus_montage" && segmentIndex === 1) {
    const raw = Math.max(1, parameters.introSegmentDurationSeconds ?? Math.min(3, parameters.durationSeconds));
    return isSeedanceProvider() ? clampSeedanceSegmentDurationSeconds(raw) : raw;
  }

  const raw = Math.max(1, parameters.durationSeconds);
  return isSeedanceProvider() ? clampSeedanceSegmentDurationSeconds(raw) : raw;
}

function buildSegmentShotGroupsFromShotPlan(shotPlanItems: ShotPlanItem[]): Array<{ segmentIndex: number; shotIndexes: number[] }> | null {
  const hasSegmentInfo = shotPlanItems.some((item) => item.segmentId || item.segmentIndex);
  if (!hasSegmentInfo || shotPlanItems.length === 0) return null;

  const groupMap = new Map<number, number[]>();
  for (const item of shotPlanItems) {
    const segIdx = item.segmentIndex ?? 1;
    const existing = groupMap.get(segIdx) ?? [];
    existing.push(item.shotIndex);
    groupMap.set(segIdx, existing);
  }

  return Array.from(groupMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([segmentIndex, shotIndexes]) => ({ segmentIndex, shotIndexes: shotIndexes.sort((a, b) => a - b) }));
}

function buildSegmentShotGroups(parameters: VideoTaskParameterBundle["video"], shotPlanItems?: ShotPlanItem[]) {
  if (shotPlanItems) {
    const fromPlan = buildSegmentShotGroupsFromShotPlan(shotPlanItems);
    if (fromPlan && fromPlan.length > 0) return fromPlan;
  }

  const segmentCount = Math.max(1, parameters.segmentCount);
  const shotsPerSegment = Math.max(1, parameters.storyShotsPerSegment || 1);

  if (parameters.segmentMode === "single_speaking" || parameters.segmentMode === "single_action") {
    return Array.from({ length: segmentCount }, (_, index) => ({
      segmentIndex: index + 1,
      shotIndexes: [index + 1],
    }));
  }

  const groups: Array<{ segmentIndex: number; shotIndexes: number[] }> = [];
  let shotCursor = 1;
  for (let segmentIndex = 1; segmentIndex <= segmentCount; segmentIndex += 1) {
    const segmentShotCount =
      parameters.segmentMode === "hybrid_intro_plus_montage" && segmentIndex === 1 ? 1 : shotsPerSegment;
    const shotIndexes = Array.from({ length: segmentShotCount }, () => {
      const current = shotCursor;
      shotCursor += 1;
      return current;
    });
    groups.push({ segmentIndex, shotIndexes });
  }
  return groups;
}

function getSegmentModeForIndex(parameters: VideoTaskParameterBundle["video"], segmentIndex: number) {
  if (parameters.segmentMode === "hybrid_intro_plus_montage" && segmentIndex === 1) {
    return "single_speaking" as const;
  }
  if (parameters.segmentMode === "hybrid_intro_plus_montage") {
    return "multi_shot_montage" as const;
  }
  return parameters.segmentMode;
}

function getSegmentFlags(parameters: VideoTaskParameterBundle["video"]) {
  const profile = getVideoTaskTypeProfile(parameters.videoType);
  return {
    hasTalent: profile.hasTalent,
    talentCaptureMode: profile.talentCaptureMode,
    hasVoice: profile.hasVoice,
    hasSubtitle: profile.hasSubtitle,
    requiresLipSync: profile.requiresLipSync,
  };
}

function buildFallbackStoryShot(input: {
  shotIndex: number;
  segmentId: string;
  segmentIndex: number;
  durationSeconds: number;
  parameters: VideoTaskParameterBundle["video"];
  planItem?: ShotPlanItem | null;
  imagePrompt: string;
  videoPrompt: string;
  narrationText: string;
}) {
  const profile = getVideoTaskTypeProfile(input.parameters.videoType);
  const flags = getSegmentFlags(input.parameters);
  const sceneDescription =
    normalizeInlineText(input.planItem?.sceneDescription) ||
    normalizeInlineText(input.imagePrompt) ||
    `围绕${input.segmentIndex}号片段的主题画面`;
  const narrationHint =
    normalizeInlineText(input.planItem?.narrationHint) ||
    normalizeInlineText(input.narrationText) ||
    `${input.segmentIndex}号片段亮点`;
  const narrationText = normalizeNarrationText(input.planItem?.sourceSpokenText || input.narrationText);
  const subtitleText =
    input.planItem?.hasVoice ?? flags.hasVoice
      ? narrationText
      : normalizeNarrationText(input.planItem?.sourceSubtitleText || input.narrationText);

  return {
    shotId: `shot-${input.shotIndex}`,
    shotIndex: input.shotIndex,
    segmentId: input.segmentId,
    segmentIndex: input.segmentIndex,
    title: `镜头 ${input.shotIndex}`,
    sceneType: input.planItem?.sceneType,
    purpose: input.planItem?.purpose ?? (input.shotIndex === 1 ? "hook" : "experience"),
    location: input.planItem?.location ?? "",
    hasCharacters: input.planItem?.hasCharacters ?? flags.hasTalent,
    characters: input.planItem?.characters ?? [],
    hasTalent: input.planItem?.hasTalent ?? flags.hasTalent,
    talentCaptureMode: input.planItem?.talentCaptureMode ?? flags.talentCaptureMode,
    hasVoice: input.planItem?.hasVoice ?? flags.hasVoice,
    hasSubtitle: input.planItem?.hasSubtitle ?? flags.hasSubtitle,
    requiresLipSync: input.planItem?.requiresLipSync ?? flags.requiresLipSync,
    action: input.planItem?.action ?? (profile.hasTalent ? "人物自然互动表达" : "景色与细节推进"),
    emotion: input.planItem?.emotion ?? "自然松弛",
    cameraMovement: input.planItem?.cameraMovement ?? input.parameters.cameraControl,
    durationSeconds: Math.max(0.8, input.durationSeconds),
    sceneDescription,
    contentDescription: input.planItem?.contentDescription,
    narrationHint,
    imagePrompt: normalizeInlineText(input.planItem?.img2imgPrompt) || normalizeInlineText(input.imagePrompt) || sceneDescription,
    videoPrompt: normalizeInlineText(input.planItem?.i2vPrompt) || normalizeInlineText(input.videoPrompt) || sceneDescription,
    narrationText,
    subtitleText,
    startAtSeconds: input.planItem?.startAtSeconds,
    endAtSeconds: input.planItem?.endAtSeconds,
    functionTag: input.planItem?.functionTag,
    sellingPointType: input.planItem?.sellingPointType,
    commercialPhase: input.planItem?.commercialPhase ?? null,
    commercialIntent: input.planItem?.commercialIntent ?? null,
    evidenceTarget: input.planItem?.evidenceTarget ?? null,
    conversionRole: input.planItem?.conversionRole ?? null,
    narrationBeatId: input.planItem?.narrationBeatId ?? null,
    narrationPhase: input.planItem?.narrationPhase ?? null,
    narrationIntent: input.planItem?.narrationIntent ?? null,
    sourceSpokenText: input.planItem?.sourceSpokenText ?? null,
    sourceSubtitleText: input.planItem?.sourceSubtitleText ?? null,
    narrationEstimatedDurationSeconds: input.planItem?.narrationEstimatedDurationSeconds ?? null,
    targetMaterialIds: input.planItem?.targetMaterialIds,
    shotScale: input.planItem?.shotScale,
    compositionHint: input.planItem?.compositionHint,
    rhythmTag: input.planItem?.rhythmTag,
    mood: input.planItem?.mood,
    sellingPointTags: input.planItem?.sellingPointTags,
    assetId: input.planItem?.assetId ?? null,
    assetSourceType: input.planItem?.assetSourceType ?? null,
    assetSubjectSummary: input.planItem?.assetSubjectSummary ?? null,
    sourceMaterialId: input.planItem?.sourceMaterialId ?? null,
    sourceStartAtSeconds: input.planItem?.sourceStartAtSeconds ?? null,
    sourceEndAtSeconds: input.planItem?.sourceEndAtSeconds ?? null,
    sourceTimeRangeLabel: input.planItem?.sourceTimeRangeLabel ?? null,
    referenceImageUrl: input.planItem?.referenceImageUrl ?? null,
    generationMode: input.planItem?.generationMode,
    sourceTrace: input.planItem?.sourceTrace ?? null,
    needImageEnhancement: input.planItem?.needImageEnhancement ?? false,
    needImageToVideo: input.planItem?.needImageToVideo ?? true,
    isAtmosphereInsert: input.planItem?.isAtmosphereInsert ?? false,
    img2imgPrompt: input.planItem?.img2imgPrompt ?? null,
    i2vPrompt: input.planItem?.i2vPrompt ?? null,
    visual: input.planItem?.visual,
    subject: input.planItem?.subject,
    cinematography: input.planItem?.cinematography,
    structure: input.planItem?.structure,
  } satisfies DirectorStoryShot;
}

export function buildDirectorPlanFromTaskData(input: {
  draftBundle: VideoTaskDraftBundle;
  shotPlan?: ShotPlan | null;
  directorPlan?: VideoTaskDirectorPlan | null;
  parameters: VideoTaskParameterBundle;
  forceRebuild?: boolean;
}) {
  const sourceShotPlan = input.shotPlan ? restoreRealPhotoNarrationShotPlan(input.shotPlan) : input.shotPlan;
  if (!input.forceRebuild && input.directorPlan?.renderSegments?.length && input.directorPlan.storyShots?.length) {
    const realPhotoBlueprint = getRealPhotoNarrationBlueprintFromShotPlan(sourceShotPlan);
    const canReuseExistingDirectorPlan =
      !realPhotoBlueprint ||
      input.directorPlan.storyShots.every((shot) => {
        if (!shot.hasVoice && !shot.hasSubtitle) {
          return true;
        }
        const source = resolveRealPhotoShotNarrationSource(shot, sourceShotPlan);
        if (!source.spokenText) {
          return true;
        }
        return normalizeNarrationText(shot.sourceSpokenText || shot.narrationText) === normalizeNarrationText(source.spokenText);
      });
    if (canReuseExistingDirectorPlan) {
      return input.directorPlan;
    }
  }

  const profile = getVideoTaskTypeProfile(input.parameters.video.videoType);
  const segmentCount = Math.max(1, input.parameters.video.segmentCount);
  const storyShotCount = Math.max(
    1,
    input.parameters.video.storyShotCount ||
      computeVideoTaskStoryShotCount({
        videoType: input.parameters.video.videoType,
        segmentCount,
        storyShotsPerSegment: input.parameters.video.storyShotsPerSegment,
      }),
  );
  const shotPlanItems = [...(sourceShotPlan?.shots ?? [])].sort((left, right) => left.shotIndex - right.shotIndex);
  const segmentGroups = buildSegmentShotGroups(
    { ...input.parameters.video, storyShotCount },
    shotPlanItems.length > 0 ? shotPlanItems : undefined,
  );

  const imageBlocks = parseIndexedTextBlocks(
    input.draftBundle.textToImagePrompt,
    Math.max(segmentCount, storyShotCount),
    "片段",
  );
  const videoBlocks = parseIndexedTextBlocks(
    input.draftBundle.imageToVideoPrompt,
    Math.max(segmentCount, storyShotCount),
    "片段",
  );
  const narrationBlocks = parseIndexedTextBlocks(input.draftBundle.narrationScript, storyShotCount, "镜头");
  const normalizedShotPlan = sourceShotPlan
    ? normalizeSubtitlePlanSource(sourceShotPlan, input.parameters.video.videoType)
    : sourceShotPlan;

  const storyShots: DirectorStoryShot[] = [];
  const renderSegments: DirectorRenderSegment[] = [];
  const audioCues: DirectorAudioCue[] = [];
  let accumulatedSeconds = 0;

  for (const group of segmentGroups) {
    const segmentIndex = group.segmentIndex;
    const segmentId = `segment-${segmentIndex}`;
    const segmentDurationSeconds = getSegmentDurationSeconds(input.parameters.video, segmentIndex, shotPlanItems);
    const segmentMode = getSegmentModeForIndex(input.parameters.video, segmentIndex);
    const segmentFlags = getSegmentFlags(input.parameters.video);
    const segmentImagePrompt = resolveSegmentText(imageBlocks, segmentIndex, group.shotIndexes, segmentCount);
    const segmentVideoPrompt = resolveSegmentText(videoBlocks, segmentIndex, group.shotIndexes, segmentCount);
    const hasShotScopedImagePrompt = imageBlocks.length > segmentCount;
    const hasShotScopedVideoPrompt = videoBlocks.length > segmentCount;

    const shotDurationSeconds = Math.max(
      0.8,
      Number((segmentDurationSeconds / Math.max(1, group.shotIndexes.length)).toFixed(2)),
    );

    const segmentNarrationBlock = resolveSegmentText(narrationBlocks, segmentIndex, group.shotIndexes, segmentCount);
    const voicedShotCount = group.shotIndexes.filter((shotIndex) => {
      const planItem = shotPlanItems.find((item) => item.shotIndex === shotIndex) ?? null;
      const shotHasVoice = planItem?.hasVoice ?? segmentFlags.hasVoice;
      const shotHasSubtitle = planItem?.hasSubtitle ?? (segmentFlags.hasSubtitle && shotHasVoice);
      return shotHasVoice || shotHasSubtitle;
    }).length;
    let segmentNarrationAssigned = false;

    const rawSegmentShots = group.shotIndexes.map((shotIndex) => {
      const planItem = shotPlanItems.find((item) => item.shotIndex === shotIndex) ?? null;
      const shotHasVoice = planItem?.hasVoice ?? segmentFlags.hasVoice;
      const shotHasSubtitle = planItem?.hasSubtitle ?? (segmentFlags.hasSubtitle && shotHasVoice);
      const shotRequiresLipSync = planItem?.requiresLipSync ?? (shotHasVoice ? segmentFlags.requiresLipSync : false);
      const shotImagePrompt = buildShotImagePromptFromScope({
        sceneDescription: planItem?.sceneDescription,
        segmentPrompt: segmentImagePrompt,
        shotScopedPrompt: resolveShotText(imageBlocks, shotIndex, segmentIndex, segmentCount),
        hasShotScopedPrompt: hasShotScopedImagePrompt,
      });
      const shotVideoPrompt = buildShotVideoPromptFromScope({
        sceneDescription: planItem?.sceneDescription,
        action: planItem?.action,
        emotion: planItem?.emotion,
        cameraMovement: planItem?.cameraMovement,
        segmentPrompt: segmentVideoPrompt,
        shotScopedPrompt: resolveShotText(videoBlocks, shotIndex, segmentIndex, segmentCount),
        hasShotScopedPrompt: hasShotScopedVideoPrompt,
      });
      let rawShotNarrationText = "";
      if (shotHasVoice || shotHasSubtitle) {
        if (planItem?.sourceSpokenText?.trim()) {
          rawShotNarrationText = planItem.sourceSpokenText;
        } else if (!segmentNarrationAssigned && voicedShotCount <= 1) {
          rawShotNarrationText = segmentNarrationBlock;
          segmentNarrationAssigned = true;
        }
      }
      const fallbackNarration =
        normalizeInlineText(planItem?.sourceSubtitleText) ||
        normalizeInlineText(planItem?.narrationHint) ||
        `镜头${shotIndex}亮点`;
      const shotNarrationText =
        shotHasVoice || shotHasSubtitle
          ? trimNarrationToDuration(
              rawShotNarrationText || fallbackNarration,
              planItem?.narrationEstimatedDurationSeconds && planItem.narrationEstimatedDurationSeconds > 0
                ? planItem.narrationEstimatedDurationSeconds
                : planItem?.durationSeconds && planItem.durationSeconds > 0
                ? planItem.durationSeconds
                : shotDurationSeconds,
              fallbackNarration,
            )
          : "";

      return buildFallbackStoryShot({
        shotIndex,
        segmentId,
        segmentIndex,
        durationSeconds:
          planItem?.durationSeconds && planItem.durationSeconds > 0 ? planItem.durationSeconds : shotDurationSeconds,
        parameters: input.parameters.video,
        planItem: planItem
          ? {
              ...planItem,
              hasVoice: shotHasVoice,
              hasSubtitle: shotHasSubtitle,
              requiresLipSync: shotRequiresLipSync,
            }
          : {
              shotIndex,
              purpose: shotIndex === 1 ? "hook" : "experience",
              location: "",
              hasCharacters: segmentFlags.hasTalent,
              characters: [],
              hasTalent: segmentFlags.hasTalent,
              talentCaptureMode: segmentFlags.talentCaptureMode,
              hasVoice: shotHasVoice,
              hasSubtitle: shotHasSubtitle,
              requiresLipSync: shotRequiresLipSync,
              action: "",
              emotion: "",
              cameraMovement: input.parameters.video.cameraControl,
              durationSeconds: shotDurationSeconds,
              sceneDescription: "",
              narrationHint: fallbackNarration,
            },
        imagePrompt: shotImagePrompt,
        videoPrompt: shotVideoPrompt,
        narrationText: shotNarrationText,
      });
    });
    const segmentShots = expandCompoundSceneStoryShots(rawSegmentShots, segmentMode);
    storyShots.push(...segmentShots);

    const segmentNarrationParts = segmentShots
      .filter((shot) => shot.hasVoice || shot.hasSubtitle)
      .map((shot) => shot.narrationText || shot.subtitleText)
      .filter(Boolean);
    const segmentFallbackNarration = shotPlanItems
      .filter((item) => group.shotIndexes.includes(item.shotIndex))
      .map((item) => item.narrationHint)
      .filter(Boolean)
      .join("，");
    const actualSegmentDuration = segmentShots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
    const effectiveSegmentDuration = actualSegmentDuration > 0 ? actualSegmentDuration : segmentDurationSeconds;
    const subtitlePlanEntry = getSegmentSubtitleEntry(normalizedShotPlan?.subtitlePlan, {
      segmentId,
      segmentIndex,
    });
    const useSegmentSubtitleSource = usesSegmentLevelSubtitleSource(input.parameters.video.videoType) && Boolean(subtitlePlanEntry);
    const normalizedSegmentNarrationBlock = useSegmentSubtitleSource
      ? normalizeNarrationText(subtitlePlanEntry?.text)
      : normalizeNarrationText(segmentNarrationBlock);
    const segmentNarrationText =
      normalizedSegmentNarrationBlock
        ? trimNarrationToDuration(
            normalizedSegmentNarrationBlock,
            effectiveSegmentDuration || segmentDurationSeconds,
            segmentFallbackNarration || `片段${segmentIndex}亮点`,
          )
        : segmentNarrationParts.length > 0
        ? trimNarrationToDuration(
            mergeTexts(segmentNarrationParts),
            effectiveSegmentDuration || segmentDurationSeconds,
            segmentFallbackNarration || `片段${segmentIndex}亮点`,
          )
        : "";
    const segmentHasVoice = segmentShots.some((shot) => shot.hasVoice);
    const segmentHasSubtitle = segmentShots.some((shot) => shot.hasSubtitle);
    const segmentRequiresLipSync = segmentShots.some((shot) => shot.requiresLipSync);
    const cueAnchorShot = segmentShots.find((shot) => shot.hasVoice || shot.hasSubtitle) ?? segmentShots[0] ?? null;
    const useSegmentLevelNarration =
      !getRealPhotoNarrationBlueprintFromShotPlan(normalizedShotPlan) &&
      (voicedShotCount > 1 || Boolean(normalizedSegmentNarrationBlock));

    const multiPrompt =
      segmentMode === "multi_shot_montage"
        ? segmentShots.map((shot, shotOffset) => ({
            index: shotOffset + 1,
            prompt: normalizeInlineText(shot.videoPrompt) || `${shot.sceneDescription}，自然运镜`,
            duration: shot.durationSeconds,
          }))
        : [];

    const renderSegment: DirectorRenderSegment = {
      segmentId,
      segmentIndex,
      title: `片段 ${segmentIndex}`,
      segmentMode,
      shotIds: segmentShots.map((shot) => shot.shotId),
      shotIndexes: segmentShots.map((shot) => shot.shotIndex),
      durationSeconds: effectiveSegmentDuration,
      hasTalent: segmentFlags.hasTalent,
      talentCaptureMode: segmentFlags.talentCaptureMode,
      hasVoice: segmentHasVoice,
      hasSubtitle: segmentHasSubtitle,
      requiresLipSync: segmentRequiresLipSync,
      multiShot: segmentMode === "multi_shot_montage",
      shotType: segmentMode === "multi_shot_montage" ? input.parameters.video.shotType : "customize",
      imagePrompt: normalizeInlineText(segmentImagePrompt) || mergeTexts(segmentShots.map((shot) => shot.imagePrompt)),
      videoPrompt: normalizeInlineText(segmentVideoPrompt) || mergeTexts(segmentShots.map((shot) => shot.videoPrompt)),
      multiPrompt,
      narrationText: segmentNarrationText,
      subtitleText: segmentNarrationText,
      note:
        profile.key === "agency_creative_beat_mix" && segmentIndex === 1
          ? "前 4 秒左右读稿开场"
          : segmentMode === "multi_shot_montage"
            ? `${segmentShots.length} 个镜头合成一个生成片段`
            : "单片段表达",
    };
    renderSegments.push(renderSegment);

    let shotAccumulatedSeconds = accumulatedSeconds;
    if (
      !getRealPhotoNarrationBlueprintFromShotPlan(normalizedShotPlan) &&
      useSegmentSubtitleSource &&
      (segmentHasVoice || segmentHasSubtitle)
    ) {
      audioCues.push({
        cueId: `cue-segment-${segmentIndex}`,
        cueIndex: audioCues.length + 1,
        shotId: cueAnchorShot?.shotId ?? null,
        shotIndex: cueAnchorShot?.shotIndex ?? segmentIndex,
        targetSegmentId: renderSegment.segmentId,
        targetSegmentIndex: renderSegment.segmentIndex,
        startAtSeconds: subtitlePlanEntry?.startAtSeconds ?? accumulatedSeconds,
        plannedDurationSeconds: subtitlePlanEntry?.durationSeconds ?? effectiveSegmentDuration,
        audioDurationSeconds: null,
        hasVoice: segmentHasVoice,
        hasSubtitle: segmentHasSubtitle,
        requiresLipSync: segmentRequiresLipSync,
        voiceId: null,
        narrationText: segmentNarrationText,
        subtitleText: segmentHasVoice ? segmentNarrationText : cueAnchorShot?.sourceSubtitleText || segmentNarrationText,
        narrationBeatId: cueAnchorShot?.narrationBeatId ?? null,
        narrationPhase: cueAnchorShot?.narrationPhase ?? null,
        sourceSpokenText: cueAnchorShot?.sourceSpokenText ?? segmentNarrationText,
        sourceSubtitleText: segmentHasVoice ? segmentNarrationText : cueAnchorShot?.sourceSubtitleText ?? segmentNarrationText,
        audioUrl: null,
        words: [],
      });
    } else {
      for (const shot of segmentShots) {
        if (shot.hasVoice || shot.hasSubtitle) {
          const isCueAnchor = cueAnchorShot?.shotId === shot.shotId;
          const cueNarrationText =
            isCueAnchor && useSegmentLevelNarration
              ? segmentNarrationText
              : useSegmentLevelNarration
                ? ""
                : shot.narrationText || "";
          const cueSubtitleText =
            isCueAnchor && useSegmentLevelNarration
              ? shot.hasVoice
                ? segmentNarrationText
                : cueAnchorShot?.sourceSubtitleText || segmentNarrationText
              : useSegmentLevelNarration
                ? ""
                : shot.hasVoice
                  ? cueNarrationText
                  : shot.sourceSubtitleText || shot.subtitleText || cueNarrationText;
          audioCues.push({
            cueId: `cue-shot-${shot.shotIndex}`,
            cueIndex: audioCues.length + 1,
            shotId: shot.shotId,
            shotIndex: shot.shotIndex,
            targetSegmentId: renderSegment.segmentId,
            targetSegmentIndex: renderSegment.segmentIndex,
            startAtSeconds: shotAccumulatedSeconds,
            plannedDurationSeconds: shot.durationSeconds,
            audioDurationSeconds: null,
            hasVoice: shot.hasVoice,
            hasSubtitle: shot.hasSubtitle,
            requiresLipSync: shot.requiresLipSync,
            voiceId: null,
            narrationText: cueNarrationText,
            subtitleText: cueSubtitleText,
            narrationBeatId: shot.narrationBeatId ?? null,
            narrationPhase: shot.narrationPhase ?? null,
            sourceSpokenText: shot.sourceSpokenText ?? cueNarrationText,
            sourceSubtitleText: shot.sourceSubtitleText ?? cueSubtitleText,
            audioUrl: null,
            words: [],
          });
        }
        shotAccumulatedSeconds += shot.durationSeconds;
      }
    }

    accumulatedSeconds += effectiveSegmentDuration;
  }

  const subtitlePlan = normalizedShotPlan?.subtitlePlan ?? undefined;

  return {
    videoType: input.parameters.video.videoType,
    segmentMode: input.parameters.video.segmentMode,
    totalDurationSeconds: accumulatedSeconds,
    storyShots,
    renderSegments,
    audioCues,
    subtitlePlan,
    storyboard: normalizedShotPlan?.storyboard,
    legacyMirrored: true,
  } satisfies VideoTaskDirectorPlan;
}

export function buildDraftBundleFromDirectorPlan(plan: VideoTaskDirectorPlan): VideoTaskDraftBundle {
  const textToImagePrompt = buildIndexedBlockText(
    "片段",
    plan.renderSegments.map((segment) => ({
      index: segment.segmentIndex,
      text: segment.imagePrompt || segment.videoPrompt || segment.note || `围绕片段 ${segment.segmentIndex} 的视觉参考`,
    })),
  );
  const imageToVideoPrompt = buildIndexedBlockText(
    "片段",
    plan.renderSegments.map((segment) => ({
      index: segment.segmentIndex,
      text:
        segment.segmentMode === "multi_shot_montage"
          ? `${segment.videoPrompt}。片段内部包含 ${segment.multiPrompt.length || segment.shotIds.length} 个镜头的连续切换。`
          : segment.videoPrompt || segment.note || `围绕片段 ${segment.segmentIndex} 的动作表达`,
    })),
  );

  const useSegmentNarration = usesSegmentLevelSubtitleSource(plan.videoType) || isSeedanceProvider();
  const subtitleDrivenNarrationScript = useSegmentNarration
    ? buildNarrationScriptFromSubtitlePlan(
        {
          shots: plan.storyShots.map((shot) => ({
            shotId: shot.shotId,
            shotIndex: shot.shotIndex,
            segmentId: shot.segmentId,
            segmentIndex: shot.segmentIndex,
            purpose: shot.purpose,
            location: shot.location,
            hasCharacters: shot.hasCharacters,
            characters: shot.characters,
            hasTalent: shot.hasTalent,
            talentCaptureMode: shot.talentCaptureMode,
            hasVoice: shot.hasVoice,
            hasSubtitle: shot.hasSubtitle,
            requiresLipSync: shot.requiresLipSync,
            action: shot.action,
            emotion: shot.emotion,
            cameraMovement: shot.cameraMovement,
            durationSeconds: shot.durationSeconds,
            sceneDescription: shot.sceneDescription,
            narrationHint: shot.narrationHint,
            narrationText: shot.narrationText,
            subtitleText: shot.subtitleText,
            commercialPhase: shot.commercialPhase ?? null,
            commercialIntent: shot.commercialIntent ?? null,
            evidenceTarget: shot.evidenceTarget ?? null,
            conversionRole: shot.conversionRole ?? null,
          })),
          globalStyle: "",
          totalDurationSeconds: plan.totalDurationSeconds,
          validationErrors: [],
          subtitlePlan: plan.subtitlePlan,
        },
        plan.videoType,
      )
    : "";
  const narrationScript = subtitleDrivenNarrationScript || (useSegmentNarration
    ? buildIndexedBlockText(
        "片段",
        plan.renderSegments.map((segment) => ({
          index: segment.segmentIndex,
          text: segment.hasVoice || segment.hasSubtitle
            ? normalizeNarrationText(segment.narrationText || segment.subtitleText)
            : "",
        })),
      )
    : buildIndexedBlockText(
        "镜头",
        plan.storyShots.map((shot) => ({
          index: shot.shotIndex,
          text: shot.hasVoice || shot.hasSubtitle ? normalizeNarrationText(shot.narrationText || shot.subtitleText) : "",
        })),
      ));

  return {
    textToImagePrompt,
    imageToVideoPrompt,
    narrationScript,
  };
}

export function buildShotPlanFromDirectorPlan(plan: VideoTaskDirectorPlan, base?: ShotPlan | null) {
  const restoreSourcePlan = base ?? {
    shots: [],
    storyboard: plan.storyboard,
    realPhotoNarrationBlueprint: plan.storyboard?.realPhotoNarrationBlueprint,
    realPhotoMaterialBrief: plan.storyboard?.realPhotoMaterialBrief,
  };
  const realPhotoNarrationBlueprint = getRealPhotoNarrationBlueprintFromShotPlan(restoreSourcePlan);
  const realPhotoMaterialBrief = getRealPhotoMaterialBriefFromShotPlan(restoreSourcePlan);

  return {
    shots: plan.storyShots.map((shot) =>
      restoreRealPhotoNarrationFieldsForShot(
        {
          shotId: shot.shotId,
          shotIndex: shot.shotIndex,
          segmentId: shot.segmentId,
          segmentIndex: shot.segmentIndex,
          sceneType: shot.sceneType,
          purpose: shot.purpose,
          location: shot.location,
          hasCharacters: shot.hasCharacters,
          characters: shot.characters,
          hasTalent: shot.hasTalent,
          talentCaptureMode: shot.talentCaptureMode,
          hasVoice: shot.hasVoice,
          hasSubtitle: shot.hasSubtitle,
          requiresLipSync: shot.requiresLipSync,
          action: shot.action,
          emotion: shot.emotion,
          cameraMovement: shot.cameraMovement,
          durationSeconds: shot.durationSeconds,
          sceneDescription: shot.sceneDescription,
          contentDescription: shot.contentDescription,
          narrationHint: shot.narrationHint,
          functionTag: shot.functionTag,
          sellingPointType: shot.sellingPointType,
          commercialPhase: shot.commercialPhase ?? null,
          commercialIntent: shot.commercialIntent ?? null,
          evidenceTarget: shot.evidenceTarget ?? null,
          conversionRole: shot.conversionRole ?? null,
          narrationBeatId: shot.narrationBeatId ?? null,
          narrationPhase: shot.narrationPhase ?? null,
          narrationIntent: shot.narrationIntent ?? null,
          sourceSpokenText: shot.sourceSpokenText ?? null,
          sourceSubtitleText: shot.sourceSubtitleText ?? null,
          narrationEstimatedDurationSeconds: shot.narrationEstimatedDurationSeconds ?? null,
          targetMaterialIds: shot.targetMaterialIds,
          shotScale: shot.shotScale,
          compositionHint: shot.compositionHint,
          rhythmTag: shot.rhythmTag,
          mood: shot.mood,
          sellingPointTags: shot.sellingPointTags,
          assetId: shot.assetId ?? null,
          assetSourceType: shot.assetSourceType ?? null,
          assetSubjectSummary: shot.assetSubjectSummary ?? null,
          sourceMaterialId: shot.sourceMaterialId ?? null,
          sourceStartAtSeconds: shot.sourceStartAtSeconds ?? null,
          sourceEndAtSeconds: shot.sourceEndAtSeconds ?? null,
          sourceTimeRangeLabel: shot.sourceTimeRangeLabel ?? null,
          referenceImageUrl: shot.referenceImageUrl ?? null,
          generationMode: shot.generationMode,
          sourceTrace: shot.sourceTrace ?? null,
          needImageEnhancement: shot.needImageEnhancement ?? false,
          needImageToVideo: shot.needImageToVideo ?? true,
          isAtmosphereInsert: shot.isAtmosphereInsert ?? false,
          img2imgPrompt: shot.img2imgPrompt ?? null,
          i2vPrompt: shot.i2vPrompt ?? null,
          visual: shot.visual,
          subject: shot.subject,
          cinematography: shot.cinematography,
          structure: shot.structure,
        },
        restoreSourcePlan,
      ),
    ),
    globalStyle: base?.globalStyle ?? "真实旅行记录感，贴近平台原生短视频节奏",
    totalDurationSeconds: plan.totalDurationSeconds,
    validationErrors: base?.validationErrors ?? [],
    styleConstraints: base?.styleConstraints,
    reusableModules: base?.reusableModules,
    narrativeCurves: base?.narrativeCurves,
    subtitlePlan: plan.subtitlePlan ?? base?.subtitlePlan,
    storyboard: base?.storyboard ?? plan.storyboard,
    ...(realPhotoMaterialBrief ? { realPhotoMaterialBrief } : {}),
    ...(realPhotoNarrationBlueprint ? { realPhotoNarrationBlueprint } : {}),
  } satisfies ShotPlan;
}

export function getTaskDirectorPlan(
  task: Pick<VideoTaskRecord, "draftBundle" | "shotPlan" | "directorPlan" | "parameters">,
) {
  return buildDirectorPlanFromTaskData({
    draftBundle: task.draftBundle,
    shotPlan: task.shotPlan,
    directorPlan: task.directorPlan,
    parameters: task.parameters,
    forceRebuild: true,
  });
}
