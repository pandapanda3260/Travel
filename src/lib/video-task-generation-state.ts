import {
  getVideoTaskStatusIndex,
  normalizeVideoTaskStatus,
  type ShotPlan,
  type ShotPlanItem,
  type VideoTaskDirectorPlan,
  type VideoTaskDraftBundle,
  type VideoTaskRecord,
  type VideoTaskStatus,
} from "./video-task-schema";

type ShotPlanStateInput = Partial<
  Pick<VideoTaskRecord, "status" | "stageTimestamps" | "draftBundle" | "shotPlan" | "directorPlan">
> | null | undefined;

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasGeneratedDraftBundleContent(draftBundle?: Partial<VideoTaskDraftBundle> | null) {
  return Boolean(
    hasText(draftBundle?.textToImagePrompt) ||
      hasText(draftBundle?.imageToVideoPrompt) ||
      hasText(draftBundle?.narrationScript),
  );
}

function isAdvancedBeyondShotPlan(status?: string | null) {
  const normalizedStatus: VideoTaskStatus = normalizeVideoTaskStatus(status);
  return getVideoTaskStatusIndex(normalizedStatus) > getVideoTaskStatusIndex("CREATED");
}

function hasAdvancedStageTimestamp(stageTimestamps?: Partial<Record<VideoTaskStatus, string>> | null) {
  if (!stageTimestamps) {
    return false;
  }
  return Boolean(
    stageTimestamps.SUBTITLE_AUDIO_READY ||
      stageTimestamps.IMAGES_READY ||
      stageTimestamps.CLIPS_READY ||
      stageTimestamps.COMPOSITION_READY,
  );
}

function isFallbackText(value: unknown) {
  if (!hasText(value)) {
    return true;
  }
  const text = String(value).trim();
  return (
    /^\d+号片段亮点$/.test(text) ||
    /^镜头\s*\d+\s*亮点$/.test(text) ||
    /^围绕\d+号片段的主题画面$/.test(text) ||
    text === "人物自然互动表达" ||
    text === "景色与细节推进" ||
    text === "自然松弛"
  );
}

function hasSpecificShotContent(shot: Partial<ShotPlanItem>) {
  const candidateTexts = [
    shot.sceneDescription,
    shot.contentDescription,
    shot.narrationHint,
    shot.sourceSpokenText,
    shot.sourceSubtitleText,
    shot.commercialIntent,
    shot.evidenceTarget,
    shot.conversionRole,
    shot.assetSubjectSummary,
    shot.img2imgPrompt,
    shot.i2vPrompt,
  ];
  return candidateTexts.some((text) => hasText(text) && !isFallbackText(text));
}

function hasSpecificDirectorShotContent(shot: Partial<VideoTaskDirectorPlan["storyShots"][number]>) {
  const candidateTexts = [
    shot.sceneDescription,
    shot.contentDescription,
    shot.narrationHint,
    shot.imagePrompt,
    shot.videoPrompt,
    shot.narrationText,
    shot.subtitleText,
    shot.sourceSpokenText,
    shot.sourceSubtitleText,
    shot.commercialIntent,
    shot.evidenceTarget,
    shot.conversionRole,
    shot.assetSubjectSummary,
    shot.img2imgPrompt,
    shot.i2vPrompt,
  ];
  return candidateTexts.some((text) => hasText(text) && !isFallbackText(text));
}

function hasStoryboardEvidence(plan?: Pick<ShotPlan, "storyboard" | "subtitlePlan" | "realPhotoMaterialBrief" | "realPhotoNarrationBlueprint"> | null) {
  return Boolean(
    plan?.storyboard ||
      plan?.realPhotoMaterialBrief ||
      plan?.realPhotoNarrationBlueprint ||
      plan?.subtitlePlan?.some((segment) => segment.subtitles.some((subtitle) => hasText(subtitle.text))),
  );
}

function hasDirectorStoryboardEvidence(plan?: Pick<VideoTaskDirectorPlan, "storyboard" | "subtitlePlan"> | null) {
  return Boolean(
    plan?.storyboard || plan?.subtitlePlan?.some((segment) => segment.subtitles.some((subtitle) => hasText(subtitle.text))),
  );
}

export function hasGeneratedShotPlanArtifacts(input: ShotPlanStateInput) {
  if (!input) {
    return false;
  }
  if (isAdvancedBeyondShotPlan(input.status) || hasAdvancedStageTimestamp(input.stageTimestamps)) {
    return true;
  }
  if (hasGeneratedDraftBundleContent(input.draftBundle)) {
    return true;
  }
  if (hasStoryboardEvidence(input.shotPlan) || hasDirectorStoryboardEvidence(input.directorPlan)) {
    return true;
  }
  if (input.shotPlan?.shots?.some(hasSpecificShotContent)) {
    return true;
  }
  if (input.directorPlan?.storyShots?.some(hasSpecificDirectorShotContent)) {
    return true;
  }
  return false;
}

