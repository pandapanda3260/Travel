import type { NarrationResultRecord } from "./narration-result-store";
import { formatDurationSecondsLabel, formatSecondValue } from "./duration-format";
import {
  countNarrationSpeechUnits,
  getNarrationDurationOverflowTolerance,
  isNarrationSpeechRateTooSlow,
} from "./narration";
import { countSubtitlePlanEntries, usesSegmentLevelSubtitleSource } from "./subtitle-plan-source";
import type { TaskClipShotPayload } from "./task-clip-store";
import { getExpectedClipSegmentCount, getExpectedVisualReferenceShotCount } from "./video-task-stage-counts";
import type { TimedWord, VideoTaskRecord } from "./video-task-schema";
import { getTaskDirectorPlan } from "./video-task-director";

export type ValidationIssue = {
  severity: "error" | "warning";
  shotIndex: number | null;
  category: "count" | "duration" | "content" | "layout";
  message: string;
};

export type ValidationReport = {
  stage: string;
  issues: ValidationIssue[];
  passed: boolean;
};

function formatValidationDuration(seconds: number) {
  return formatDurationSecondsLabel(seconds) ?? `${seconds} 秒`;
}

function formatValidationRate(rate: number) {
  return formatSecondValue(rate, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) ?? String(rate);
}

function getInternalPunctuationCount(text: string) {
  const withoutTerminal = text.replace(/[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]+$/u, "");
  return withoutTerminal.match(/[，。！？；、：,.!?;]/gu)?.length ?? 0;
}

function getMaxWordGapSeconds(words: TimedWord[]) {
  const sortedWords = [...words]
    .map((word) => ({
      startTime: Number(word.startTime) || 0,
      endTime: Number(word.endTime) || 0,
    }))
    .filter((word) => word.endTime >= word.startTime)
    .sort((left, right) => left.startTime - right.startTime);

  let maxGap = 0;
  for (let index = 1; index < sortedWords.length; index += 1) {
    const previous = sortedWords[index - 1]!;
    const current = sortedWords[index]!;
    maxGap = Math.max(maxGap, current.startTime - previous.endTime);
  }

  return maxGap;
}

function getLastWordEndTime(words: TimedWord[]) {
  if (words.length === 0) {
    return null;
  }

  return Math.max(...words.map((word) => Number(word.endTime) || 0));
}

export function inspectNarrationAudioQuality(input: {
  unitLabel: string;
  clipIndex: number;
  narrationText: string;
  subtitleText?: string | null;
  spokenText?: string | null;
  targetDurationSeconds: number;
  audioDurationSeconds: number | null | undefined;
  words?: TimedWord[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const text = (input.spokenText || input.narrationText || input.subtitleText || "").trim();
  const audioDurationSeconds = Number(input.audioDurationSeconds) || 0;
  const targetDurationSeconds = Number(input.targetDurationSeconds) || 0;
  const words = input.words ?? [];
  const speechUnits = countNarrationSpeechUnits(text);

  if (!text || audioDurationSeconds <= 0 || speechUnits <= 0) {
    return issues;
  }

  const unitsPerSecond = speechUnits / audioDurationSeconds;
  if (unitsPerSecond > 7.6) {
    issues.push({
      severity: "error",
      shotIndex: input.clipIndex,
      category: "duration",
      message: `${input.unitLabel} ${input.clipIndex} 语速异常偏快（约 ${formatValidationRate(unitsPerSecond)} 字/秒），听感容易像赶稿，建议重生成音频`,
    });
  } else if (unitsPerSecond > 6.4) {
    issues.push({
      severity: "warning",
      shotIndex: input.clipIndex,
      category: "duration",
      message: `${input.unitLabel} ${input.clipIndex} 语速偏快（约 ${formatValidationRate(unitsPerSecond)} 字/秒），建议降低语速或压缩信息密度`,
    });
  }

  const lastWordEndTime = getLastWordEndTime(words);
  if (lastWordEndTime != null && lastWordEndTime > audioDurationSeconds + 0.3) {
    issues.push({
      severity: "warning",
      shotIndex: input.clipIndex,
      category: "duration",
      message: `${input.unitLabel} ${input.clipIndex} 词级时间轴超过音频时长，字幕或节奏判断可能不稳定，建议重生成音频`,
    });
  }

  if (
    speechUnits >= 18 &&
    words.length >= 4 &&
    getInternalPunctuationCount(text) === 0 &&
    getMaxWordGapSeconds(words) < 0.08
  ) {
    issues.push({
      severity: "warning",
      shotIndex: input.clipIndex,
      category: "content",
      message: `${input.unitLabel} ${input.clipIndex} 长句缺少明显停顿，听起来容易一口气念完，建议加入自然断句后重合成`,
    });
  }

  if (targetDurationSeconds > 0) {
    const effectiveEndTime = lastWordEndTime ?? audioDurationSeconds;
    const tailMarginSeconds = targetDurationSeconds - effectiveEndTime;
    if (tailMarginSeconds >= 0 && tailMarginSeconds < 0.12 && speechUnits >= 8) {
      issues.push({
        severity: "warning",
        shotIndex: input.clipIndex,
        category: "duration",
        message: `${input.unitLabel} ${input.clipIndex} 尾音余量不足，合成到成片时容易显得收得太急，建议留出更自然的收尾空间`,
      });
    }
  }

  return issues;
}

export function validateNarrationResult(result: NarrationResultRecord, task: VideoTaskRecord): ValidationReport {
  const issues: ValidationIssue[] = [];
  const directorPlan = getTaskDirectorPlan(task);
  const expectedFromSubtitlePlan = countSubtitlePlanEntries(directorPlan.subtitlePlan);
  const expected = expectedFromSubtitlePlan > 0 ? expectedFromSubtitlePlan : directorPlan.audioCues.length;
  const unitLabel = usesSegmentLevelSubtitleSource(task.parameters.video.videoType) ? "片段" : "镜头";

  if (result.clips.length !== expected) {
    issues.push({
      severity: "error",
      shotIndex: null,
      category: "count",
      message: `字幕音频片段数量应为 ${expected}，实际为 ${result.clips.length}`,
    });
  }

  for (const clip of result.clips) {
    const clipIndex = usesSegmentLevelSubtitleSource(task.parameters.video.videoType)
      ? (clip.segmentIndex ?? clip.shotIndex)
      : clip.shotIndex;
    if (clip.hasVoice !== false && !clip.audioUrl) {
      issues.push({
        severity: "error",
        shotIndex: clipIndex,
        category: "content",
        message: `${unitLabel} ${clipIndex} 缺少音频文件`,
      });
    }

    const targetDuration = clip.durationSeconds;
    const effectiveAudioDuration = clip.audioDurationSeconds ?? clip.durationSeconds;
    const strictOverflowSeconds = getNarrationDurationOverflowTolerance(targetDuration);
    const mildOverflowSeconds = Math.max(0.35, targetDuration * 0.08);
    if (clip.hasVoice !== false && effectiveAudioDuration > targetDuration + strictOverflowSeconds) {
      issues.push({
        severity: "error",
        shotIndex: clipIndex,
        category: "duration",
        message: `${unitLabel} ${clipIndex} 解说时长 ${formatValidationDuration(effectiveAudioDuration)} 超过目标 ${formatValidationDuration(targetDuration)}，当前结果仍有明显超时风险`,
      });
    } else if (clip.hasVoice !== false && effectiveAudioDuration > targetDuration + mildOverflowSeconds) {
      issues.push({
        severity: "warning",
        shotIndex: clipIndex,
        category: "duration",
        message: `${unitLabel} ${clipIndex} 解说时长 ${formatValidationDuration(effectiveAudioDuration)} 略高于目标 ${formatValidationDuration(targetDuration)}，建议继续压缩口播`,
      });
    }

    if (clip.hasVoice !== false && clip.audioDurationSeconds && clip.narrationText.trim()) {
      const speechUnits = countNarrationSpeechUnits(clip.narrationText);
      const unitsPerSecond = speechUnits > 0 ? speechUnits / clip.audioDurationSeconds : 0;
      if (unitsPerSecond > 0 && unitsPerSecond < 1.45) {
        issues.push({
          severity: "error",
          shotIndex: clipIndex,
          category: "duration",
          message: `${unitLabel} ${clipIndex} 语速异常偏慢（约 ${formatValidationRate(unitsPerSecond)} 字/秒），建议重生成音频`,
        });
      } else if (isNarrationSpeechRateTooSlow(clip.narrationText, clip.audioDurationSeconds)) {
        issues.push({
          severity: "warning",
          shotIndex: clipIndex,
          category: "duration",
          message: `${unitLabel} ${clipIndex} 语速偏慢（约 ${formatValidationRate(unitsPerSecond)} 字/秒），建议复检该条音频`,
        });
      }
    }

    if (clip.hasVoice !== false) {
      issues.push(
        ...inspectNarrationAudioQuality({
          unitLabel,
          clipIndex,
          narrationText: clip.narrationText,
          subtitleText: clip.subtitleText,
          spokenText: clip.spokenText,
          targetDurationSeconds: clip.durationSeconds,
          audioDurationSeconds: clip.audioDurationSeconds,
          words: clip.words,
        }),
      );
    }

    if (!clip.narrationText?.trim() && !clip.subtitleText?.trim()) {
      issues.push({
        severity: "warning",
        shotIndex: clipIndex,
        category: "content",
        message: `${unitLabel} ${clipIndex} 缺少解说词和字幕文本`,
      });
    }
  }

  return {
    stage: "subtitle_audio",
    issues,
    passed: issues.filter((i) => i.severity === "error").length === 0,
  };
}

export function validateVisualImages(
  shotCount: number,
  selectedCount: number,
  task: VideoTaskRecord,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const expected = getExpectedVisualReferenceShotCount(task);

  if (shotCount !== expected) {
    issues.push({
      severity: "error",
      shotIndex: null,
      category: "count",
      message: `图片镜头数量应为 ${expected}，实际为 ${shotCount}`,
    });
  }

  if (selectedCount < expected) {
    issues.push({
      severity: selectedCount === 0 ? "error" : "warning",
      shotIndex: null,
      category: "count",
      message: `已确认 ${selectedCount}/${expected} 张图片${selectedCount < expected ? "，未全部确认" : ""}`,
    });
  }

  return {
    stage: "visual_images",
    issues,
    passed: issues.filter((i) => i.severity === "error").length === 0,
  };
}

export function validateClipShots(shots: TaskClipShotPayload[], task: VideoTaskRecord): ValidationReport {
  const issues: ValidationIssue[] = [];
  const expected = getExpectedClipSegmentCount(task);

  if (shots.length !== expected) {
    issues.push({
      severity: "error",
      shotIndex: null,
      category: "count",
      message: `视频片段数量应为 ${expected}，实际为 ${shots.length}`,
    });
  }

  const completedShots = shots.filter((s) => s.job?.status === "COMPLETED");
  const failedShots = shots.filter((s) => s.job?.status === "FAILED");

  if (failedShots.length > 0) {
    issues.push({
      severity: "error",
      shotIndex: null,
      category: "content",
      message: `${failedShots.length} 个片段生成失败：${failedShots.map((s) => `镜头 ${s.shotIndex}`).join("、")}`,
    });
  }

  for (const shot of completedShots) {
    if (!shot.job?.videoUrl && !shot.job?.remoteVideoUrl) {
      issues.push({
        severity: "error",
        shotIndex: shot.shotIndex,
        category: "content",
        message: `镜头 ${shot.shotIndex} 状态为已完成但缺少视频文件`,
      });
    }

    const targetDuration = shot.durationSeconds;
    const resolvedDuration = (shot.job as Record<string, unknown> | null)?.resolvedDurationSeconds as number | null;
    if (resolvedDuration != null) {
      const drift = Math.abs(resolvedDuration - targetDuration);
      if (drift > targetDuration * 0.25) {
        issues.push({
          severity: "warning",
          shotIndex: shot.shotIndex,
          category: "duration",
          message: `镜头 ${shot.shotIndex} 实际时长 ${formatValidationDuration(resolvedDuration)} 与目标 ${formatValidationDuration(targetDuration)} 偏差较大`,
        });
      }
    }
  }

  const pendingCount = expected - completedShots.length - failedShots.length;
  if (pendingCount > 0) {
    issues.push({
      severity: "warning",
      shotIndex: null,
      category: "count",
      message: `${pendingCount} 个片段尚未生成完成`,
    });
  }

  return {
    stage: "clip_generation",
    issues,
    passed: issues.filter((i) => i.severity === "error").length === 0,
  };
}
