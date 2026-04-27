import { isSeedanceProvider } from "./video-provider-config";
import { getTaskCreationExpectedDurationDefaults } from "./task-creation-parameters";
import {
  computeVideoTaskStoryShotCount,
  getVideoTaskTypeProfile,
  type VideoTaskExpectedDurationRange,
  type VideoTaskSegmentMode,
  type VideoTaskSource,
  type VideoTaskVideoType,
} from "./video-task-schema";

export type TravelItineraryMeta = {
  dayCount: number | null;
  nightCount: number | null;
  dayMarkers: number[];
  source: "day_night" | "day_only" | "day_marker" | "none";
};

export type TravelGuideSegmentBlueprint = {
  segmentIndex: number;
  purpose: "hook" | "day_block" | "closing";
  label: string;
  dayStart: number | null;
  dayEnd: number | null;
};

export type DerivedVideoTaskStructure = {
  segmentMode: VideoTaskSegmentMode;
  segmentCount: number;
  durationSeconds: number;
  storyShotsPerSegment: number;
  storyShotCount: number;
  introSegmentDurationSeconds: number | null;
  itinerary: TravelItineraryMeta;
  segmentBlueprint: TravelGuideSegmentBlueprint[];
  usedTravelGuideAutoStructure: boolean;
};

const dayMarkerPattern = /\bday\s*(\d+)\b/gi;
const chineseDayMarkerPattern = /第([一二三四五六七八九十两\d]+)天/g;
const dayNightPattern = /(\d{1,2})\s*天\s*(\d{1,2})\s*晚/;
const dayOnlyPattern = /(\d{1,2})\s*(?:天|日)\s*(?:游|行程|路线|出行|玩法)?/;

function toChineseNumber(value: string) {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const mapping: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  if (normalized === "十") {
    return 10;
  }

  if (normalized.startsWith("十")) {
    return 10 + (mapping[normalized.slice(1)] ?? 0);
  }

  if (normalized.endsWith("十")) {
    return (mapping[normalized[0]] ?? 1) * 10;
  }

  if (normalized.includes("十")) {
    const [tens, ones] = normalized.split("十");
    return (mapping[tens] ?? 1) * 10 + (mapping[ones] ?? 0);
  }

  return mapping[normalized] ?? 0;
}

function uniqueSorted(values: number[]) {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value) && value > 0))).sort(
    (left, right) => left - right,
  );
}

export function inferTravelItineraryMeta(
  source: Pick<VideoTaskSource, "productInfoTitle" | "productInfoSnapshot" | "userPrompt" | "videoTemplatePrompt">,
) {
  const combinedText = [
    source.productInfoTitle,
    source.productInfoSnapshot,
    source.userPrompt,
    source.videoTemplatePrompt,
  ]
    .filter(Boolean)
    .join("\n");

  const dayNightMatch = combinedText.match(dayNightPattern);
  if (dayNightMatch) {
    return {
      dayCount: Math.max(1, Number(dayNightMatch[1]) || 1),
      nightCount: Math.max(0, Number(dayNightMatch[2]) || 0),
      dayMarkers: [],
      source: "day_night" as const,
    } satisfies TravelItineraryMeta;
  }

  const explicitDayOnly = combinedText.match(
    /行程天数[^0-9一二三四五六七八九十两]*(\d{1,2}|[一二三四五六七八九十两]+)\s*天/,
  );
  if (explicitDayOnly) {
    return {
      dayCount: Math.max(1, toChineseNumber(explicitDayOnly[1]) || 1),
      nightCount: null,
      dayMarkers: [],
      source: "day_only" as const,
    } satisfies TravelItineraryMeta;
  }

  const dayMarkers = uniqueSorted([
    ...Array.from(combinedText.matchAll(dayMarkerPattern)).map((match) => Number(match[1]) || 0),
    ...Array.from(combinedText.matchAll(chineseDayMarkerPattern)).map((match) => toChineseNumber(match[1])),
  ]);

  if (dayMarkers.length > 0) {
    return {
      dayCount: dayMarkers[dayMarkers.length - 1] ?? dayMarkers.length,
      nightCount: null,
      dayMarkers,
      source: "day_marker" as const,
    } satisfies TravelItineraryMeta;
  }

  const dayOnlyMatch = combinedText.match(dayOnlyPattern);
  return {
    dayCount: dayOnlyMatch ? Math.max(1, Number(dayOnlyMatch[1]) || 1) : null,
    nightCount: null,
    dayMarkers: [],
    source: dayOnlyMatch ? "day_only" : "none",
  } satisfies TravelItineraryMeta;
}

export function isTravelGuideVideoType(videoType: VideoTaskVideoType) {
  return (
    videoType === "agency_guide_voiceover" ||
    videoType === "agency_guide_selfie_narration" ||
    videoType === "agency_guide_presenter_narration" ||
    videoType === "agency_guide_roaming_voiceover"
  );
}

function getTravelGuideSegmentBudget(range: VideoTaskExpectedDurationRange) {
  switch (range) {
    case "35_60":
      return 9;
    case "25_35":
      return 6;
    case "15_25":
    default:
      return 5;
  }
}

function getTravelGuideSegmentDurationSeconds(input: {
  videoType: VideoTaskVideoType;
  expectedDurationRange: VideoTaskExpectedDurationRange;
  requestedDurationSeconds: number;
}) {
  const presetDurationSeconds = getTaskCreationExpectedDurationDefaults(input.expectedDurationRange, input.videoType)
    .videoDurationSeconds;

  if (input.requestedDurationSeconds >= 4 && input.requestedDurationSeconds <= 7) {
    return Math.round(input.requestedDurationSeconds);
  }

  return presetDurationSeconds;
}

function getTravelGuideIntroSegmentDurationSeconds(durationSeconds: number) {
  return Math.max(4, Math.min(5, Math.round(durationSeconds)));
}

function buildTravelGuideSegmentBlueprint(dayCount: number, daySegmentCount: number) {
  const blueprints: TravelGuideSegmentBlueprint[] = [
    {
      segmentIndex: 1,
      purpose: "hook",
      label: "开场钩子",
      dayStart: null,
      dayEnd: null,
    },
  ];

  let dayCursor = 1;
  for (let slot = 0; slot < daySegmentCount; slot += 1) {
    const remainingDays = dayCount - dayCursor + 1;
    const remainingSlots = daySegmentCount - slot;
    const groupSize = Math.max(1, Math.ceil(remainingDays / remainingSlots));
    const dayStart = dayCursor;
    const dayEnd = Math.min(dayCount, dayCursor + groupSize - 1);
    blueprints.push({
      segmentIndex: blueprints.length + 1,
      purpose: "day_block",
      label: dayStart === dayEnd ? `Day ${dayStart}` : `Day ${dayStart}-${dayEnd}`,
      dayStart,
      dayEnd,
    });
    dayCursor = dayEnd + 1;
  }

  blueprints.push({
    segmentIndex: blueprints.length + 1,
    purpose: "closing",
    label: "收尾转化",
    dayStart: null,
    dayEnd: null,
  });

  return blueprints;
}

export function deriveVideoTaskStructure(input: {
  source: VideoTaskSource;
  videoType: VideoTaskVideoType;
  expectedDurationRange: VideoTaskExpectedDurationRange;
  requestedSegmentCount: number;
  requestedDurationSeconds: number;
  requestedStoryShotsPerSegment?: number | null;
}) {
  const profile = getVideoTaskTypeProfile(input.videoType);
  const requestedSegmentCount = Math.max(1, Math.round(input.requestedSegmentCount || 1));
  const requestedDurationSeconds = Math.max(1, Math.round(input.requestedDurationSeconds || 1));
  const requestedStoryShotsPerSegment = Math.max(
    1,
    Math.round(input.requestedStoryShotsPerSegment ?? profile.recommendedShotsPerSegment),
  );
  const itinerary = inferTravelItineraryMeta(input.source);

  if (!isTravelGuideVideoType(input.videoType) || !itinerary.dayCount) {
    return {
      segmentMode: profile.defaultSegmentMode,
      segmentCount: requestedSegmentCount,
      durationSeconds: requestedDurationSeconds,
      storyShotsPerSegment: requestedStoryShotsPerSegment,
      storyShotCount: computeVideoTaskStoryShotCount({
        videoType: input.videoType,
        segmentCount: requestedSegmentCount,
        storyShotsPerSegment: requestedStoryShotsPerSegment,
      }),
      introSegmentDurationSeconds: profile.introSegmentDurationSeconds ?? null,
      itinerary,
      segmentBlueprint: [],
      usedTravelGuideAutoStructure: false,
    } satisfies DerivedVideoTaskStructure;
  }

  const dayCount = Math.max(1, Math.min(itinerary.dayCount, 12));
  const hardBudget = Math.max(4, getTravelGuideSegmentBudget(input.expectedDurationRange));
  const softBudget = Math.max(4, requestedSegmentCount);
  const segmentBudget = Math.min(Math.max(hardBudget, softBudget), 10);
  const daySegmentBudget = Math.max(1, segmentBudget - 2);
  const daySegmentCount = Math.min(dayCount, daySegmentBudget);
  const segmentCount = daySegmentCount + 2;
  const segmentBlueprint = buildTravelGuideSegmentBlueprint(dayCount, daySegmentCount);
  const storyShotsPerSegment = Math.max(1, requestedStoryShotsPerSegment);
  const storyShotCount = segmentCount <= 1 ? 1 : 1 + Math.max(0, segmentCount - 1) * Math.max(1, storyShotsPerSegment);
  const resolvedSegmentDurationSeconds = getTravelGuideSegmentDurationSeconds({
    videoType: input.videoType,
    expectedDurationRange: input.expectedDurationRange,
    requestedDurationSeconds,
  });
  const introSegmentDurationSeconds = getTravelGuideIntroSegmentDurationSeconds(resolvedSegmentDurationSeconds);

  if (isSeedanceProvider()) {
    return {
      segmentMode: "multi_shot_montage" as VideoTaskSegmentMode,
      segmentCount,
      durationSeconds: resolvedSegmentDurationSeconds,
      storyShotsPerSegment,
      storyShotCount,
      introSegmentDurationSeconds,
      itinerary,
      segmentBlueprint,
      usedTravelGuideAutoStructure: true,
    } satisfies DerivedVideoTaskStructure;
  }

  return {
    segmentMode: "hybrid_intro_plus_montage",
    segmentCount,
    durationSeconds: resolvedSegmentDurationSeconds,
    storyShotsPerSegment,
    storyShotCount,
    introSegmentDurationSeconds,
    itinerary,
    segmentBlueprint,
    usedTravelGuideAutoStructure: true,
  } satisfies DerivedVideoTaskStructure;
}
