import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getEffectiveConstraintPrompt } from "../../../../../lib/constraint-prompt-store";
import {
  directorPrimaryStepActionKeys,
  directorSecondaryStepActionKeys,
} from "../../../../../lib/director-step-actions";
import { validateClipShots } from "../../../../../lib/generation-validator";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";
import {
  createAdminTaskStageTracker,
  withAdminProviderCallTracking,
} from "../../../../../lib/admin-data-flow-tracking";
import { generateSeedreamImages } from "../../../../../lib/image-provider";
import { getImageGenerationRuntime } from "../../../../../lib/image-provider-config";
import { createMockVideoFromImage } from "../../../../../lib/mock-aigc-assets";
import { getDefaultKlingGenerationSettings, type KlingGenerationSettings } from "../../../../../lib/prompt";
import {
  buildTaskClipGenerationPrompt,
  buildSeedanceSegmentPrompt,
  buildTaskClipShotPayloads,
  getTaskClipNarrationResult,
  listTaskClipShots,
  parseTaskClipShots,
  upsertTaskClipShot,
} from "../../../../../lib/task-clip-store";
import { resolveNarrationClipSpokenText } from "../../../../../lib/subtitle-text-contract";
import { resolveTaskClipCompletionState } from "../../../../../lib/task-clip-completion";
import { getTaskDirectorPlan } from "../../../../../lib/video-task-director";
import {
  createDirectMaterialClipFromSource,
  resolveDirectMaterialClipPlan,
} from "../../../../../lib/video-material-direct-clip";
import { getVideoMaterial } from "../../../../../lib/video-material-store";
import {
  autoSelectRecommendedCandidates,
  generateTaskVisualImageShot,
  getTaskVisualSelectedImageDataUrl,
  listTaskVisualImageShots,
  listTaskVisualSelectedImages,
  parseTaskVisualImageShots,
} from "../../../../../lib/task-visual-image-store";
import {
  deriveTaskName,
  getVideoJob,
  listVideoJobs,
  upsertVideoJob,
} from "../../../../../lib/video-job-store";
import {
  createVideoJobRecord,
  ensurePendingVideoJobPolling,
  scheduleVideoJobPolling,
} from "../../../../../lib/video-job-runner";
import { getLipSyncProviderRuntime, getProviderRuntime } from "../../../../../lib/video-provider-config";
import { submitLiveImageToVideoJob, submitSeedanceVideoJob } from "../../../../../lib/video-provider";
import type { SeedanceGenerationInput } from "../../../../../lib/video-provider";
import { clampSeedanceSegmentDurationSeconds } from "../../../../../lib/video-duration-constraints";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { clearTaskCompositionOutputs } from "../../../../../lib/video-task-output-reset";
import { syncTaskVisualImageSelectionState } from "../../../../../lib/task-visual-image-stage";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { capVideoTaskStatus, getVideoTaskStatusIndex } from "../../../../../lib/video-task-schema";
import { resolveRuntimeAssetUrlToPath } from "../../../../../lib/runtime-storage";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type ClipRunRequest =
  | { action: typeof directorPrimaryStepActionKeys.buildVideoClips | "generate_all" }
  | { action: typeof directorSecondaryStepActionKeys.regenerateClipShot | "generate_shot"; shotIndex: number };

function inferImageContentType(publicUrl: string) {
  switch (extname(publicUrl).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
    default:
      return "image/png";
  }
}

function loadReferenceImage(publicUrl: string) {
  const absolutePath = resolveRuntimeAssetUrlToPath(publicUrl);
  const imageBuffer = readFileSync(absolutePath);
  return {
    imageBuffer,
    contentType: inferImageContentType(publicUrl),
  };
}

function findSelectedImageForShot(
  selectedImages: ReturnType<typeof listTaskVisualSelectedImages>,
  input: { shotIndex: number; segmentId: string },
) {
  const directMatch = selectedImages.find((item) => item.shotIndex === input.shotIndex) ?? null;
  if (directMatch) {
    return directMatch;
  }

  const segmentMatches = selectedImages.filter((item) => item.segmentId === input.segmentId);
  return segmentMatches.length === 1 ? segmentMatches[0] : null;
}

function patchTaskStatusByClipJobs(taskId: string) {
  const task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  const shotDefinitions = parseTaskClipShots(task, getTaskClipNarrationResult(taskId, task));
  const clipRecords = listTaskClipShots(taskId);
  const completionState = resolveTaskClipCompletionState({
    shotDefinitions,
    clipRecords,
    jobs: listVideoJobs(),
  });

  if (completionState.allCompleted && getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("CLIPS_READY")) {
    return patchVideoTask(taskId, { status: "CLIPS_READY" });
  }

  if (!completionState.allCompleted && getVideoTaskStatusIndex(task.status) >= getVideoTaskStatusIndex("CLIPS_READY")) {
    clearTaskCompositionOutputs(taskId);
    return patchVideoTask(taskId, {
      status: capVideoTaskStatus(task.status, "IMAGES_READY"),
      stageTimestamps: {
        CLIPS_READY: undefined,
        COMPOSITION_READY: undefined,
      },
    });
  }

  return task;
}

function resetTaskAfterClipMutation(taskId: string) {
  const task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  clearTaskCompositionOutputs(taskId);

  return patchVideoTask(taskId, {
    status: capVideoTaskStatus(task.status, "IMAGES_READY"),
    stageTimestamps: {
      CLIPS_READY: undefined,
      COMPOSITION_READY: undefined,
    },
  });
}

async function ensureSelectedImagesForClipGeneration(taskId: string) {
  const task = getVideoTask(taskId);
  if (!task) {
    throw new Error("视频任务不存在");
  }

  autoSelectRecommendedCandidates(taskId);

  const selectedImages = listTaskVisualSelectedImages(taskId);
  const selectedShotIndexes = new Set(selectedImages.map((item) => item.shotIndex));
  const visualShots = parseTaskVisualImageShots(task);
  const missingShots = visualShots.filter((shot) => !selectedShotIndexes.has(shot.shotIndex));
  const imageRuntime = getImageGenerationRuntime();

  for (const shot of missingShots) {
    const existingShot = listTaskVisualImageShots(taskId).find((item) => item.shotIndex === shot.shotIndex);
    if (existingShot?.candidates.length) {
      continue;
    }

    const stageTracker = createAdminTaskStageTracker({
      taskId,
      stageKey: "visual_images",
      provider: imageRuntime.providerLabel,
      modelId: imageRuntime.modelId,
    });

    try {
      if (
        !shot.needsAiFallback &&
        shot.referenceImageUrl &&
        (shot.generationMode === "photo_direct_i2v" || shot.generationMode === "photo_enhanced_i2v")
      ) {
        const referenceAsset = loadReferenceImage(shot.referenceImageUrl);
        await generateTaskVisualImageShot({
          task,
          segmentId: shot.segmentId,
          segmentIndex: shot.segmentIndex,
          shotIndex: shot.shotIndex,
          prompt: shot.prompt,
          assets: [
            {
              url: null,
              b64Json: referenceAsset.imageBuffer.toString("base64"),
            },
          ],
        });
      } else {
        const assets = await withAdminProviderCallTracking(
          {
            enabled: imageRuntime.liveEnabled,
            serviceName: "image.generate",
            provider: imageRuntime.providerLabel,
            modelId: imageRuntime.modelId,
            objectType: "video_task_visual_shot",
            objectId: `${taskId}:${shot.shotIndex}`,
          },
          () =>
            generateSeedreamImages({
              prompt: shot.prompt,
              size: shot.size,
              guidanceScale: shot.guidanceScale,
              watermark: shot.watermark,
              seed: task.parameters.image.seed,
              outputCount: 4,
            }),
        );

        await generateTaskVisualImageShot({
          task,
          segmentId: shot.segmentId,
          segmentIndex: shot.segmentIndex,
          shotIndex: shot.shotIndex,
          prompt: shot.prompt,
          assets,
        });
      }
      stageTracker.complete();
    } catch (error) {
      stageTracker.fail(error);
      throw error;
    }
  }

  syncTaskVisualImageSelectionState(taskId, {
    completionMessage: "已确认参考图，视觉阶段恢复完成",
  });
}

async function submitShotClipJob(taskId: string, shotIndex: number) {
  const task = getVideoTask(taskId);
  if (!task) {
    throw new Error("视频任务不存在");
  }

  const narrationResult = getTaskClipNarrationResult(taskId, task);
  const shotDefinition = parseTaskClipShots(task, narrationResult).find((item) => item.shotIndex === shotIndex);
  const narrationClip = shotDefinition?.narrationClip ?? null;
  if (!shotDefinition || !narrationClip) {
    throw new Error(`镜头 ${shotIndex} 缺少文案或时长数据，无法生成片段`);
  }

  const clipPayloads = await buildTaskClipShotPayloads(task, { readOnly: true });
  const currentShotPayload = clipPayloads.find((item) => item.shotIndex === shotIndex) ?? null;
  const shotPreRoll = shotDefinition.preRollSeconds ?? 0;
  const shotPostRoll = shotDefinition.postRollSeconds ?? 0;
  const rollPadding = shotPreRoll + shotPostRoll;
  const preferredDurationSeconds = Math.max(
    1,
    (narrationClip.audioDurationSeconds ?? 0) + rollPadding,
    (narrationClip.durationSeconds || 0) + rollPadding,
    (shotDefinition.durationSeconds || 0) + rollPadding,
  );
  const directMaterialClipPlan =
    !shotDefinition.requiresLipSync && currentShotPayload
      ? resolveDirectMaterialClipPlan(currentShotPayload.sourceShots, preferredDurationSeconds)
      : null;
  const sourceShotVisualFallback =
    currentShotPayload?.sourceShots.find((shot) => !shot.needsAiFallback && (shot.selectedVisualImageUrl || shot.referenceImageUrl)) ?? null;
  const directMaterial =
    directMaterialClipPlan && directMaterialClipPlan.materialId
      ? getVideoMaterial(directMaterialClipPlan.materialId)
      : null;
  const directMaterialOwnerMatches =
    directMaterial !== null && (directMaterial.ownerUserId === null || directMaterial.ownerUserId === task.ownerUserId);
  const isDirectMaterialClip =
    Boolean(directMaterialClipPlan) &&
    Boolean(directMaterial) &&
    Boolean(directMaterial?.videoFileUrl) &&
    directMaterialOwnerMatches;

  const allSelectedImages = listTaskVisualSelectedImages(taskId);
  const selectedImage = findSelectedImageForShot(allSelectedImages, shotDefinition);
  if (!selectedImage && !isDirectMaterialClip) {
    throw new Error(`镜头 ${shotIndex} 尚未确认视觉图片，无法生成片段`);
  }

  const sourceImageBase64 = selectedImage?.sessionId
    ? getTaskVisualSelectedImageDataUrl(selectedImage.sessionId)
    : null;
  if (!isDirectMaterialClip && !sourceImageBase64) {
    throw new Error(`镜头 ${shotIndex} 的视觉图片读取失败`);
  }
  const visualImageSessionId = selectedImage?.sessionId ?? sourceShotVisualFallback?.selectedVisualImageSessionId ?? "";
  const visualImageUrl =
    selectedImage?.imageUrl ??
    sourceShotVisualFallback?.selectedVisualImageUrl ??
    sourceShotVisualFallback?.referenceImageUrl ??
    "";

  const existingRecord = listTaskClipShots(taskId).find((item) => item.shotIndex === shotIndex) ?? null;
  if (existingRecord) {
    resetTaskAfterClipMutation(taskId);
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
    narrationClip.words?.length ? (narrationClip.words[narrationClip.words.length - 1]?.endTime ?? 0) : 0,
    narrationClip.durationSeconds || 0,
  );
  const enableMultiShot = Boolean(
    shotDefinition.segmentMode === "multi_shot_montage" && shotDefinition.multiPrompt?.length,
  );

  const runtime = getProviderRuntime();
  const submittedAt = new Date().toISOString();
  const stageTracker = createAdminTaskStageTracker({
    runId: `clip:${taskId}:${shotIndex}:${submittedAt}`,
    taskId,
    stageKey: "clip_generation",
    provider: isDirectMaterialClip ? "实拍素材直出" : runtime.liveEnabled ? runtime.providerLabel : "Mock 本地片段生成",
    modelId: isDirectMaterialClip
      ? "local/video-material-trim"
      : runtime.liveEnabled
        ? runtime.modelId
        : "mock/local-still-video",
    startedAt: submittedAt,
  });

	  let submission: {
	    jobId: string;
	    provider: "kling" | "seedance";
	    modelId: string;
	    logs: string[];
	    message: string;
	    optimizedPrompt?: string;
	    commercialChargeFreezeId?: string | null;
	    commercialChargeStatus?: "frozen" | "confirmed" | "released" | null;
	  } | null = null;
  let generationSettings: KlingGenerationSettings;
  let providerPrompt = prompt;

  try {
    if (isDirectMaterialClip && directMaterial && directMaterialClipPlan) {
      const directJobId = crypto.randomUUID();
      const directClip = await createDirectMaterialClipFromSource({
        taskId,
        jobId: directJobId,
        material: directMaterial,
        clipPlan: directMaterialClipPlan,
        preferredDurationSeconds,
      });
      const taskName = deriveTaskName(`${task.title} 片段${shotIndex}`);
      const directGenerationSettings = {
        ...defaults,
        durationSeconds: directClip.resolvedDurationSeconds,
        mode: task.parameters.video.mode,
        aspectRatio: task.parameters.video.aspectRatio,
        cfgScale: task.parameters.video.cfgScale,
        cameraControl: "auto" as const,
        generateAudio: false,
        watermark: false,
        negativePrompt: "",
        multiShot: false,
        shotType: "customize" as const,
        multiPrompt: [],
        sourceImageUrl: visualImageUrl || undefined,
      } satisfies KlingGenerationSettings;
      const directJob = upsertVideoJob({
        ...createVideoJobRecord({
          jobId: directJobId,
          sourceTaskId: taskId,
          taskName,
          originalPrompt: providerPrompt,
          optimizedPrompt: providerPrompt,
          strategy: {
            angle: `片段 ${shotIndex}`,
            hook: narrationClip.subtitleText,
            style: "实拍视频直出",
          },
          submittedAt,
          status: "COMPLETED",
          mode: "mock",
          logs: [
            `已从实拍视频素材 ${directMaterial.materialId} 直接裁切片段。`,
            `使用时间范围：${directClip.usedTimeRangeLabel}`,
          ],
          videoUrl: directClip.videoUrl,
          provider: null,
          modelId: "local/video-material-trim",
          generationSettings: directGenerationSettings,
        }),
        resolvedDurationSeconds: directClip.resolvedDurationSeconds,
      });
      stageTracker.complete({ finishedAt: directJob.updatedAt });

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
        visualImageSessionId,
        visualImageUrl,
        durationSeconds: directClip.resolvedDurationSeconds,
        videoJobId: directJob.jobId,
        lipSyncJobId: null,
        thumbnailUrl: null,
        createdAt: existingRecord?.createdAt ?? submittedAt,
        updatedAt: submittedAt,
        generatedAt: submittedAt,
      });
      return;
    } else if (runtime.provider === "seedance") {
      const directorPlan = getTaskDirectorPlan(task);
      const renderSegment = directorPlan.renderSegments.find((s) => s.segmentId === shotDefinition.segmentId);
      const segmentShotIndexes = renderSegment?.shotIndexes ?? [shotIndex];

      const segmentImageUrls: string[] = [];
      const shotDescriptions: Array<{
        shotIndex: number;
        prompt: string;
        durationSeconds?: number;
        startAtSeconds?: number;
        endAtSeconds?: number;
      }> = [];

      for (const si of segmentShotIndexes) {
        const storyShot = directorPlan.storyShots.find((item) => item.shotIndex === si);
        const img = (storyShot ? findSelectedImageForShot(allSelectedImages, storyShot) : null) ?? selectedImage;
        if (!img) {
          continue;
        }
        if (img.imageUrl?.startsWith("http")) {
          segmentImageUrls.push(img.imageUrl);
        } else if (img.imageUrl) {
          const dataUrl = getTaskVisualSelectedImageDataUrl(img.sessionId);
          if (dataUrl) {
            segmentImageUrls.push(dataUrl);
          }
        }
        shotDescriptions.push({
          shotIndex: si,
          prompt: storyShot?.videoPrompt || storyShot?.sceneDescription || shotDefinition.videoPrompt,
          durationSeconds: storyShot?.durationSeconds,
          startAtSeconds: storyShot?.startAtSeconds,
          endAtSeconds: storyShot?.endAtSeconds,
        });
      }

      if (segmentImageUrls.length === 0) {
        throw new Error(`片段 ${shotIndex} 没有可用的参考图片，请先在视觉图片步骤中生成并选定图片。`);
      }

      const segmentDuration = clampSeedanceSegmentDurationSeconds(
        (naturalNarrationDuration ||
          shotDefinition.durationSeconds ||
          narrationClip.durationSeconds ||
          task.parameters.video.durationSeconds) + rollPadding,
      );

      const seedancePrompt = buildSeedanceSegmentPrompt({
        segmentId: shotDefinition.segmentId,
        segmentIndex: shotDefinition.segmentIndex,
        shotDescriptions,
        narrationText: resolveNarrationClipSpokenText(narrationClip),
        durationSeconds: segmentDuration,
        task,
      });
      providerPrompt = seedancePrompt;

      const aspectRatioMap: Record<string, string> = { "16:9": "16:9", "9:16": "9:16", "1:1": "1:1" };
      const seedanceInput: SeedanceGenerationInput = {
        prompt: seedancePrompt,
        imageUrls: segmentImageUrls,
        durationSeconds: segmentDuration,
        ratio: aspectRatioMap[task.parameters.video.aspectRatio] ?? "9:16",
        resolution: "1080p",
        generateAudio: false,
        watermark: task.parameters.video.watermark,
      };

      generationSettings = {
        ...defaults,
        durationSeconds: seedanceInput.durationSeconds,
        mode: task.parameters.video.mode,
        aspectRatio: task.parameters.video.aspectRatio,
        cfgScale: task.parameters.video.cfgScale,
        cameraControl: "auto" as const,
        generateAudio: false,
        watermark: task.parameters.video.watermark,
        negativePrompt: getEffectiveConstraintPrompt("negative_prompt"),
        multiShot: false,
        shotType: "customize" as const,
        multiPrompt: [],
        sourceImageUrl: selectedImage?.imageUrl ?? visualImageUrl,
      };
      if (runtime.liveEnabled) {
        submission = await withAdminProviderCallTracking(
          {
            enabled: true,
            serviceName: "video.submit",
            provider: runtime.providerLabel,
            modelId: runtime.modelId,
            objectType: "video_task_clip",
            objectId: `${taskId}:${shotIndex}`,
          },
          () => submitSeedanceVideoJob(seedanceInput),
        );
      }
    } else {
      generationSettings = {
        ...defaults,
        durationSeconds: Math.max(3, Math.round((naturalNarrationDuration || task.parameters.video.durationSeconds) + rollPadding)),
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
        sourceImageUrl: selectedImage?.imageUrl ?? visualImageUrl,
      };
      if (runtime.liveEnabled) {
        submission = await withAdminProviderCallTracking(
          {
            enabled: true,
            serviceName: "video.submit",
            provider: runtime.providerLabel,
            modelId: runtime.modelId,
            objectType: "video_task_clip",
            objectId: `${taskId}:${shotIndex}`,
          },
          () =>
            submitLiveImageToVideoJob(prompt, {
              ...generationSettings,
              sourceImageBase64: sourceImageBase64!,
            }),
        );
      }
    }

    const providerLabel = runtime.liveEnabled
      ? runtime.provider === "seedance"
        ? "Seedance 2.0"
        : "Kling V3"
      : "Mock 本地片段生成";
    const taskName = deriveTaskName(`${task.title} 片段${shotIndex}`);
    let record;

    if (!runtime.liveEnabled) {
      if (!sourceImageBase64) {
        throw new Error(`镜头 ${shotIndex} 的视觉图片读取失败`);
      }
      const mockJobId = crypto.randomUUID();
      const mockVideo = await createMockVideoFromImage({
        taskId,
        jobId: mockJobId,
        sourceImageDataUrl: sourceImageBase64,
        durationSeconds: generationSettings.durationSeconds,
        aspectRatio: generationSettings.aspectRatio,
      });
      record = createVideoJobRecord({
        jobId: mockJobId,
        sourceTaskId: taskId,
        taskName,
        originalPrompt: providerPrompt,
        optimizedPrompt: providerPrompt,
        strategy: {
          angle: `片段 ${shotIndex}`,
          hook: narrationClip.subtitleText,
          style: `${providerLabel} 片段生成`,
        },
        submittedAt,
        status: "COMPLETED",
        mode: "mock",
        logs: [
          "视频 provider 未启用，已自动切换到本地 Mock 片段生成。",
          `片段 ${shotIndex} 已按参考图导出静态视频占位结果。`,
        ],
        videoUrl: mockVideo.videoUrl,
        provider: null,
        modelId: "mock/local-still-video",
        generationSettings,
      });
      record = upsertVideoJob({
        ...record,
        resolvedDurationSeconds: mockVideo.resolvedDurationSeconds,
      });
      stageTracker.complete({ finishedAt: record.updatedAt });
    } else {
      if (!submission) {
        throw new Error(`镜头 ${shotIndex} 任务提交失败`);
      }
      record = createVideoJobRecord({
        jobId: submission.jobId,
        sourceTaskId: taskId,
        taskName,
        originalPrompt: providerPrompt,
        optimizedPrompt: submission.optimizedPrompt ?? providerPrompt,
        strategy: {
          angle: `片段 ${shotIndex}`,
          hook: narrationClip.subtitleText,
          style: `${providerLabel} 片段生成`,
        },
        submittedAt,
        status: "QUEUED",
        mode: "live",
        logs: submission.logs,
        provider: submission.provider,
        modelId: submission.modelId,
        generationSettings,
        commercialChargeFreezeId: submission.commercialChargeFreezeId ?? null,
        commercialChargeStatus: submission.commercialChargeStatus ?? null,
      });
      upsertVideoJob(record);
      stageTracker.update("QUEUED");
      scheduleVideoJobPolling(record.jobId);
    }

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
      visualImageSessionId,
      visualImageUrl,
      durationSeconds: generationSettings.durationSeconds,
      videoJobId: record.jobId,
      lipSyncJobId: null,
      thumbnailUrl: null,
      createdAt: existingRecord?.createdAt ?? submittedAt,
      updatedAt: submittedAt,
      generatedAt: submittedAt,
    });
  } catch (error) {
    stageTracker.fail(error);
    throw error;
  }
}

function ensureImageSelectionStatus(taskId: string) {
  const task = getVideoTask(taskId);
  if (!task) return;
  if (getVideoTaskStatusIndex(task.status) >= getVideoTaskStatusIndex("IMAGES_READY")) return;
  syncTaskVisualImageSelectionState(taskId, {
    completionMessage: "已确认参考图，视觉阶段恢复完成",
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const access = requireOwnedVideoTask(request, taskId);
  if ("response" in access) {
    return access.response;
  }
  const { task } = access;

  ensureImageSelectionStatus(taskId);
  ensurePendingVideoJobPolling(taskId);
  const runtime = getProviderRuntime();
  const lipSyncRuntime = getLipSyncProviderRuntime();
  const nextTask = patchTaskStatusByClipJobs(taskId) ?? getVideoTask(taskId) ?? task;
  const shots = await buildTaskClipShotPayloads(nextTask, { readOnly: true });
  const validation = validateClipShots(shots, nextTask);

  const selectedImages = listTaskVisualSelectedImages(taskId);
  const enrichedShots = shots.map((shot) => {
    if (shot.visualImageSessionId || shot.visualImageUrl) return shot;
    const matchedImage = findSelectedImageForShot(selectedImages, shot);
    if (!matchedImage) return shot;
    return {
      ...shot,
      visualImageSessionId: matchedImage.sessionId,
      visualImageUrl: matchedImage.imageUrl,
    };
  });

  return NextResponse.json({
    task: nextTask,
    shots: enrichedShots,
    validation,
    runtime: {
      generation: {
        provider: runtime.provider,
        providerLabel: runtime.providerLabel,
        modelId: runtime.modelId,
        liveEnabled: runtime.liveEnabled,
      },
      lipSync: {
        provider: lipSyncRuntime.provider,
        providerLabel: lipSyncRuntime.providerLabel,
        modelId: lipSyncRuntime.modelId,
        liveEnabled: lipSyncRuntime.liveEnabled,
      },
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId, {
      forbiddenMessage: "无权修改该视频任务",
    });
    if ("response" in access) {
      return access.response;
    }
    ensureImageSelectionStatus(taskId);
    const { session } = access;
    const task = getVideoTask(taskId) ?? access.task;
    const withUsageContext = <T>(work: () => Promise<T>) =>
      runWithModelUsageContext(
        {
          userId: session.userId,
          routePath: "/api/video-tasks/[taskId]/clip-runs",
          objectType: "video_task",
          objectId: taskId,
        },
        work,
      );

    const body = (await request.json().catch(() => ({}))) as Partial<ClipRunRequest>;
    if (body.action === directorPrimaryStepActionKeys.buildVideoClips || body.action === "generate_all") {
      await withUsageContext(() => ensureSelectedImagesForClipGeneration(taskId));
      const existingClips = listTaskClipShots(taskId);
      const existingShotIndexes = new Set(existingClips.map((item) => item.shotIndex));
      const shotDefinitions = parseTaskClipShots(task, getTaskClipNarrationResult(taskId, task));
      const hasAllShots =
        shotDefinitions.length > 0 && shotDefinitions.every((item) => existingShotIndexes.has(item.shotIndex));
      const isRerun = hasAllShots && existingClips.length > 0;

      if (isRerun) {
        resetTaskAfterClipMutation(taskId);
      }

      const targets = isRerun
        ? shotDefinitions
        : shotDefinitions.filter((item) => !existingShotIndexes.has(item.shotIndex));
      await withUsageContext(async () => {
        for (const shot of targets) {
          await submitShotClipJob(taskId, shot.shotIndex);
        }
      });
      const nextTask = patchTaskStatusByClipJobs(taskId) ?? getVideoTask(taskId) ?? task;
      return NextResponse.json({
        task: nextTask,
        shots: await buildTaskClipShotPayloads(nextTask),
      });
    }

    if (body.action === directorSecondaryStepActionKeys.regenerateClipShot || body.action === "generate_shot") {
      await withUsageContext(() => ensureSelectedImagesForClipGeneration(taskId));
      const shotIndex = Number(body.shotIndex);
      if (!Number.isFinite(shotIndex) || shotIndex <= 0) {
        return NextResponse.json({ error: "镜头编号无效" }, { status: 400 });
      }

      await withUsageContext(() => submitShotClipJob(taskId, shotIndex));
      const nextTask = patchTaskStatusByClipJobs(taskId) ?? getVideoTask(taskId) ?? task;
      return NextResponse.json({
        task: nextTask,
        shots: await buildTaskClipShotPayloads(nextTask),
      });
    }

    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "片段生成失败" }, { status: 500 });
  }
}
