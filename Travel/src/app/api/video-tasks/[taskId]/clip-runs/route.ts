import { NextRequest, NextResponse } from "next/server";

import { getEffectiveConstraintPrompt } from "../../../../../lib/constraint-prompt-store";
import { validateClipShots } from "../../../../../lib/generation-validator";
import { getDefaultKlingGenerationSettings } from "../../../../../lib/prompt";
import {
  buildTaskClipGenerationPrompt,
  buildTaskClipShotPayloads,
  getTaskClipNarrationResult,
  listTaskClipShots,
  parseTaskClipShots,
  upsertTaskClipShot,
} from "../../../../../lib/task-clip-store";
import { getTaskDirectorPlan } from "../../../../../lib/video-task-director";
import { getTaskVisualSelectedImageDataUrl, listTaskVisualSelectedImages } from "../../../../../lib/task-visual-image-store";
import { deleteVideoJob, deriveTaskName, getVideoJob, upsertVideoJob } from "../../../../../lib/video-job-store";
import { createVideoJobRecord, ensurePendingVideoJobPolling, scheduleVideoJobPolling } from "../../../../../lib/video-job-runner";
import { getProviderRuntime } from "../../../../../lib/video-provider-config";
import { submitLiveImageToVideoJob } from "../../../../../lib/video-provider";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { getVideoTaskStatusIndex } from "../../../../../lib/video-task-schema";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type ClipRunRequest =
  | { action: "generate_all" }
  | { action: "generate_shot"; shotIndex: number };

function patchTaskStatusByClipJobs(taskId: string) {
  const task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  const shotDefinitions = parseTaskClipShots(task, getTaskClipNarrationResult(taskId));
  const clipRecords = listTaskClipShots(taskId);
  const allCompleted =
    shotDefinitions.length > 0 &&
    shotDefinitions.every((shot) => {
      const record = clipRecords.find((item) => item.shotIndex === shot.shotIndex);
      const job = record?.videoJobId ? getVideoJob(record.videoJobId) : null;
      return Boolean(job && job.status === "COMPLETED");
    });

  if (allCompleted && getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("CLIPS_READY")) {
    return patchVideoTask(taskId, { status: "CLIPS_READY" });
  }

  if (!allCompleted && getVideoTaskStatusIndex(task.status) >= getVideoTaskStatusIndex("CLIPS_READY")) {
    return patchVideoTask(taskId, { status: "IMAGES_READY" });
  }

  return task;
}

async function submitShotClipJob(taskId: string, shotIndex: number) {
  const task = getVideoTask(taskId);
  if (!task) {
    throw new Error("视频任务不存在");
  }

  const narrationResult = getTaskClipNarrationResult(taskId);
  const requiresNarrationStage = getTaskDirectorPlan(task).audioCues.length > 0;
  if (!narrationResult && requiresNarrationStage) {
    throw new Error("请先完成字幕音频制作后再生成片段");
  }

  const shotDefinition = parseTaskClipShots(task, narrationResult).find((item) => item.shotIndex === shotIndex);
  const narrationClip = shotDefinition?.narrationClip ?? null;
  if (!shotDefinition || !narrationClip) {
    throw new Error(`镜头 ${shotIndex} 缺少字幕时间轴数据，无法生成片段`);
  }

  const selectedImage = listTaskVisualSelectedImages(taskId).find((item) => item.segmentId === shotDefinition.segmentId || item.shotIndex === shotIndex) ?? null;
  if (!selectedImage) {
    throw new Error(`镜头 ${shotIndex} 尚未确认视觉图片，无法生成片段`);
  }

  const sourceImageBase64 = getTaskVisualSelectedImageDataUrl(selectedImage.sessionId);
  if (!sourceImageBase64) {
    throw new Error(`镜头 ${shotIndex} 的视觉图片读取失败`);
  }

  const existingRecord = listTaskClipShots(taskId).find((item) => item.segmentId === shotDefinition.segmentId || item.shotIndex === shotIndex) ?? null;
  if (existingRecord?.lipSyncJobId) {
    deleteVideoJob(existingRecord.lipSyncJobId);
  }
  if (existingRecord?.videoJobId) {
    deleteVideoJob(existingRecord.videoJobId);
  }

  const prompt = buildTaskClipGenerationPrompt({
    segmentId: shotDefinition.segmentId,
    segmentMode: shotDefinition.segmentMode ?? "single_speaking",
    shotIndex,
    shotPrompt: shotDefinition.videoPrompt,
    multiPrompt: shotDefinition.multiPrompt,
    narrationClip,
    task,
  });
  const defaults = getDefaultKlingGenerationSettings();
  const naturalNarrationDuration = Math.max(
    narrationClip.audioDurationSeconds ?? 0,
    narrationClip.words?.length ? narrationClip.words[narrationClip.words.length - 1]?.endTime ?? 0 : 0,
    narrationClip.durationSeconds || 0,
  );
  const enableMultiShot = Boolean(shotDefinition.segmentMode === "multi_shot_montage" && shotDefinition.multiPrompt?.length);
  const generationSettings = {
    ...defaults,
    durationSeconds: Math.max(3, Math.round(naturalNarrationDuration || task.parameters.video.durationSeconds)),
    mode: task.parameters.video.mode,
    aspectRatio: task.parameters.video.aspectRatio,
    cfgScale: task.parameters.video.cfgScale,
    cameraControl: enableMultiShot ? "auto" : task.parameters.video.cameraControl,
    generateAudio: false,
    watermark: task.parameters.video.watermark,
    negativePrompt: getEffectiveConstraintPrompt("negative_prompt"),
    multiShot: enableMultiShot,
    shotType: enableMultiShot ? task.parameters.video.shotType : ("customize" as const),
    multiPrompt: enableMultiShot ? (shotDefinition.multiPrompt ?? []) : [],
    sourceImageUrl: selectedImage.imageUrl,
  };

  const submittedAt = new Date().toISOString();
  const submission = await submitLiveImageToVideoJob(prompt, {
    ...generationSettings,
    sourceImageBase64,
  });
  const taskName = deriveTaskName(`${task.title} 片段${shotIndex}`);
  const record = createVideoJobRecord({
    jobId: submission.jobId,
    sourceTaskId: taskId,
    taskName,
    originalPrompt: prompt,
    optimizedPrompt: prompt,
    strategy: {
      angle: `片段 ${shotIndex}`,
      hook: narrationClip.subtitleText,
      style: "Kling V3 片段生成",
    },
    submittedAt,
    status: "QUEUED",
    mode: "live",
    logs: submission.logs,
    provider: submission.provider,
    modelId: submission.modelId,
    generationSettings,
  });
  upsertVideoJob(record);
  scheduleVideoJobPolling(record.jobId);

  upsertTaskClipShot({
    taskId,
    segmentId: shotDefinition.segmentId,
    segmentIndex: shotDefinition.segmentIndex,
    shotIndex,
    shotTitle: `片段 ${shotIndex}`,
    segmentMode: shotDefinition.segmentMode,
    videoPrompt: shotDefinition.videoPrompt,
    multiPrompt: shotDefinition.multiPrompt,
    subtitleText: narrationClip.subtitleText,
    narrationText: narrationClip.narrationText,
    wordTimeline: narrationClip.words ?? [],
    visualImageSessionId: selectedImage.sessionId,
    visualImageUrl: selectedImage.imageUrl,
    durationSeconds: generationSettings.durationSeconds,
    videoJobId: record.jobId,
    lipSyncJobId: null,
    thumbnailUrl: null,
    createdAt: existingRecord?.createdAt ?? submittedAt,
    updatedAt: submittedAt,
    generatedAt: submittedAt,
  });
}

export async function GET(_: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const task = getVideoTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
  }

  ensurePendingVideoJobPolling();
  const runtime = getProviderRuntime("kling");
  const nextTask = patchTaskStatusByClipJobs(taskId) ?? task;
  const shots = await buildTaskClipShotPayloads(nextTask, { readOnly: true });
  const validation = validateClipShots(shots, nextTask);

  return NextResponse.json({
    task: nextTask,
    shots,
    validation,
    runtime: {
      providerLabel: runtime.providerLabel,
      modelId: runtime.modelId,
      liveEnabled: runtime.liveEnabled,
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const task = getVideoTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<ClipRunRequest>;
    if (body.action === "generate_all") {
      const existingShotIndexes = new Set(listTaskClipShots(taskId).map((item) => item.shotIndex));
      const shotDefinitions = parseTaskClipShots(task, getTaskClipNarrationResult(taskId));
      const targets = shotDefinitions.filter((item) => !existingShotIndexes.has(item.shotIndex));
      for (const shot of targets) {
        await submitShotClipJob(taskId, shot.shotIndex);
      }
      const nextTask = patchTaskStatusByClipJobs(taskId) ?? getVideoTask(taskId) ?? task;
      return NextResponse.json({
        task: nextTask,
        shots: await buildTaskClipShotPayloads(nextTask),
      });
    }

    if (body.action === "generate_shot") {
      const shotIndex = Number(body.shotIndex);
      if (!Number.isFinite(shotIndex) || shotIndex <= 0) {
        return NextResponse.json({ error: "镜头编号无效" }, { status: 400 });
      }

      await submitShotClipJob(taskId, shotIndex);
      const nextTask = patchTaskStatusByClipJobs(taskId) ?? getVideoTask(taskId) ?? task;
      return NextResponse.json({
        task: nextTask,
        shots: await buildTaskClipShotPayloads(nextTask),
      });
    }

    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "片段生成失败" },
      { status: 500 },
    );
  }
}
