import type {
  RealPhotoMaterialBrief,
  RealPhotoNarrationBeat,
  RealPhotoNarrationBlueprint,
  ShotPlan,
  ShotPlanItem,
} from "./video-task-schema";

type ShotLike = Pick<ShotPlanItem, "shotIndex" | "narrationHint"> &
  Partial<
    Pick<
      ShotPlanItem,
      | "action"
      | "assetId"
      | "narrationBeatId"
      | "narrationPhase"
      | "narrationIntent"
      | "sourceSpokenText"
      | "sourceSubtitleText"
      | "narrationEstimatedDurationSeconds"
      | "targetMaterialIds"
      | "needsAiFallback"
    >
  >;

const comparisonIgnoredCharacters = /[\s，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]/g;

function compactText(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function normalizeComparisonText(value: string | null | undefined) {
  return compactText(value).replace(comparisonIgnoredCharacters, "");
}

function firstNonEmptyText(values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function extractQuotedNarrationText(value: string | null | undefined) {
  const text = String(value ?? "");
  const match =
    text.match(/(?:台词|口播|字幕)[：:]?[“"]([^”"]+)[”"]/) ??
    text.match(/(?:台词|口播|字幕)[：:]?[‘']([^’']+)[’']/);
  return match?.[1]?.trim() ?? "";
}

export function getRealPhotoNarrationBlueprintFromShotPlan(
  shotPlan: Pick<ShotPlan, "realPhotoNarrationBlueprint" | "storyboard"> | null | undefined,
): RealPhotoNarrationBlueprint | null {
  return shotPlan?.realPhotoNarrationBlueprint ?? shotPlan?.storyboard?.realPhotoNarrationBlueprint ?? null;
}

export function getRealPhotoMaterialBriefFromShotPlan(
  shotPlan: Pick<ShotPlan, "realPhotoMaterialBrief" | "storyboard"> | null | undefined,
): RealPhotoMaterialBrief | null {
  return shotPlan?.realPhotoMaterialBrief ?? shotPlan?.storyboard?.realPhotoMaterialBrief ?? null;
}

function findMatchingBaseShot(shot: ShotLike, shotPlan: Pick<ShotPlan, "shots"> | null | undefined) {
  return shotPlan?.shots.find((item) => item.shotIndex === shot.shotIndex) ?? null;
}

export function resolveRealPhotoNarrationBeatForShot(
  shot: ShotLike,
  shotPlan: Pick<ShotPlan, "shots" | "realPhotoNarrationBlueprint" | "storyboard"> | null | undefined,
): RealPhotoNarrationBeat | null {
  const blueprint = getRealPhotoNarrationBlueprintFromShotPlan(shotPlan);
  if (!blueprint?.beats.length) {
    return null;
  }

  const baseShot = findMatchingBaseShot(shot, shotPlan);
  const beatId = firstNonEmptyText([shot.narrationBeatId, baseShot?.narrationBeatId]);
  if (beatId) {
    const byId = blueprint.beats.find((beat) => beat.beatId === beatId);
    if (byId) return byId;
  }

  const phase = firstNonEmptyText([shot.narrationPhase, baseShot?.narrationPhase]);
  if (phase) {
    const byPhase = blueprint.beats.find((beat) => beat.phase === phase);
    if (byPhase) return byPhase;
  }

  const assetId = firstNonEmptyText([shot.assetId, baseShot?.assetId]);
  if (assetId) {
    const byAsset = blueprint.beats.find((beat) => beat.targetMaterialIds.includes(assetId));
    if (byAsset) return byAsset;
  }

  const byIndex = blueprint.beats[shot.shotIndex - 1];
  if (byIndex) {
    return byIndex;
  }

  const hint = normalizeComparisonText(firstNonEmptyText([shot.narrationHint, baseShot?.narrationHint]));
  if (hint) {
    const byTitle = blueprint.beats.find((beat) => normalizeComparisonText(beat.title) === hint);
    if (byTitle) return byTitle;
  }

  const actionText = [shot.action, baseShot?.action].map((item) => normalizeComparisonText(item)).filter(Boolean);
  if (actionText.length) {
    const byAction = blueprint.beats.find((beat) => {
      const spokenText = normalizeComparisonText(beat.spokenText);
      const subtitleText = normalizeComparisonText(beat.subtitleText);
      return actionText.some((text) => (spokenText && text.includes(spokenText)) || (subtitleText && text.includes(subtitleText)));
    });
    if (byAction) return byAction;
  }

  return null;
}

export function resolveRealPhotoShotNarrationSource(
  shot: ShotLike,
  shotPlan: Pick<ShotPlan, "shots" | "realPhotoNarrationBlueprint" | "storyboard"> | null | undefined,
) {
  const baseShot = findMatchingBaseShot(shot, shotPlan);
  const beat = resolveRealPhotoNarrationBeatForShot(shot, shotPlan);
  const spokenText = firstNonEmptyText([
    shot.sourceSpokenText,
    baseShot?.sourceSpokenText,
    beat?.spokenText,
    extractQuotedNarrationText(shot.action),
    extractQuotedNarrationText(baseShot?.action),
  ]);
  const subtitleText = firstNonEmptyText([
    shot.sourceSubtitleText,
    baseShot?.sourceSubtitleText,
    beat?.subtitleText,
    spokenText,
  ]);

  return {
    beat,
    spokenText,
    subtitleText,
    narrationBeatId: firstNonEmptyText([shot.narrationBeatId, baseShot?.narrationBeatId, beat?.beatId]) || null,
    narrationPhase: firstNonEmptyText([shot.narrationPhase, baseShot?.narrationPhase, beat?.phase]) || null,
    narrationIntent: firstNonEmptyText([shot.narrationIntent, baseShot?.narrationIntent, beat?.intent]) || null,
    narrationEstimatedDurationSeconds:
      shot.narrationEstimatedDurationSeconds ??
      baseShot?.narrationEstimatedDurationSeconds ??
      beat?.estimatedDurationSeconds ??
      null,
    targetMaterialIds:
      shot.targetMaterialIds?.length
        ? shot.targetMaterialIds
        : baseShot?.targetMaterialIds?.length
        ? baseShot.targetMaterialIds
        : beat?.targetMaterialIds,
  };
}

export function restoreRealPhotoNarrationFieldsForShot<T extends ShotLike>(
  shot: T,
  shotPlan: Pick<ShotPlan, "shots" | "realPhotoNarrationBlueprint" | "storyboard"> | null | undefined,
): T {
  const source = resolveRealPhotoShotNarrationSource(shot, shotPlan);
  if (!source.spokenText && !source.subtitleText && !source.beat) {
    return shot;
  }

  return {
    ...shot,
    narrationBeatId: source.narrationBeatId,
    narrationPhase: source.narrationPhase,
    narrationIntent: source.narrationIntent,
    sourceSpokenText: source.spokenText || shot.sourceSpokenText || null,
    sourceSubtitleText: source.subtitleText || source.spokenText || shot.sourceSubtitleText || null,
    narrationEstimatedDurationSeconds: source.narrationEstimatedDurationSeconds,
    targetMaterialIds: shot.needsAiFallback ? [] : (source.targetMaterialIds ?? shot.targetMaterialIds),
  };
}

export function restoreRealPhotoNarrationShotPlan<T extends ShotPlan>(shotPlan: T): T {
  const blueprint = getRealPhotoNarrationBlueprintFromShotPlan(shotPlan);
  const materialBrief = getRealPhotoMaterialBriefFromShotPlan(shotPlan);
  if (!blueprint && !materialBrief) {
    return shotPlan;
  }

  return {
    ...shotPlan,
    shots: shotPlan.shots.map((shot) => restoreRealPhotoNarrationFieldsForShot(shot, shotPlan)),
    realPhotoNarrationBlueprint: blueprint ?? shotPlan.realPhotoNarrationBlueprint,
    realPhotoMaterialBrief: materialBrief ?? shotPlan.realPhotoMaterialBrief,
  };
}

export function isRealPhotoStructuralNarrationText(
  text: string | null | undefined,
  shots: ShotLike[],
  shotPlan: Pick<ShotPlan, "realPhotoNarrationBlueprint" | "storyboard"> | null | undefined,
) {
  const normalized = normalizeComparisonText(text);
  if (!normalized) {
    return false;
  }

  const blueprint = getRealPhotoNarrationBlueprintFromShotPlan(shotPlan);
  const structuralCandidates = [
    shots.map((shot) => shot.narrationHint).filter(Boolean).join("，"),
    ...(blueprint?.beats ?? []).map((beat) => beat.title),
    ...(blueprint?.beats ?? []).map((beat) => beat.phase),
  ];

  return structuralCandidates.some((candidate) => normalizeComparisonText(candidate) === normalized);
}
