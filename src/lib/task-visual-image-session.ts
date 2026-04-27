export type ParsedTaskVisualSelectedImageSession = {
  taskId: string;
  segmentId: string;
  shotIndex: number;
};

function parsePositiveIndex(rawValue: string | undefined) {
  if (!rawValue) {
    return null;
  }

  const normalizedValue = rawValue.trim().replace(/^shot-/, "");
  const shotIndex = Number(normalizedValue);
  if (!Number.isFinite(shotIndex) || shotIndex <= 0) {
    return null;
  }

  return shotIndex;
}

function normalizeSegmentId(segmentId: string | undefined, shotIndex: number) {
  const normalizedSegmentId = segmentId?.trim();
  return normalizedSegmentId ? normalizedSegmentId : `segment-${shotIndex}`;
}

export function buildTaskVisualSelectedImageSessionId(taskId: string, segmentId: string, shotIndex: number) {
  const normalizedShotIndex = parsePositiveIndex(String(shotIndex));
  if (!normalizedShotIndex) {
    throw new Error("镜头编号无效，无法生成视觉图片会话标识");
  }

  return `${taskId.trim()}:${normalizeSegmentId(segmentId, normalizedShotIndex)}:shot-${normalizedShotIndex}`;
}

export function parseTaskVisualSelectedImageSessionIdValue(sessionId: string) {
  const [rawTaskId, rawSegmentId, rawShotToken] = sessionId.split(":");
  const taskId = rawTaskId?.trim();
  if (!taskId) {
    return null;
  }

  const shotIndex =
    parsePositiveIndex(rawShotToken) ??
    parsePositiveIndex(
      rawSegmentId?.trim().startsWith("segment-") ? rawSegmentId.trim().slice("segment-".length) : rawSegmentId,
    );
  if (!shotIndex) {
    return null;
  }

  return {
    taskId,
    segmentId: normalizeSegmentId(rawSegmentId, shotIndex),
    shotIndex,
  } satisfies ParsedTaskVisualSelectedImageSession;
}
