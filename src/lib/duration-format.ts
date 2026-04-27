export function formatDurationMmSs(totalSeconds: number | null | undefined) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) {
    return null;
  }

  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSecondValue(
  totalSeconds: number | null | undefined,
  options: { minimumFractionDigits?: 0 | 1; maximumFractionDigits?: 1 | 2 } = {},
) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) {
    return null;
  }

  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const maximumFractionDigits = options.maximumFractionDigits ?? 2;
  const safeSeconds = Math.max(0, totalSeconds);
  const roundedToHundredth = Math.round(safeSeconds * 100) / 100;
  const roundedToTenth = Math.round(safeSeconds * 10) / 10;
  const shouldUseTenth = maximumFractionDigits <= 1 || Math.abs(roundedToHundredth - roundedToTenth) < 0.001;
  const value = shouldUseTenth ? roundedToTenth : roundedToHundredth;
  const hasFraction = Math.abs(value - Math.round(value)) > 0.001;
  const fractionDigits = shouldUseTenth
    ? hasFraction || minimumFractionDigits > 0
      ? 1
      : 0
    : 2;

  return value.toFixed(Math.max(minimumFractionDigits, fractionDigits));
}

export function formatTimelineSecondLabel(totalSeconds: number | null | undefined) {
  const value = formatSecondValue(totalSeconds, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return value == null ? null : `第 ${value} 秒`;
}

export function formatDurationSecondsLabel(totalSeconds: number | null | undefined) {
  const value = formatSecondValue(totalSeconds, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return value == null ? null : `${value} 秒`;
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
