export const seedanceSegmentDurationOptions = [4, 5, 6, 7] as const;

export type SeedanceSegmentDurationSeconds = (typeof seedanceSegmentDurationOptions)[number];

export const seedanceSegmentDurationConstraint = {
  minSeconds: seedanceSegmentDurationOptions[0],
  maxSeconds: seedanceSegmentDurationOptions[seedanceSegmentDurationOptions.length - 1],
  defaultSeconds: 5,
} as const;

export function clampSeedanceSegmentDurationSeconds(
  value: unknown,
  fallback: SeedanceSegmentDurationSeconds = seedanceSegmentDurationConstraint.defaultSeconds,
): SeedanceSegmentDurationSeconds {
  const parsed = typeof value === "number" ? value : Number(value);
  const rounded = Math.round(Number.isFinite(parsed) ? parsed : fallback);
  const clamped = Math.max(
    seedanceSegmentDurationConstraint.minSeconds,
    Math.min(seedanceSegmentDurationConstraint.maxSeconds, rounded),
  );
  return clamped as SeedanceSegmentDurationSeconds;
}
