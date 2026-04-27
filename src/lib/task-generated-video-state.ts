import type { VideoTaskGeneratedVideoRecord } from "./video-task-schema";

function areGeneratedVideoRecordsEquivalent(
  current: VideoTaskGeneratedVideoRecord | null | undefined,
  next: VideoTaskGeneratedVideoRecord | null | undefined,
) {
  if (!current || !next) {
    return current === next;
  }

  if (
    current.taskId !== next.taskId ||
    current.videoJobId !== next.videoJobId ||
    current.status !== next.status ||
    current.videoUrl !== next.videoUrl ||
    current.error !== next.error
  ) {
    return false;
  }

  return JSON.stringify(current) === JSON.stringify(next);
}

export function replaceGeneratedVideoRecord(
  records: VideoTaskGeneratedVideoRecord[],
  taskId: string,
  nextRecord: VideoTaskGeneratedVideoRecord | null | undefined,
) {
  const existingIndex = records.findIndex((record) => record.taskId === taskId);
  const existingRecord = existingIndex >= 0 ? records[existingIndex] : null;

  if (!nextRecord) {
    return existingIndex >= 0 ? records.filter((record) => record.taskId !== taskId) : records;
  }

  if (existingIndex === 0 && areGeneratedVideoRecordsEquivalent(existingRecord, nextRecord)) {
    return records;
  }

  const filtered = records.filter((record) => record.taskId !== taskId);
  return nextRecord ? [nextRecord, ...filtered] : filtered;
}
