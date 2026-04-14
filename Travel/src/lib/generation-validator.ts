import type { NarrationResultRecord } from "./narration-result-store";
import { countNarrationSpeechUnits, isNarrationSpeechRateTooSlow } from "./narration";
import type { TaskClipShotPayload } from "./task-clip-store";
import type { VideoTaskRecord } from "./video-task-schema";
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

export function validateNarrationResult(result: NarrationResultRecord, task: VideoTaskRecord): ValidationReport {
  const issues: ValidationIssue[] = [];
  const directorPlan = getTaskDirectorPlan(task);
  const expected = directorPlan.audioCues.length;

  if (result.clips.length !== expected) {
    issues.push({
      severity: "error",
      shotIndex: null,
      category: "count",
      message: `字幕音频片段数量应为 ${expected}，实际为 ${result.clips.length}`,
    });
  }

  for (const clip of result.clips) {
    if (clip.hasVoice !== false && !clip.audioUrl) {
      issues.push({
        severity: "error",
        shotIndex: clip.shotIndex,
        category: "content",
        message: `镜头 ${clip.shotIndex} 缺少音频文件`,
      });
    }

    const targetDuration = clip.durationSeconds;
    const effectiveAudioDuration = clip.audioDurationSeconds ?? clip.durationSeconds;
    const strictOverflowSeconds = Math.max(0.35, targetDuration * 0.08);
    const mildOverflowSeconds = Math.max(0.18, targetDuration * 0.04);
    if (clip.hasVoice !== false && effectiveAudioDuration > targetDuration + strictOverflowSeconds) {
      issues.push({
        severity: "error",
        shotIndex: clip.shotIndex,
        category: "duration",
        message: `镜头 ${clip.shotIndex} 解说时长 ${effectiveAudioDuration.toFixed(1)}s 超过目标 ${targetDuration}s，当前结果仍有明显超时风险`,
      });
    } else if (clip.hasVoice !== false && effectiveAudioDuration > targetDuration + mildOverflowSeconds) {
      issues.push({
        severity: "warning",
        shotIndex: clip.shotIndex,
        category: "duration",
        message: `镜头 ${clip.shotIndex} 解说时长 ${effectiveAudioDuration.toFixed(1)}s 略高于目标 ${targetDuration}s，建议继续压缩口播`,
      });
    }

    if (clip.hasVoice !== false && clip.audioDurationSeconds && clip.narrationText.trim()) {
      const speechUnits = countNarrationSpeechUnits(clip.narrationText);
      const unitsPerSecond = speechUnits > 0 ? speechUnits / clip.audioDurationSeconds : 0;
      if (unitsPerSecond > 0 && unitsPerSecond < 1.7) {
        issues.push({
          severity: "error",
          shotIndex: clip.shotIndex,
          category: "duration",
          message: `镜头 ${clip.shotIndex} 语速异常偏慢（约 ${unitsPerSecond.toFixed(2)} 字/秒），建议重生成音频`,
        });
      } else if (isNarrationSpeechRateTooSlow(clip.narrationText, clip.audioDurationSeconds)) {
        issues.push({
          severity: "warning",
          shotIndex: clip.shotIndex,
          category: "duration",
          message: `镜头 ${clip.shotIndex} 语速偏慢（约 ${unitsPerSecond.toFixed(2)} 字/秒），建议复检该条音频`,
        });
      }
    }

    if (!clip.narrationText?.trim() && !clip.subtitleText?.trim()) {
      issues.push({
        severity: "warning",
        shotIndex: clip.shotIndex,
        category: "content",
        message: `镜头 ${clip.shotIndex} 缺少解说词和字幕文本`,
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
  const directorPlan = getTaskDirectorPlan(task);
  const expected = directorPlan.renderSegments.length;

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
  const directorPlan = getTaskDirectorPlan(task);
  const expected = directorPlan.renderSegments.length;

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
          message: `镜头 ${shot.shotIndex} 实际时长 ${resolvedDuration.toFixed(1)}s 与目标 ${targetDuration}s 偏差较大`,
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
