import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { clearTaskGeneratedOutputs, shouldResetTaskGeneratedOutputs } from "../../../../lib/video-task-output-reset";
import {
  deleteKeyMaterialWorkflowsByTaskId,
  getActiveKeyMaterialWorkflow,
} from "../../../../lib/key-material-task-store";
import { hydrateTaskCreationParameterState } from "../../../../lib/task-creation-parameters";
import { normalizeNullableMediaSourceInput } from "../../../../lib/media-source-input";
import { getGeneratedVideoRecordForTask } from "../../../../lib/task-creation-index-data";
import { deriveVideoTaskStructure } from "../../../../lib/video-task-structure";
import { deleteTaskClipShotsByTaskId } from "../../../../lib/task-clip-store";
import { getVideoTaskReferenceMaterialById } from "../../../../lib/video-material-store";
import { deleteVideoTask, getVideoTask, patchVideoTask } from "../../../../lib/video-task-store";
import { reconcileVideoTaskRuntimeStatus } from "../../../../lib/video-task-runtime-status";
import { deleteVideoGenerationWorkflowsByTaskId } from "../../../../lib/video-generation-workflow-store";
import { removeMaterialLibraryItemsBySource } from "../../../../lib/material-library-store";
import { deleteNarrationResult, listNarrationResults } from "../../../../lib/narration-result-store";
import { deleteTaskVideoCompositions } from "../../../../lib/video-composition-store";
import { purgeVideoJobsBySourceTaskId } from "../../../../lib/video-job-store";
import {
  normalizeVideoTaskSource,
  taskConstraintPresets,
  videoTaskStatusFlow,
  type VideoTaskDraftBundle,
  type VideoTaskStatus,
} from "../../../../lib/video-task-schema";
import { deleteTaskArtifactDirectories } from "../../../../lib/task-artifact-cleanup";
import { deleteTaskStageProgressByTaskId } from "../../../../lib/task-stage-progress-store";
import { deleteTaskWorkflowEventsByTaskId } from "../../../../lib/task-workflow-event-store";
import { deleteTaskVisualImageShotsByTaskId } from "../../../../lib/task-visual-image-store";
import { deleteTaskHotelAssetsByTaskId } from "../../../../lib/task-hotel-asset-store";
import { deleteTaskHotelAssetOptimizationStatesByTaskId } from "../../../../lib/task-hotel-asset-optimization-store";
import {
  syncNarrationScriptIntoSubtitlePlan,
  usesSegmentLevelSubtitleSource,
} from "../../../../lib/subtitle-plan-source";
import type { VideoTaskSourcePatch } from "../../../../lib/video-task-schema";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type UpdateVideoTaskRequest = {
  title?: string;
  status?: VideoTaskStatus;
  draftBundle?: Partial<VideoTaskDraftBundle>;
  source?: VideoTaskSourcePatch;
  parameters?: Record<string, unknown>;
  resetGeneratedOutputs?: boolean;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { taskId } = await context.params;
    const task = getVideoTask(taskId);

    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }
    if (task.ownerUserId && task.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权访问该视频任务", code: "VIDEO_TASK_FORBIDDEN" }, { status: 403 });
    }

    const reconciledTask = reconcileVideoTaskRuntimeStatus(taskId) ?? task;

    return NextResponse.json({
      task: reconciledTask,
      generatedVideo: await getGeneratedVideoRecordForTask(reconciledTask),
      statusFlow: videoTaskStatusFlow,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "获取视频任务失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { taskId } = await context.params;
    const body = (await request.json().catch(() => null)) as UpdateVideoTaskRequest | null;
    if (!body) {
      return NextResponse.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
    }
    const existingTask = getVideoTask(taskId);
    if (!existingTask) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }
    if (existingTask.ownerUserId && existingTask.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权修改该视频任务", code: "VIDEO_TASK_FORBIDDEN" }, { status: 403 });
    }
    if (getActiveKeyMaterialWorkflow(taskId)) {
      return NextResponse.json({ error: "关键素材生成中，暂时不能修改任务内容，请稍后重试" }, { status: 409 });
    }
    const updates: Parameters<typeof patchVideoTask>[1] = {};

    if (body.title !== undefined) {
      const nextTitle = body.title.trim();
      updates.title = nextTitle || "未命名视频任务";
    }

    if (body.status !== undefined) {
      return NextResponse.json({ error: "任务状态不可直接修改" }, { status: 400 });
    }

    if (body.draftBundle) {
      const nextDraftBundle: Partial<VideoTaskDraftBundle> = {};

      if (body.draftBundle.textToImagePrompt !== undefined) {
        nextDraftBundle.textToImagePrompt = body.draftBundle.textToImagePrompt.trim();
      }

      if (body.draftBundle.imageToVideoPrompt !== undefined) {
        nextDraftBundle.imageToVideoPrompt = body.draftBundle.imageToVideoPrompt.trim();
      }

      if (body.draftBundle.narrationScript !== undefined) {
        nextDraftBundle.narrationScript = body.draftBundle.narrationScript.trim();
      }

      updates.draftBundle = nextDraftBundle;
    }

    if (body.source) {
      const nextSource: VideoTaskSourcePatch = {};

      if (body.source.productInfoId !== undefined) {
        nextSource.productInfoId = body.source.productInfoId?.trim() || null;
      }

      if (body.source.productInfoTitle !== undefined) {
        nextSource.productInfoTitle = body.source.productInfoTitle?.trim() || null;
      }

      if (body.source.productInfoSnapshot !== undefined) {
        nextSource.productInfoSnapshot = body.source.productInfoSnapshot;
      }

      if (body.source.userPrompt !== undefined) {
        nextSource.userPrompt = body.source.userPrompt;
      }

      if (body.source.optimizedUserPrompt !== undefined) {
        nextSource.optimizedUserPrompt = body.source.optimizedUserPrompt;
      }

      if (body.source.videoMaterialId !== undefined || body.source.videoTemplateId !== undefined) {
        const rawId =
          body.source.videoMaterialId !== undefined ? body.source.videoMaterialId : body.source.videoTemplateId;
        const referenceMaterial = getVideoTaskReferenceMaterialById(rawId, session.userId);
        const normalizedMaterialId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
        if (normalizedMaterialId && !referenceMaterial) {
          return NextResponse.json({ error: "参考视频素材不存在或无权访问" }, { status: 400 });
        }
        nextSource.videoMaterialId = referenceMaterial?.materialId ?? normalizedMaterialId;
        nextSource.videoMaterialName = referenceMaterial?.name ?? body.source.videoMaterialName?.trim() ?? null;
        nextSource.videoTemplatePrompt =
          referenceMaterial?.videoTemplatePrompt ?? body.source.videoTemplatePrompt ?? "";
      }

      updates.source = nextSource;
    }

    const resolvedSource = normalizeVideoTaskSource({
      ...existingTask.source,
      ...(updates.source ?? {}),
    });
    const resolvedDraftBundle = {
      ...existingTask.draftBundle,
      ...(updates.draftBundle ?? {}),
    };
    if (body.parameters) {
      const parameters = hydrateTaskCreationParameterState(body.parameters);
      const derivedStructure = deriveVideoTaskStructure({
        source: resolvedSource,
        videoType: parameters.videoType,
        expectedDurationRange: parameters.videoExpectedDurationRange,
        requestedSegmentCount: parameters.videoSegmentCount,
        requestedDurationSeconds: parameters.videoDurationSeconds,
        requestedStoryShotsPerSegment: undefined,
      });
      const presetKey = parameters.constraintPreset;
      const preset = taskConstraintPresets[presetKey] ?? taskConstraintPresets.general;
      const customRules = parameters.constraintCustomRules
        .split("\n")
        .map((rule) => rule.trim())
        .filter(Boolean);
      updates.parameters = {
        image: {
          size: parameters.imageSize,
          guidanceScale: parameters.imageGuidanceScale,
          watermark: parameters.imageWatermark,
          seed:
            parameters.imageSeedMode === "fixed" && parameters.imageSeedValue.trim()
              ? Number(parameters.imageSeedValue)
              : null,
        },
        video: {
          videoType: parameters.videoType,
          segmentMode: derivedStructure.segmentMode,
          expectedDurationRange: parameters.videoExpectedDurationRange,
          storyShotCount: derivedStructure.storyShotCount,
          storyShotsPerSegment: derivedStructure.storyShotsPerSegment,
          introSegmentDurationSeconds: derivedStructure.introSegmentDurationSeconds,
          mode: parameters.videoMode,
          multiShot: parameters.videoMultiShot,
          shotType: parameters.videoShotType,
          enableTailFrame: parameters.videoEnableTailFrame,
          segmentCount: derivedStructure.segmentCount,
          durationSeconds: derivedStructure.durationSeconds,
          aspectRatio: parameters.videoAspectRatio,
          cfgScale: parameters.videoCfgScale,
          cameraControl: parameters.videoCameraControl,
          generateAudio: parameters.videoGenerateAudio,
          watermark: parameters.videoWatermark,
          negativePrompt: parameters.videoNegativePrompt,
        },
        audio: {
          voiceId: parameters.audioStoryboardEnabled ? null : parameters.audioVoiceId,
          storyboardEnabled: parameters.audioStoryboardEnabled,
          storyboardVoiceIds: parameters.audioStoryboardEnabled
            ? parameters.audioStoryboardVoiceIds.slice(0, derivedStructure.storyShotCount)
            : [],
          format: parameters.audioFormat,
          sampleRate: parameters.audioSampleRate,
          speechRate: parameters.audioSpeechRate,
          loudnessRate: parameters.audioLoudnessRate,
          enableSubtitle: parameters.audioEnableSubtitle,
        },
        composition: {
          includeBackgroundMusic: parameters.compositionIncludeBackgroundMusic,
          backgroundMusicUrl: parameters.compositionIncludeBackgroundMusic
            ? normalizeNullableMediaSourceInput(parameters.compositionBackgroundMusicUrl)
            : null,
          backgroundMusicVolume: parameters.compositionBackgroundMusicVolume,
          subtitleConfig: parameters.compositionSubtitleConfig,
        },
        constraints: {
          ...preset.constraints,
          customRules,
        },
      };
    }
    const resolvedParameters = {
      ...existingTask.parameters,
      ...updates.parameters,
      image: {
        ...existingTask.parameters.image,
        ...updates.parameters?.image,
      },
      video: {
        ...existingTask.parameters.video,
        ...updates.parameters?.video,
      },
      audio: {
        ...existingTask.parameters.audio,
        ...updates.parameters?.audio,
      },
      composition: {
        ...existingTask.parameters.composition,
        ...updates.parameters?.composition,
      },
      constraints: {
        ...existingTask.parameters.constraints,
        ...updates.parameters?.constraints,
      },
    };
    const shouldResetGeneratedOutputsForDefinitionChange = shouldResetTaskGeneratedOutputs({
      task: existingTask,
      nextSource: resolvedSource,
      nextDraftBundle: resolvedDraftBundle,
      nextParameters: resolvedParameters,
    });

    const nextVideoType = updates.parameters?.video?.videoType ?? existingTask.parameters.video.videoType;
    if (
      updates.draftBundle?.narrationScript !== undefined &&
      usesSegmentLevelSubtitleSource(nextVideoType) &&
      existingTask.shotPlan
    ) {
      updates.shotPlan =
        syncNarrationScriptIntoSubtitlePlan(
          existingTask.shotPlan,
          updates.draftBundle.narrationScript,
          nextVideoType,
        ) ?? existingTask.shotPlan;
    }

    let task = patchVideoTask(taskId, updates);
    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    // Task detail PATCH is also used by UI autosave. Autosave must never destroy
    // completed media; explicit regeneration routes own downstream cleanup.
    if (body.resetGeneratedOutputs === true && shouldResetGeneratedOutputsForDefinitionChange) {
      deleteKeyMaterialWorkflowsByTaskId(taskId);
      deleteVideoGenerationWorkflowsByTaskId(taskId);
      deleteTaskStageProgressByTaskId(taskId);
      clearTaskGeneratedOutputs(taskId);
      task =
        patchVideoTask(taskId, {
          status: "CREATED",
          stageTimestamps: {
            SUBTITLE_AUDIO_READY: undefined,
            IMAGES_READY: undefined,
            CLIPS_READY: undefined,
            COMPOSITION_READY: undefined,
          },
        }) ?? task;
    }

    return NextResponse.json({
      task,
      generatedVideo: await getGeneratedVideoRecordForTask(task),
      statusFlow: videoTaskStatusFlow,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新视频任务失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { taskId } = await context.params;
    const existingTask = getVideoTask(taskId);

    if (!existingTask) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }
    if (existingTask.ownerUserId && existingTask.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权删除该视频任务", code: "VIDEO_TASK_FORBIDDEN" }, { status: 403 });
    }

    const relatedNarrations = listNarrationResults().filter((item) => item.taskId === taskId);
    for (const narration of relatedNarrations) {
      deleteNarrationResult(narration.resultId);
    }

    const relatedCompositions = deleteTaskVideoCompositions(taskId, { reason: "user_manual_delete" });
    for (const composition of relatedCompositions) {
      removeMaterialLibraryItemsBySource("video-composition-output", composition.compositionId);
    }

    deleteTaskVisualImageShotsByTaskId(taskId, { reason: "user_manual_delete" });
    deleteTaskHotelAssetOptimizationStatesByTaskId(taskId);
    deleteTaskHotelAssetsByTaskId(taskId);
    deleteTaskClipShotsByTaskId(taskId, { reason: "user_manual_delete" });

    const purgedJobIds = purgeVideoJobsBySourceTaskId(taskId, { reason: "user_manual_delete" });
    for (const jobId of purgedJobIds) {
      removeMaterialLibraryItemsBySource("video-generation-job", jobId);
    }

    const deletedTask = deleteVideoTask(taskId);

    if (!deletedTask) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    deleteTaskStageProgressByTaskId(taskId);
    deleteTaskWorkflowEventsByTaskId(taskId);
    deleteKeyMaterialWorkflowsByTaskId(taskId);
    deleteTaskArtifactDirectories(taskId, { reason: "user_manual_delete" });

    return NextResponse.json({
      ok: true,
      deletedTaskId: taskId,
      deletedCounts: {
        narrationResults: relatedNarrations.length,
        videoJobs: purgedJobIds.length,
        compositions: relatedCompositions.length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除视频任务失败" }, { status: 500 });
  }
}
