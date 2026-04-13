import { NextRequest, NextResponse } from "next/server";

import { hydrateTaskCreationParameterState } from "../../../../lib/task-creation-parameters";
import { deriveVideoTaskStructure } from "../../../../lib/video-task-structure";
import { deleteTaskClipShotsByTaskId } from "../../../../lib/task-clip-store";
import { getVideoTaskReferenceMaterialById } from "../../../../lib/video-material-store";
import { deleteVideoTask, getVideoTask, patchVideoTask } from "../../../../lib/video-task-store";
import { removeMaterialLibraryItemsBySource } from "../../../../lib/material-library-store";
import { deleteNarrationResult, listNarrationResults } from "../../../../lib/narration-result-store";
import { deleteVideoComposition, listVideoCompositions } from "../../../../lib/video-composition-store";
import { purgeVideoJobsBySourceTaskId } from "../../../../lib/video-job-store";
import {
  normalizeVideoTaskSource,
  taskConstraintPresets,
  videoTaskStatusFlow,
  type VideoTaskDraftBundle,
  type VideoTaskStatus,
} from "../../../../lib/video-task-schema";
import { deleteTaskArtifactDirectories } from "../../../../lib/task-artifact-cleanup";
import { deleteTaskVisualImageShotsByTaskId } from "../../../../lib/task-visual-image-store";
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
};

export async function GET(_: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const task = getVideoTask(taskId);

    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    return NextResponse.json({
      task,
      statusFlow: videoTaskStatusFlow,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "获取视频任务失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const updates: Parameters<typeof patchVideoTask>[1] = {};

    if (body.title !== undefined) {
      const nextTitle = body.title.trim();
      if (!nextTitle) {
        return NextResponse.json({ error: "任务标题不能为空" }, { status: 400 });
      }
      updates.title = nextTitle;
    }

    if (body.status) {
      updates.status = body.status;
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

      if (body.source.videoMaterialId !== undefined || body.source.videoTemplateId !== undefined) {
        const rawId =
          body.source.videoMaterialId !== undefined ? body.source.videoMaterialId : body.source.videoTemplateId;
        const referenceMaterial = getVideoTaskReferenceMaterialById(rawId);
        const normalizedMaterialId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
        nextSource.videoMaterialId = referenceMaterial?.materialId ?? normalizedMaterialId;
        nextSource.videoMaterialName = referenceMaterial?.name ?? body.source.videoMaterialName?.trim() ?? null;
        nextSource.videoTemplatePrompt =
          referenceMaterial?.videoTemplatePrompt ?? body.source.videoTemplatePrompt ?? "";
      }

      updates.source = nextSource;
    }

    if (body.parameters) {
      const parameters = hydrateTaskCreationParameterState(body.parameters);
      const resolvedSource = normalizeVideoTaskSource({
        ...existingTask.source,
        ...(updates.source ?? {}),
      });
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
        constraints: {
          ...preset.constraints,
          customRules,
        },
      };
    }

    const task = patchVideoTask(taskId, updates);
    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    return NextResponse.json({
      task,
      statusFlow: videoTaskStatusFlow,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新视频任务失败" }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const existingTask = getVideoTask(taskId);

    if (!existingTask) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    const relatedNarrations = listNarrationResults().filter((item) => item.taskId === taskId);
    for (const narration of relatedNarrations) {
      deleteNarrationResult(narration.resultId);
    }

    const relatedCompositions = listVideoCompositions().filter((item) => item.taskId === taskId);
    for (const composition of relatedCompositions) {
      deleteVideoComposition(composition.compositionId);
      removeMaterialLibraryItemsBySource("video-composition-output", composition.compositionId);
    }

    deleteTaskVisualImageShotsByTaskId(taskId);
    deleteTaskClipShotsByTaskId(taskId);

    const purgedJobIds = purgeVideoJobsBySourceTaskId(taskId);
    for (const jobId of purgedJobIds) {
      removeMaterialLibraryItemsBySource("video-generation-job", jobId);
    }

    const deletedTask = deleteVideoTask(taskId);

    if (!deletedTask) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    deleteTaskArtifactDirectories(taskId);

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
