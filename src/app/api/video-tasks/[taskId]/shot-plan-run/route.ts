import { NextRequest, NextResponse } from "next/server";

import { createProgressStream } from "../../../../../lib/progress-stream";

import { directorPrimaryStepActionKeys } from "../../../../../lib/director-step-actions";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";
import { getTaskGenerationRuntime } from "../../../../../lib/task-generation-runtime";
import { buildPlanningSourceWithOptimizedPrompt } from "../../../../../lib/video-task-prompt-optimizer";
import { taskStageProgressKeys } from "../../../../../lib/task-stage-progress";
import { createTaskStageProgressReporter } from "../../../../../lib/task-stage-progress-store";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import {
  getDefaultTaskCreationParameterState,
  hydrateTaskCreationParameterState,
  normalizeCompositionBackgroundMusicVolume,
} from "../../../../../lib/task-creation-parameters";
import { normalizeNullableMediaSourceInput } from "../../../../../lib/media-source-input";
import { generateVideoTaskDraftBundle } from "../../../../../lib/video-task-planner";
import { getVideoMaterial, getVideoTaskReferenceMaterialById } from "../../../../../lib/video-material-store";
import { deriveVideoTaskStructure } from "../../../../../lib/video-task-structure";
import {
  deleteKeyMaterialWorkflowsByTaskId,
  getActiveKeyMaterialWorkflow,
} from "../../../../../lib/key-material-task-store";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { listTaskHotelAssets } from "../../../../../lib/task-hotel-asset-store";
import {
  hasVideoTaskSourceContent,
  normalizeVideoTaskSource,
  taskConstraintPresets,
  usesCapturedMaterialFirstWorkflow,
  type VideoTaskRecord,
  type VideoTaskSource,
} from "../../../../../lib/video-task-schema";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type ShotPlanRunRequest = {
  action?: typeof directorPrimaryStepActionKeys.buildShotPlan;
  title?: string;
  productInfoId?: string | null;
  productInfoTitle?: string | null;
  productInfoSnapshot?: string;
  userPrompt?: string;
  optimizedUserPrompt?: string;
  videoMaterialId?: string | null;
  videoMaterialName?: string | null;
  videoTemplatePrompt?: string;
  /** @deprecated 使用 videoMaterialId */
  videoTemplateId?: string | null;
  parameters?: Partial<ReturnType<typeof getDefaultTaskCreationParameterState>>;
};

function normalizeCapturedMaterialDerivedStructure(
  structure: ReturnType<typeof deriveVideoTaskStructure>,
  input: {
    enabled: boolean;
    usableAssetCount: number;
  },
): ReturnType<typeof deriveVideoTaskStructure> {
  if (!input.enabled || input.usableAssetCount <= 0) {
    return structure;
  }

  const storyShotCount = Math.max(1, Math.min(structure.storyShotCount, input.usableAssetCount));
  const segmentCount = Math.max(1, Math.min(structure.segmentCount, storyShotCount));

  return {
    ...structure,
    storyShotCount,
    segmentCount,
    storyShotsPerSegment: Math.max(1, Math.ceil(storyShotCount / segmentCount)),
  };
}

function buildTaskCreationFallbackParameters(
  task: VideoTaskRecord,
): Partial<ReturnType<typeof getDefaultTaskCreationParameterState>> {
  const defaults = getDefaultTaskCreationParameterState();
  return {
    ...defaults,
    imageSize: task.parameters.image.size as ReturnType<typeof getDefaultTaskCreationParameterState>["imageSize"],
    imageGuidanceScale: task.parameters.image.guidanceScale as ReturnType<
      typeof getDefaultTaskCreationParameterState
    >["imageGuidanceScale"],
    imageWatermark: task.parameters.image.watermark,
    imageSeedMode: task.parameters.image.seed == null ? "random" : "fixed",
    imageSeedValue: task.parameters.image.seed == null ? defaults.imageSeedValue : String(task.parameters.image.seed),
    videoType: task.parameters.video.videoType,
    videoMode: task.parameters.video.mode,
    videoMultiShot: task.parameters.video.multiShot,
    videoShotType: task.parameters.video.shotType,
    videoEnableTailFrame: task.parameters.video.enableTailFrame,
    videoExpectedDurationRange: task.parameters.video.expectedDurationRange,
    videoSegmentCount: task.parameters.video.segmentCount as ReturnType<
      typeof getDefaultTaskCreationParameterState
    >["videoSegmentCount"],
    videoDurationSeconds: task.parameters.video.durationSeconds as ReturnType<
      typeof getDefaultTaskCreationParameterState
    >["videoDurationSeconds"],
    videoAspectRatio: task.parameters.video.aspectRatio,
    videoCfgScale: task.parameters.video.cfgScale as ReturnType<
      typeof getDefaultTaskCreationParameterState
    >["videoCfgScale"],
    videoCameraControl: task.parameters.video.cameraControl,
    videoGenerateAudio: task.parameters.video.generateAudio,
    videoWatermark: task.parameters.video.watermark,
    videoNegativePrompt: task.parameters.video.negativePrompt,
    audioStoryboardEnabled: task.parameters.audio.storyboardEnabled,
    audioVoiceId: task.parameters.audio.voiceId ?? defaults.audioVoiceId,
    audioStoryboardVoiceIds: task.parameters.audio.storyboardVoiceIds,
    audioFormat: task.parameters.audio.format,
    audioSampleRate: task.parameters.audio.sampleRate,
    audioSpeechRate: task.parameters.audio.speechRate,
    audioLoudnessRate: task.parameters.audio.loudnessRate,
    audioEnableSubtitle: task.parameters.audio.enableSubtitle,
    compositionIncludeBackgroundMusic: task.parameters.composition.includeBackgroundMusic,
    compositionBackgroundMusicUrl: task.parameters.composition.backgroundMusicUrl ?? "",
    compositionBackgroundMusicVolume: normalizeCompositionBackgroundMusicVolume(
      task.parameters.composition.backgroundMusicVolume,
    ),
    compositionSubtitleConfig: task.parameters.composition.subtitleConfig,
    constraintPreset: defaults.constraintPreset,
    constraintCustomRules: task.parameters.constraints.customRules.join("\n"),
  };
}

async function clearDownstreamArtifacts(taskId: string) {
  void taskId;
  // Rebuilding a plan must not physically delete generated files. Existing
  // outputs remain available until a later generation step successfully replaces them.
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
    const { session } = access;
    const existingTask = getVideoTask(taskId) ?? access.task;
    if (getActiveKeyMaterialWorkflow(taskId)) {
      return NextResponse.json({ error: "关键素材生成中，暂时不能重建镜头规划，请稍后重试" }, { status: 409 });
    }

    const body = (await request.json().catch(() => ({}))) as ShotPlanRunRequest;
    if (body.action && body.action !== directorPrimaryStepActionKeys.buildShotPlan) {
      return NextResponse.json({ error: "当前请求动作不支持镜头规划重建" }, { status: 400 });
    }

    const requestedMaterialId =
      typeof body.videoMaterialId === "string" && body.videoMaterialId.trim()
        ? body.videoMaterialId.trim()
        : typeof body.videoTemplateId === "string"
          ? body.videoTemplateId.trim()
          : null;
    const rawMaterialId = requestedMaterialId ?? existingTask.source.videoMaterialId;
    const referenceMaterial = getVideoTaskReferenceMaterialById(rawMaterialId, session.userId);
    const detailedReferenceMaterial = rawMaterialId
      ? (() => {
          const material = getVideoMaterial(rawMaterialId);
          if (!material) {
            return null;
          }
          if (material.ownerUserId && material.ownerUserId !== session.userId) {
            return null;
          }
          return material;
        })()
      : null;
    if (requestedMaterialId && !referenceMaterial) {
      return NextResponse.json({ error: "参考视频素材不存在或无权访问" }, { status: 400 });
    }

    const source: VideoTaskSource = normalizeVideoTaskSource({
      ...existingTask.source,
      productInfoId: body.productInfoId ?? existingTask.source.productInfoId,
      productInfoTitle: body.productInfoTitle ?? existingTask.source.productInfoTitle,
      productInfoSnapshot: body.productInfoSnapshot ?? existingTask.source.productInfoSnapshot,
      userPrompt: body.userPrompt ?? existingTask.source.userPrompt,
      optimizedUserPrompt: body.optimizedUserPrompt ?? existingTask.source.optimizedUserPrompt,
      videoMaterialId: referenceMaterial?.materialId ?? rawMaterialId,
      videoMaterialName: referenceMaterial?.name ?? body.videoMaterialName ?? existingTask.source.videoMaterialName,
      videoTemplatePrompt:
        referenceMaterial?.videoTemplatePrompt ?? body.videoTemplatePrompt ?? existingTask.source.videoTemplatePrompt,
    });
    const title = body.title?.trim() || existingTask.title;
    if (!title.trim()) {
      return NextResponse.json({ error: "任务名称不能为空" }, { status: 400 });
    }
    const parameters = hydrateTaskCreationParameterState({
      ...buildTaskCreationFallbackParameters(existingTask),
      ...(body.parameters ?? {}),
    });
    const hotelAssets = usesCapturedMaterialFirstWorkflow(parameters.videoType) ? listTaskHotelAssets(taskId) : [];
    if (!hasVideoTaskSourceContent(source) && hotelAssets.length === 0) {
      return NextResponse.json(
        { error: "请至少保留商品信息、主动提示词、参考视频素材或酒店实拍图中的一项内容后再生成镜头规划" },
        { status: 400 },
      );
    }

    const presetKey = parameters.constraintPreset;
    const preset = taskConstraintPresets[presetKey] ?? taskConstraintPresets.general;
    const customRules = parameters.constraintCustomRules
      .split("\n")
      .map((rule) => rule.trim())
      .filter(Boolean);
    const constraints = { ...preset.constraints, customRules };
    const planningSource = buildPlanningSourceWithOptimizedPrompt(source);

    const derivedStructure = normalizeCapturedMaterialDerivedStructure(
      deriveVideoTaskStructure({
        source: planningSource,
        videoType: parameters.videoType,
        expectedDurationRange: parameters.videoExpectedDurationRange,
        requestedSegmentCount: parameters.videoSegmentCount,
        requestedDurationSeconds: parameters.videoDurationSeconds,
        requestedStoryShotsPerSegment: undefined,
      }),
      {
        enabled: usesCapturedMaterialFirstWorkflow(parameters.videoType),
        usableAssetCount: hotelAssets.length,
      },
    );

    const taskParameterBundle = {
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
      constraints,
    };

    return createProgressStream((onProgress) =>
      runWithModelUsageContext(
        {
          userId: session.userId,
          routePath: "/api/video-tasks/[taskId]/shot-plan-run",
          objectType: "video_task",
          objectId: taskId,
        },
        async () => {
          const plannerRuntime = getTaskGenerationRuntime();
          const stageProgress = createTaskStageProgressReporter({
            taskId,
            stageKey: taskStageProgressKeys.shotPlan,
            provider: plannerRuntime.providerLabel,
            modelId: plannerRuntime.modelId,
            initialMessage: "开始重建镜头规划...",
            initialPercent: 1,
          });
          const emitProgress = (step: string, percent: number, message: string, extra?: Record<string, unknown>) => {
            onProgress(step, percent, message, extra);
            stageProgress.onProgress(step, percent, message);
          };

          try {
            const { draftBundle, shotPlan, directorPlan } = await generateVideoTaskDraftBundle(
              planningSource,
              taskParameterBundle,
              emitProgress,
              {
                hotelAssets,
                referenceVideoMaterial: detailedReferenceMaterial,
              },
            );

            deleteKeyMaterialWorkflowsByTaskId(taskId);
            await clearDownstreamArtifacts(taskId);

            const now = new Date().toISOString();
            const task = patchVideoTask(taskId, {
              title,
              status: "CREATED",
              source,
              draftBundle,
              shotPlan,
              directorPlan,
              parameters: taskParameterBundle,
              stageTimestamps: {
                CREATED: now,
                SUBTITLE_AUDIO_READY: undefined,
                IMAGES_READY: undefined,
                CLIPS_READY: undefined,
                COMPOSITION_READY: undefined,
              },
            });

            if (!task) {
              throw new Error("镜头规划重建失败，任务不存在");
            }

            stageProgress.complete("镜头规划已生成");
            return { task };
          } catch (error) {
            stageProgress.fail(error);
            throw error;
          }
        },
      ),
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "镜头规划重建失败" }, { status: 500 });
  }
}
