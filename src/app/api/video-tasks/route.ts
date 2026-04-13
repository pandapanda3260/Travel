import { NextRequest, NextResponse } from "next/server";

import { getUnifiedTimbreCatalog, resolveTimbreResourceId } from "../../../lib/doubao-timbre-service";
import { getSpeakerDisplayNameOverride } from "../../../lib/speaker-display-overrides";
import {
  getDefaultTaskCreationParameterState,
  hydrateTaskCreationParameterState,
} from "../../../lib/task-creation-parameters";
import { getTaskGenerationRuntime } from "../../../lib/task-generation-runtime";
import { getVideoTaskReferenceMaterialById, listVideoTaskReferenceMaterials } from "../../../lib/video-material-store";
import { generateVideoTaskDraftBundle } from "../../../lib/video-task-planner";
import { createVideoTask, listVideoTasks } from "../../../lib/video-task-store";
import { listProductArchives } from "../../../lib/product-archive-store";
import { deriveVideoTaskStructure } from "../../../lib/video-task-structure";
import { listVideoJobs, type VideoJobRecord } from "../../../lib/video-job-store";
import { ensurePendingVideoJobPolling } from "../../../lib/video-job-runner";
import { listClonedVoices, listFavoriteSpeakerIds } from "../../../lib/voice-management-store";
import {
  normalizeVideoTaskSource,
  taskConstraintPresets,
  videoTaskStatusFlow,
  type VideoTaskGeneratedVideoRecord,
  type VideoTaskGeneratedVideoType,
  type VideoTaskRecord,
  type VideoTaskSource,
} from "../../../lib/video-task-schema";

type CreateVideoTaskRequest = {
  title?: string;
  productInfoId?: string | null;
  productInfoTitle?: string | null;
  productInfoSnapshot?: string;
  userPrompt?: string;
  videoMaterialId?: string | null;
  videoMaterialName?: string | null;
  videoTemplatePrompt?: string;
  /** @deprecated 使用 videoMaterialId */
  videoTemplateId?: string | null;
  parameters?: Partial<ReturnType<typeof getDefaultTaskCreationParameterState>>;
};

async function buildGeneratedVideoRecords(tasks: VideoTaskRecord[]): Promise<VideoTaskGeneratedVideoRecord[]> {
  const terminalJobs = listVideoJobs().filter((job) => job.status === "COMPLETED" || job.status === "FAILED");
  const assignments = new Map<string, VideoJobRecord>();

  for (const task of tasks) {
    const taskJobs = terminalJobs
      .filter((job) => job.sourceTaskId === task.taskId)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

    if (taskJobs[0]) {
      assignments.set(task.taskId, taskJobs[0]);
    }
  }

  const records: VideoTaskGeneratedVideoRecord[] = [];

  for (const task of tasks) {
    const job = assignments.get(task.taskId);
    if (!job) {
      continue;
    }

    const type: VideoTaskGeneratedVideoType = job.mode === "composition" ? "DIRECTOR" : "AUTO";

    records.push({
      taskId: task.taskId,
      taskTitle: task.title,
      videoJobId: job.jobId,
      type,
      status: job.status === "FAILED" ? "FAILED" : "COMPLETED",
      createdAt: task.createdAt,
      originalPrompt: job.originalPrompt,
      optimizedPrompt: job.optimizedPrompt,
      videoUrl: job.videoUrl,
      modelId: job.modelId,
      resolvedDurationSeconds: job.resolvedDurationSeconds,
      generationSettings: job.generationSettings
        ? {
            durationSeconds: job.generationSettings.durationSeconds,
            aspectRatio: job.generationSettings.aspectRatio,
            shotType: job.generationSettings.shotType,
            generateAudio: job.generationSettings.generateAudio,
            negativePrompt: job.generationSettings.negativePrompt,
          }
        : null,
      error: job.error,
    });
  }

  return records;
}

async function getTaskCreationVoiceOptions() {
  const catalog = await getUnifiedTimbreCatalog();
  const catalogMap = new Map(catalog.map((item) => [item.speakerId, item]));

  const clonedVoices = listClonedVoices()
    .filter((v) => v.status === "SUCCESS" || v.status === "ACTIVE")
    .filter((v) => Boolean(resolveTimbreResourceId(v.speakerId)));

  const favoriteIds = listFavoriteSpeakerIds();
  const clonedSpeakerIds = new Set(clonedVoices.map((v) => v.speakerId));

  const cloneOptions = clonedVoices.map((v) => ({
    label: `${getSpeakerDisplayNameOverride(v.speakerId) ?? catalogMap.get(v.speakerId)?.speakerName ?? v.alias ?? v.title}（复刻）`,
    value: v.speakerId,
    description: v.transcript,
    group: "my" as const,
  }));

  const favoriteOptions = favoriteIds
    .filter((id) => !clonedSpeakerIds.has(id))
    .map((id) => catalogMap.get(id))
    .filter((item) => item && Boolean(resolveTimbreResourceId(item.speakerId)))
    .map((item) => ({
      label: `${getSpeakerDisplayNameOverride(item!.speakerId) ?? item!.speakerName}`,
      value: item!.speakerId,
      description: item!.description,
      group: "fav" as const,
    }));

  return [...cloneOptions, ...favoriteOptions];
}

export async function GET(_: NextRequest) {
  try {
    // 服务重启后恢复所有 QUEUED/IN_PROGRESS 任务的后台轮询
    ensurePendingVideoJobPolling();

    const runtime = getTaskGenerationRuntime();
    const tasks = listVideoTasks();
    const productArchives = listProductArchives();
    const referenceVideoMaterialOptions = listVideoTaskReferenceMaterials();
    const [generatedVideosResult, voiceOptionsResult] = await Promise.allSettled([
      buildGeneratedVideoRecords(tasks),
      getTaskCreationVoiceOptions(),
    ]);

    return NextResponse.json({
      tasks,
      generatedVideos: generatedVideosResult.status === "fulfilled" ? generatedVideosResult.value : [],
      statusFlow: videoTaskStatusFlow,
      runtime: {
        textProviderLabel: runtime.providerLabel,
        textLiveEnabled: runtime.liveEnabled,
        textModelId: runtime.modelId,
        productInfoReady: productArchives.length > 0,
        voiceOptions: voiceOptionsResult.status === "fulfilled" ? voiceOptionsResult.value : [],
      },
      productOptions: productArchives.map((item) => ({
        id: item.archiveId,
        title: item.title,
        snapshot: item.parsedText.trim() || item.parsedData.sellingPoints.join("，"),
      })),
      referenceVideoMaterialOptions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载视频任务列表失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateVideoTaskRequest;
    const rawMaterialId =
      typeof body.videoMaterialId === "string" && body.videoMaterialId.trim()
        ? body.videoMaterialId.trim()
        : typeof body.videoTemplateId === "string"
          ? body.videoTemplateId.trim()
          : null;
    const referenceMaterial = getVideoTaskReferenceMaterialById(rawMaterialId);
    const source: VideoTaskSource = normalizeVideoTaskSource({
      productInfoId: body.productInfoId ?? null,
      productInfoTitle: body.productInfoTitle ?? null,
      productInfoSnapshot: body.productInfoSnapshot?.trim() ?? "",
      userPrompt: body.userPrompt?.trim() ?? "",
      videoMaterialId: referenceMaterial?.materialId ?? rawMaterialId,
      videoMaterialName: referenceMaterial?.name ?? body.videoMaterialName?.trim() ?? null,
      videoTemplatePrompt: referenceMaterial?.videoTemplatePrompt ?? body.videoTemplatePrompt?.trim() ?? "",
    });

    if (!source.productInfoSnapshot.trim() && !source.userPrompt.trim() && !source.videoTemplatePrompt.trim()) {
      return NextResponse.json(
        { error: "请至少选择商品信息、填写主动提示词或选择参考视频素材后再创建视频任务" },
        { status: 400 },
      );
    }

    const parameters = hydrateTaskCreationParameterState(body.parameters ?? {});
    const presetKey = parameters.constraintPreset;
    const preset = taskConstraintPresets[presetKey] ?? taskConstraintPresets.general;
    const customRules = parameters.constraintCustomRules
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    const constraints = { ...preset.constraints, customRules };
    const derivedStructure = deriveVideoTaskStructure({
      source,
      videoType: parameters.videoType,
      expectedDurationRange: parameters.videoExpectedDurationRange,
      requestedSegmentCount: parameters.videoSegmentCount,
      requestedDurationSeconds: parameters.videoDurationSeconds,
      requestedStoryShotsPerSegment: undefined,
    });

    const { draftBundle, shotPlan, directorPlan } = await generateVideoTaskDraftBundle(source, {
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
      constraints,
    });
    const task = createVideoTask({
      title: body.title?.trim() ?? "",
      source,
      draftBundle,
      shotPlan,
      directorPlan,
      parameters: {
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
        constraints,
      },
    });

    return NextResponse.json({
      task,
      statusFlow: videoTaskStatusFlow,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建视频任务失败" }, { status: 500 });
  }
}
