import type { VideoMaterialSummary } from "./video-material-types";

type VideoMaterialSortTarget = Pick<VideoMaterialSummary, "videoUploadedAt">;

function toUploadTimestamp(uploadedAt: string | null) {
  if (!uploadedAt) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = new Date(uploadedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function compareVideoMaterialsByUploadTimeDesc(left: VideoMaterialSortTarget, right: VideoMaterialSortTarget) {
  return toUploadTimestamp(right.videoUploadedAt) - toUploadTimestamp(left.videoUploadedAt);
}

export function sortVideoMaterialsByUploadTimeDesc<T extends VideoMaterialSortTarget>(materials: readonly T[]) {
  return [...materials].sort(compareVideoMaterialsByUploadTimeDesc);
}
