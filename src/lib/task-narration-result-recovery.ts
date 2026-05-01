import type { NarrationDraftClip } from "./narration";
import type { NarrationResultRecord } from "./narration-result-store";
import {
  getRealPhotoNarrationBlueprintFromShotPlan,
  isRealPhotoStructuralNarrationText,
} from "./real-photo-narration-source";
import { resolveNarrationClipFullSemanticText } from "./subtitle-text-contract";
import { getTaskDirectorPlan } from "./video-task-director";
import type { DirectorStoryShot, VideoTaskRecord } from "./video-task-schema";

function findStoryShotsForClip(storyShots: DirectorStoryShot[], clip: NarrationDraftClip) {
  const segmentShots = storyShots.filter(
    (shot) =>
      (clip.segmentId && shot.segmentId === clip.segmentId) ||
      (clip.bindToSegmentId && shot.segmentId === clip.bindToSegmentId) ||
      (clip.segmentIndex != null && shot.segmentIndex === clip.segmentIndex),
  );
  if (segmentShots.length) {
    return segmentShots;
  }

  return storyShots.filter((shot) => shot.shotIndex === clip.shotIndex);
}

function resolveStoryShotText(storyShots: DirectorStoryShot[]) {
  return storyShots
    .map((shot) => shot.sourceSpokenText || shot.narrationText || shot.sourceSubtitleText || shot.subtitleText)
    .map((text) => text?.trim())
    .filter(Boolean)
    .join("，");
}

export function recoverNarrationResultTextFromTask(
  task: VideoTaskRecord,
  result: NarrationResultRecord | null | undefined,
): NarrationResultRecord | null {
  if (!result) {
    return null;
  }

  const realPhotoBlueprint = getRealPhotoNarrationBlueprintFromShotPlan(task.shotPlan);
  if (!realPhotoBlueprint) {
    return result;
  }

  const directorPlan = getTaskDirectorPlan(task);
  let changed = false;
  const clips = result.clips.map((clip) => {
    const storyShots = findStoryShotsForClip(directorPlan.storyShots, clip);
    const recoveredText = resolveStoryShotText(storyShots);
    if (!recoveredText) {
      return clip;
    }

    const currentText = resolveNarrationClipFullSemanticText(clip);
    const shouldRecover =
      !currentText.trim() || isRealPhotoStructuralNarrationText(currentText, storyShots, task.shotPlan);
    if (!shouldRecover || currentText === recoveredText) {
      return clip;
    }

    changed = true;
    return {
      ...clip,
      fullSemanticSentence: recoveredText,
      narrationText: clip.hasVoice === false ? "" : recoveredText,
      spokenText: clip.hasVoice === false ? "" : recoveredText,
      subtitleText: clip.hasSubtitle === false ? "" : recoveredText,
      subtitleDisplayCues: null,
      audioUrl: null,
      audioDurationSeconds: null,
      words: [],
      audioAlignment: null,
    } satisfies NarrationDraftClip;
  });

  if (!changed) {
    return result;
  }

  return {
    ...result,
    clips,
    subtitleSrtUrl: null,
    mergedAudioUrl: null,
  };
}
