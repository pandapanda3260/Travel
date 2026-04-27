import type { NarrationDraftClip } from "./narration";

type NarrationSegmentMatchInput = {
  segmentId?: string | null;
  segmentIndex?: number | null;
  shotIndex?: number | null;
};

function normalizeIndex(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampRatio(value: number | null | undefined, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function findNarrationClipsForSegment(
  clips: NarrationDraftClip[],
  input: NarrationSegmentMatchInput,
) {
  const segmentId = String(input.segmentId ?? "").trim() || null;
  const segmentIndex = normalizeIndex(input.segmentIndex);
  const shotIndex = normalizeIndex(input.shotIndex);

  return clips
    .filter((clip) => {
      if (segmentId && (clip.segmentId === segmentId || clip.bindToSegmentId === segmentId)) {
        return true;
      }

      if (segmentIndex != null && clip.segmentIndex === segmentIndex) {
        return true;
      }

      // 兼容极旧数据：只有 shotIndex，没有 segmentId / segmentIndex 的情况才退回 shot 匹配。
      if (
        shotIndex != null &&
        clip.shotIndex === shotIndex &&
        !clip.segmentId &&
        !clip.bindToSegmentId &&
        clip.segmentIndex == null
      ) {
        return true;
      }

      return false;
    })
    .sort((left, right) => left.startAtSeconds - right.startAtSeconds);
}

export function buildSubtitleAssPosition(input: {
  frameWidth: number;
  frameHeight: number;
  positionOffsetRatio?: number | null;
  horizontalPositionRatio?: number | null;
}) {
  const verticalPositionRatio = clampRatio(input.positionOffsetRatio, 0.02, 0.98, 0.3);
  const horizontalPositionRatio = clampRatio(input.horizontalPositionRatio, 0.1, 0.9, 0.5);

  return {
    x: Math.round(input.frameWidth * horizontalPositionRatio),
    y: Math.round(input.frameHeight * (1 - verticalPositionRatio)),
  };
}
