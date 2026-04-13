import {
  countNarrationCharacters,
  getNarrationLengthGuidance,
  sanitizeNarrationText,
  trimNarrationToCharacterLimit,
} from "./narration";
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

type IndexedBlock = {
  label: string;
  index: number;
  text: string;
};

const indexedBlockPattern = /(片段|镜头|音频|字幕|旁白)\s*(\d+)\s*[.．、:：]?\s*/g;

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
  if (countNarrationCharacters(normalized) <= guidance.maxCharacters) {
    return sanitizeNarrationText(normalized);
  }

  return trimNarrationToCharacterLimit(normalized, guidance.maxCharacters);
}

function parseIndexedBlocks(text: string, fallbackCount: number, defaultLabel = "镜头"): IndexedBlock[] {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return [];
  }

  const matches = Array.from(normalized.matchAll(indexedBlockPattern));
  if (matches.length === 0) {
    const lines = normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return Array.from({ length: Math.max(1, fallbackCount) }, (_, index) => ({
      label: defaultLabel,
      index: index + 1,
      text: lines[index] ?? lines[0] ?? normalized,
    }));
  }

  return matches.map((match, matchIndex) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[matchIndex + 1]?.index ?? normalized.length;
    return {
      label: match[1] || defaultLabel,
      index: Number(match[2]) || matchIndex + 1,
      text: normalized.slice(start, end).trim(),
    };
  });
}

function buildIndexedBlockText(label: string, blocks: Array<{ index: number; text: string }>) {
  return blocks.map((block) => `${label}${block.index}：${block.text.trim()}`).join("\n");
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

function getPromptBlockForIndex(blocks: IndexedBlock[], index: number) {
  return blocks.find((block) => block.index === index)?.text ?? blocks[index - 1]?.text ?? blocks[0]?.text ?? "";
}

function resolveSegmentText(blocks: IndexedBlock[], segmentIndex: number, shotIndexes: number[], segmentCount: number) {
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

function getSegmentDurationSeconds(parameters: VideoTaskParameterBundle["video"], segmentIndex: number) {
  if (parameters.segmentMode === "hybrid_intro_plus_montage" && segmentIndex === 1) {
    return Math.max(1, parameters.introSegmentDurationSeconds ?? Math.min(3, parameters.durationSeconds));
  }
  return Math.max(1, parameters.durationSeconds);
}

function buildSegmentShotGroups(parameters: VideoTaskParameterBundle["video"]) {
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

function getSegmentFlags(parameters: VideoTaskParameterBundle["video"], segmentIndex: number) {
  const profile = getVideoTaskTypeProfile(parameters.videoType);
  if (profile.key === "agency_creative_beat_mix" && segmentIndex === 1) {
    return {
      hasTalent: true,
      talentCaptureMode: "intro_host" as const,
      hasVoice: true,
      hasSubtitle: true,
      requiresLipSync: true,
    };
  }

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
  const flags = getSegmentFlags(input.parameters, input.segmentIndex);
  const sceneDescription =
    normalizeInlineText(input.planItem?.sceneDescription) ||
    normalizeInlineText(input.imagePrompt) ||
    `围绕${input.segmentIndex}号片段的主题画面`;
  const narrationHint =
    normalizeInlineText(input.planItem?.narrationHint) ||
    normalizeInlineText(input.narrationText) ||
    `${input.segmentIndex}号片段亮点`;

  return {
    shotId: `shot-${input.shotIndex}`,
    shotIndex: input.shotIndex,
    segmentId: input.segmentId,
    segmentIndex: input.segmentIndex,
    title: `镜头 ${input.shotIndex}`,
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
    narrationHint,
    imagePrompt: normalizeInlineText(input.imagePrompt) || sceneDescription,
    videoPrompt: normalizeInlineText(input.videoPrompt) || sceneDescription,
    narrationText: normalizeNarrationText(input.narrationText),
    subtitleText: normalizeNarrationText(input.narrationText),
  } satisfies DirectorStoryShot;
}

export function buildDirectorPlanFromTaskData(input: {
  draftBundle: VideoTaskDraftBundle;
  shotPlan?: ShotPlan | null;
  directorPlan?: VideoTaskDirectorPlan | null;
  parameters: VideoTaskParameterBundle;
  forceRebuild?: boolean;
}) {
  if (!input.forceRebuild && input.directorPlan?.renderSegments?.length && input.directorPlan.storyShots?.length) {
    return input.directorPlan;
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
  const shotPlanItems = [...(input.shotPlan?.shots ?? [])].sort((left, right) => left.shotIndex - right.shotIndex);
  const segmentGroups = buildSegmentShotGroups({
    ...input.parameters.video,
    storyShotCount,
  });

  const imageBlocks = parseIndexedBlocks(
    input.draftBundle.textToImagePrompt,
    Math.max(segmentCount, storyShotCount),
    "片段",
  );
  const videoBlocks = parseIndexedBlocks(
    input.draftBundle.imageToVideoPrompt,
    Math.max(segmentCount, storyShotCount),
    "片段",
  );
  const narrationBlocks = parseIndexedBlocks(input.draftBundle.narrationScript, storyShotCount, "镜头");

  const storyShots: DirectorStoryShot[] = [];
  const renderSegments: DirectorRenderSegment[] = [];
  const audioCues: DirectorAudioCue[] = [];
  let accumulatedSeconds = 0;

  for (const group of segmentGroups) {
    const segmentIndex = group.segmentIndex;
    const segmentId = `segment-${segmentIndex}`;
    const segmentDurationSeconds = getSegmentDurationSeconds(input.parameters.video, segmentIndex);
    const segmentMode = getSegmentModeForIndex(input.parameters.video, segmentIndex);
    const segmentFlags = getSegmentFlags(input.parameters.video, segmentIndex);
    const segmentImagePrompt = resolveSegmentText(imageBlocks, segmentIndex, group.shotIndexes, segmentCount);
    const segmentVideoPrompt = resolveSegmentText(videoBlocks, segmentIndex, group.shotIndexes, segmentCount);

    const shotDurationSeconds = Math.max(
      0.8,
      Number((segmentDurationSeconds / Math.max(1, group.shotIndexes.length)).toFixed(2)),
    );

    const segmentShots = group.shotIndexes.map((shotIndex) => {
      const planItem = shotPlanItems.find((item) => item.shotIndex === shotIndex) ?? null;
      const shotHasVoice = planItem?.hasVoice ?? segmentFlags.hasVoice;
      const shotHasSubtitle = planItem?.hasSubtitle ?? (segmentFlags.hasSubtitle && shotHasVoice);
      const shotRequiresLipSync = planItem?.requiresLipSync ?? (shotHasVoice ? segmentFlags.requiresLipSync : false);
      const rawShotNarrationText = getPromptBlockForIndex(narrationBlocks, shotIndex);
      const fallbackNarration = normalizeInlineText(planItem?.narrationHint) || `镜头${shotIndex}亮点`;
      const shotNarrationText =
        shotHasVoice || shotHasSubtitle
          ? trimNarrationToDuration(
              rawShotNarrationText || fallbackNarration,
              planItem?.durationSeconds && planItem.durationSeconds > 0
                ? planItem.durationSeconds
                : shotDurationSeconds,
              fallbackNarration,
            )
          : "";
      const storyShot = buildFallbackStoryShot({
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
        imagePrompt: getPromptBlockForIndex(imageBlocks, shotIndex) || segmentImagePrompt,
        videoPrompt: getPromptBlockForIndex(videoBlocks, shotIndex) || segmentVideoPrompt,
        narrationText: shotNarrationText,
      });
      storyShots.push(storyShot);
      return storyShot;
    });

    const segmentNarrationParts = segmentShots
      .filter((shot) => shot.hasVoice || shot.hasSubtitle)
      .map((shot) => shot.narrationText || shot.subtitleText)
      .filter(Boolean);
    const segmentFallbackNarration = shotPlanItems
      .filter((item) => group.shotIndexes.includes(item.shotIndex))
      .map((item) => item.narrationHint)
      .filter(Boolean)
      .join("，");
    const segmentNarrationText =
      segmentNarrationParts.length > 0
        ? trimNarrationToDuration(
            mergeTexts(segmentNarrationParts),
            segmentDurationSeconds,
            segmentFallbackNarration || `片段${segmentIndex}亮点`,
          )
        : "";
    const segmentHasVoice = segmentShots.some((shot) => shot.hasVoice);
    const segmentHasSubtitle = segmentShots.some((shot) => shot.hasSubtitle);
    const segmentRequiresLipSync = segmentShots.some((shot) => shot.requiresLipSync);
    const cueAnchorShot = segmentShots.find((shot) => shot.hasVoice || shot.hasSubtitle) ?? segmentShots[0] ?? null;

    const multiPrompt =
      segmentMode === "multi_shot_montage"
        ? segmentShots.map((shot, shotOffset) => ({
            index: shotOffset + 1,
            prompt: normalizeInlineText(shot.videoPrompt) || `${shot.sceneDescription}，自然运镜`,
            duration: Number((segmentDurationSeconds / Math.max(1, segmentShots.length)).toFixed(2)),
          }))
        : [];

    const renderSegment: DirectorRenderSegment = {
      segmentId,
      segmentIndex,
      title: `片段 ${segmentIndex}`,
      segmentMode,
      shotIds: segmentShots.map((shot) => shot.shotId),
      shotIndexes: segmentShots.map((shot) => shot.shotIndex),
      durationSeconds: segmentDurationSeconds,
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
          ? "前 3 秒读稿开场"
          : segmentMode === "multi_shot_montage"
            ? `${segmentShots.length} 个镜头合成一个生成片段`
            : "单片段表达",
    };
    renderSegments.push(renderSegment);

    if (renderSegment.hasVoice || renderSegment.hasSubtitle) {
      audioCues.push({
        cueId: `cue-${segmentIndex}`,
        cueIndex: audioCues.length + 1,
        shotId: cueAnchorShot?.shotId ?? renderSegment.shotIds[0] ?? null,
        shotIndex: cueAnchorShot?.shotIndex ?? renderSegment.shotIndexes[0] ?? null,
        targetSegmentId: renderSegment.segmentId,
        targetSegmentIndex: renderSegment.segmentIndex,
        startAtSeconds: accumulatedSeconds,
        plannedDurationSeconds: renderSegment.durationSeconds,
        audioDurationSeconds: null,
        hasVoice: renderSegment.hasVoice,
        hasSubtitle: renderSegment.hasSubtitle,
        requiresLipSync: renderSegment.requiresLipSync,
        voiceId: null,
        narrationText: renderSegment.narrationText,
        subtitleText: renderSegment.subtitleText,
        audioUrl: null,
        words: [],
      });
    }

    accumulatedSeconds += segmentDurationSeconds;
  }

  return {
    videoType: input.parameters.video.videoType,
    segmentMode: input.parameters.video.segmentMode,
    totalDurationSeconds: accumulatedSeconds,
    storyShots,
    renderSegments,
    audioCues,
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
  const narrationScript = buildIndexedBlockText(
    "镜头",
    plan.storyShots.map((shot) => ({
      index: shot.shotIndex,
      text: shot.hasVoice || shot.hasSubtitle ? normalizeNarrationText(shot.narrationText || shot.subtitleText) : "",
    })),
  );

  return {
    textToImagePrompt,
    imageToVideoPrompt,
    narrationScript,
  };
}

export function buildShotPlanFromDirectorPlan(plan: VideoTaskDirectorPlan, base?: ShotPlan | null) {
  return {
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
    })),
    globalStyle: base?.globalStyle ?? "真实旅行记录感，贴近平台原生短视频节奏",
    totalDurationSeconds: plan.totalDurationSeconds,
    validationErrors: base?.validationErrors ?? [],
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
  });
}
