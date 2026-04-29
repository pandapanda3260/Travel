"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { buildSubtitleDisplayUnits, splitSegmentWordTimelineBySubtitleEntries } from "../../../../lib/subtitle-display";
import type { SubtitleDisplayCueInput } from "../../../../lib/subtitle-display";
import {
  getSubtitleToneStyle,
  getSubtitleFontFamilyNames,
  getSubtitlePreviewTypographyMetrics,
  getSubtitlePresetDecoration,
  type SubtitleRenderAspectRatio,
  type SubtitleConfig,
} from "../../../../lib/subtitle-style-config";
import type { SegmentSubtitlePlan, TimedWord } from "../../../../lib/video-task-schema";

export type SubtitlePreviewMaterial = {
  segmentId: string;
  segmentIndex: number;
  shotIndex: number;
  subtitleText: string;
  narrationText: string;
  durationSeconds: number;
  thumbnailUrl?: string | null;
  wordTimeline?: TimedWord[];
};

export type SubtitlePreviewNarrationClip = {
  id: string;
  shotIndex: number;
  segmentId?: string | null;
  segmentIndex?: number | null;
  bindToSegmentId?: string | null;
  startAtSeconds: number;
  durationSeconds: number;
  audioDurationSeconds?: number | null;
  narrationText: string;
  subtitleText: string;
  words?: TimedWord[];
  subtitleDisplayCues?: SubtitleDisplayCueInput[] | null;
};

type SubtitlePreviewEntry = {
  id: string;
  text: string;
  lines: string[];
  thumbnailUrl: string | null;
  startAtSeconds: number;
  durationSeconds: number;
};

function ratioToPercent(ratio: number) {
  return Number((ratio * 100).toFixed(1));
}

function toCssAspectRatio(aspectRatio: SubtitleRenderAspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return "16 / 9";
    case "1:1":
      return "1 / 1";
    default:
      return "9 / 16";
  }
}

function buildSubtitlePreviewEntries(
  materials: SubtitlePreviewMaterial[],
  narrationClips: SubtitlePreviewNarrationClip[],
  subtitleConfig: SubtitleConfig,
  subtitlePlan: SegmentSubtitlePlan[] | null | undefined,
) {
  if (!subtitleConfig.enabled) {
    return [];
  }

  if (narrationClips.length === 0) {
    if (materials.length > 0) {
      return materials.flatMap((material) => {
        const segmentSubtitleEntries =
          subtitlePlan?.find(
            (item) => item.segmentId === material.segmentId || item.segmentIndex === material.segmentIndex,
          )?.subtitles ?? [];
        const normalizedSubtitleEntries =
          segmentSubtitleEntries.length > 0
            ? segmentSubtitleEntries
            : [
                {
                  text: material.subtitleText || material.narrationText,
                  startAtSeconds: 0,
                  durationSeconds: material.durationSeconds,
                },
              ];
        const entryWordTimelines = splitSegmentWordTimelineBySubtitleEntries(
          normalizedSubtitleEntries.map((entry) => ({
            text: entry.text,
            startAtSeconds: entry.startAtSeconds,
            durationSeconds: entry.durationSeconds,
          })),
          material.wordTimeline ?? [],
        );

        return normalizedSubtitleEntries.flatMap((entry, index) => {
          const displayUnits = buildSubtitleDisplayUnits({
            text: entry.text,
            durationSeconds: entry.durationSeconds,
            words: entryWordTimelines[index] ?? [],
            maxCharsPerLine: subtitleConfig.maxCharsPerLine,
            displayMode: subtitleConfig.displayMode,
            trimEstimatedTail: true,
          });

          return displayUnits.map((unit, unitIndex) => ({
            id: `material-${material.segmentId}-${index + 1}-${unitIndex + 1}`,
            text: unit.text,
            lines: unit.lines,
            thumbnailUrl: material.thumbnailUrl ?? null,
            startAtSeconds: entry.startAtSeconds + unit.startOffsetSeconds,
            durationSeconds: unit.endOffsetSeconds - unit.startOffsetSeconds,
          }));
        });
      });
    }

    return (subtitlePlan ?? []).flatMap((segment) =>
      segment.subtitles.flatMap((entry, index) => {
        const displayUnits = buildSubtitleDisplayUnits({
          text: entry.text,
          durationSeconds: entry.durationSeconds,
          words: [],
          maxCharsPerLine: subtitleConfig.maxCharsPerLine,
          displayMode: subtitleConfig.displayMode,
          trimEstimatedTail: true,
        });

        return displayUnits.map((unit, unitIndex) => ({
          id: `plan-${segment.segmentId}-${index + 1}-${unitIndex + 1}`,
          text: unit.text,
          lines: unit.lines,
          thumbnailUrl: null,
          startAtSeconds: entry.startAtSeconds + unit.startOffsetSeconds,
          durationSeconds: unit.endOffsetSeconds - unit.startOffsetSeconds,
        }));
      }),
    );
  }

  const materialMap = new Map(materials.map((item) => [item.segmentId, item]));
  const entries: SubtitlePreviewEntry[] = [];

  for (const clip of [...narrationClips].sort((left, right) => left.startAtSeconds - right.startAtSeconds)) {
    const rawText = (clip.subtitleText || clip.narrationText || "").trim();
    if (!rawText) {
      continue;
    }

    const material =
      (clip.segmentId ? materialMap.get(clip.segmentId) : null) ??
      materials.find((item) => item.segmentIndex === clip.segmentIndex || item.shotIndex === clip.shotIndex) ??
      null;
    const wordTimeline = clip.words?.length ? clip.words : (material?.wordTimeline ?? []);
    const displayUnits = buildSubtitleDisplayUnits({
      text: rawText,
      durationSeconds: clip.audioDurationSeconds ?? clip.durationSeconds,
      words: wordTimeline,
      maxCharsPerLine: subtitleConfig.maxCharsPerLine,
      displayMode: subtitleConfig.displayMode,
      trimEstimatedTail: true,
      manualCues: clip.subtitleDisplayCues,
    });

    displayUnits.forEach((unit, index) => {
      entries.push({
        id: `${clip.id}-display-${index + 1}`,
        text: unit.text,
        lines: unit.lines,
        thumbnailUrl: material?.thumbnailUrl ?? null,
        startAtSeconds: clip.startAtSeconds + unit.startOffsetSeconds,
        durationSeconds: unit.endOffsetSeconds - unit.startOffsetSeconds,
      });
    });
  }

  return entries;
}

function getSubtitlePreviewStyle(
  subtitleConfig: SubtitleConfig,
  aspectRatio: SubtitleRenderAspectRatio,
  previewHeight: number,
): CSSProperties {
  if (!subtitleConfig.enabled) {
    return {
      color: "#E7ECFF",
      fontSize: "16px",
      fontWeight: 600,
      padding: "8px 12px",
      borderRadius: "999px",
      background: "rgba(18, 28, 47, 0.62)",
      whiteSpace: "nowrap",
    };
  }

  const decoration = getSubtitlePresetDecoration(subtitleConfig.stylePreset);
  const toneStyle = getSubtitleToneStyle(subtitleConfig);
  const typographyMetrics = getSubtitlePreviewTypographyMetrics(subtitleConfig, aspectRatio, previewHeight);
  const fontSize = typographyMetrics.fontSizePx;
  const outlineWidth = typographyMetrics.outlineWidthPx;
  const shadowBlur = typographyMetrics.shadowPx;
  const shadowOffsetY = Math.max(0.5, Number((shadowBlur * 0.45).toFixed(2)));
  const textShadow =
    subtitleConfig.stylePreset === "outline"
      ? `0 0 ${Math.max(1, Number((shadowBlur * 2).toFixed(2)))}px ${toneStyle.shadowColor}${Math.round(
          toneStyle.shadowOpacity * 255,
        )
          .toString(16)
          .padStart(2, "0")}`
      : shadowBlur > 0
        ? `0 ${shadowOffsetY}px ${Math.max(1, shadowBlur)}px rgba(0, 0, 0, ${toneStyle.shadowOpacity})`
        : "none";

  return {
    position: "absolute",
    left: `${ratioToPercent(subtitleConfig.horizontalPositionRatio)}%`,
    bottom: `${ratioToPercent(subtitleConfig.positionOffsetRatio)}%`,
    transform: "translateX(-50%)",
    maxWidth: "calc(100% - 20px)",
    color: subtitleConfig.textColor,
    fontFamily: getSubtitleFontFamilyNames(subtitleConfig.fontFamily).previewFontFamily,
    fontSize: `${fontSize}px`,
    fontWeight: decoration.bold ? 700 : 500,
    WebkitTextStroke: outlineWidth > 0 ? `${outlineWidth}px ${subtitleConfig.outlineColor}` : undefined,
    textShadow,
    background:
      subtitleConfig.stylePreset === "shadow"
        ? `rgba(0, 0, 0, ${toneStyle.backgroundOpacity})`
        : "transparent",
    padding: subtitleConfig.stylePreset === "shadow" ? "8px 10px" : undefined,
    borderRadius: subtitleConfig.stylePreset === "shadow" ? "4px" : undefined,
    whiteSpace: "pre-line",
    textAlign: "center",
    lineHeight: 1.22,
  };
}

export function SubtitlePreviewPanel({
  subtitleConfig,
  materials,
  narrationClips,
  subtitlePlan,
  aspectRatio = "9:16",
  title = "字幕预览",
}: {
  subtitleConfig: SubtitleConfig;
  materials?: SubtitlePreviewMaterial[];
  narrationClips?: SubtitlePreviewNarrationClip[];
  subtitlePlan?: SegmentSubtitlePlan[] | null;
  aspectRatio?: SubtitleRenderAspectRatio;
  title?: string;
}) {
  const [subtitlePreviewIndex, setSubtitlePreviewIndex] = useState(0);
  const previewScreenRef = useRef<HTMLDivElement | null>(null);
  const [previewHeight, setPreviewHeight] = useState(0);
  const subtitlePreviewEntries = useMemo(
    () =>
      buildSubtitlePreviewEntries(
        materials ?? [],
        narrationClips ?? [],
        subtitleConfig,
        subtitlePlan,
      ),
    [materials, narrationClips, subtitleConfig, subtitlePlan],
  );
  const subtitlePreviewTotal = subtitlePreviewEntries.length;
  const clampedSubtitlePreviewIndex =
    subtitlePreviewTotal > 0 ? Math.min(subtitlePreviewIndex, subtitlePreviewTotal - 1) : 0;
  const activeSubtitlePreviewEntry =
    subtitlePreviewTotal > 0 ? (subtitlePreviewEntries[clampedSubtitlePreviewIndex] ?? null) : null;

  useEffect(() => {
    const element = previewScreenRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const updatePreviewHeight = (nextHeight?: number) => {
      const measuredHeight = nextHeight ?? element.getBoundingClientRect().height;
      setPreviewHeight((current) => (Math.abs(current - measuredHeight) < 0.5 ? current : measuredHeight));
    };

    updatePreviewHeight();
    const observer = new ResizeObserver((entries) => {
      updatePreviewHeight(entries[0]?.contentRect.height);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <aside className="task-subtitle-preview-col">
      <div className="task-subtitle-preview-card">
        <div className="task-subtitle-preview-head">
          <strong>{title}</strong>
        </div>
        {activeSubtitlePreviewEntry ? (
          <>
            <div className="task-subtitle-preview-stage-wrap">
              <div
                ref={previewScreenRef}
                className="task-subtitle-preview-screen"
                style={{ aspectRatio: toCssAspectRatio(aspectRatio) }}
              >
                {activeSubtitlePreviewEntry.thumbnailUrl ? (
                  <Image
                    className="task-subtitle-preview-poster"
                    src={activeSubtitlePreviewEntry.thumbnailUrl}
                    alt=""
                    fill
                    unoptimized
                  />
                ) : (
                  <div className="task-subtitle-preview-bg" />
                )}
                <div
                  className="task-subtitle-preview-text"
                  style={getSubtitlePreviewStyle(subtitleConfig, aspectRatio, previewHeight)}
                >
                  {activeSubtitlePreviewEntry.lines.length
                    ? activeSubtitlePreviewEntry.lines.map((line, index) => (
                        <span key={`${activeSubtitlePreviewEntry.id}-line-${index}`}>{line}</span>
                      ))
                    : activeSubtitlePreviewEntry.text}
                </div>
              </div>
            </div>
            <div className="task-subtitle-preview-pager">
              <button
                className="btn-secondary small task-subtitle-preview-nav"
                type="button"
                onClick={() => setSubtitlePreviewIndex(Math.max(0, clampedSubtitlePreviewIndex - 1))}
                disabled={clampedSubtitlePreviewIndex <= 0}
              >
                上一条
              </button>
              <span className="task-subtitle-preview-page-indicator">{`第 ${clampedSubtitlePreviewIndex + 1} / ${subtitlePreviewTotal} 条`}</span>
              <button
                className="btn-secondary small task-subtitle-preview-nav"
                type="button"
                onClick={() => setSubtitlePreviewIndex(Math.min(subtitlePreviewTotal - 1, clampedSubtitlePreviewIndex + 1))}
                disabled={clampedSubtitlePreviewIndex >= subtitlePreviewTotal - 1}
              >
                下一条
              </button>
            </div>
          </>
        ) : (
          <div className="task-subtitle-preview-empty">字幕预览</div>
        )}
      </div>
    </aside>
  );
}
