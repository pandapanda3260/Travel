export function formatDurationMmSs(totalSeconds: number | null | undefined) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) {
    return null;
  }

  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function parseDurationMmSs(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Number(trimmed));
  }

  const match = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (!match) {
    return 0;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return Math.max(0, minutes * 60 + seconds);
}
