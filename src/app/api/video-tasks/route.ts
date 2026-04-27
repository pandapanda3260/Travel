import { NextRequest, NextResponse } from "next/server";

import { recordAdminDataEvent } from "../../../lib/admin-data-analytics";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../lib/auth-session";
import { createProgressStream } from "../../../lib/progress-stream";
import { directorPrimaryStepActionKeys } from "../../../lib/director-step-actions";
import { grantGrowthForEvent } from "../../../lib/member-service";
import { runWithModelUsageContext } from "../../../lib/model-usage-context";
import { grantPointsForEvent } from "../../../lib/points-service";
import { getTaskCreationIndexPayload } from "../../../lib/task-creation-index-data";
import { getTaskGenerationRuntime } from "../../../lib/task-generation-runtime";
import { buildPlanningSourceWithOptimizedPrompt } from "../../../lib/video-task-prompt-optimizer";
import {
  getDefaultTaskCreationParameterState,
  hydrateTaskCreationParameterState,
} from "../../../lib/task-creation-parameters";
import { normalizeNullableMediaSourceInput } from "../../../lib/media-source-input";
import { taskStageProgressKeys } from "../../../lib/task-stage-progress";
import { createTaskStageProgressReporter } from "../../../lib/task-stage-progress-store";
import { getVideoMaterial, getVideoTaskReferenceMaterialById } from "../../../lib/video-material-store";
import { generateVideoTaskDraftBundle } from "../../../lib/video-task-planner";
import { createVideoTask, patchVideoTask } from "../../../lib/video-task-store";
import { deriveVideoTaskStructure } from "../../../lib/video-task-structure";
import {
  hasVideoTaskSourceContent,
  normalizeVideoTaskSource,
  taskConstraintPresets,
  videoTaskStatusFlow,
  type VideoTaskSource,
} from "../../../lib/video-task-schema";

type CreateVideoTaskRequest = {
  action?: typeof directorPrimaryStepActionKeys.buildShotPlan | "ensure_input_task";
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

class BadRequestError extends Error {}

function buildTaskParameterBundle(
  source: VideoTaskSource,
  parameters: ReturnType<typeof hydrateTaskCreationParameterState>,
) {
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

  return {
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
}

function readOptionalString(value: unknown, label: string) {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestError(`${label} 必须是字符串`);
  }
  return value;
}

function readOptionalNullableString(value: unknown, label: string) {
  if (value === null) {
    return null;
  }
  return readOptionalString(value, label);
}

function parseCreateVideoTaskRequest(rawBody: unknown): CreateVideoTaskRequest {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new BadRequestError("请求体必须是 JSON 对象");
  }

  const body = rawBody as Record<string, unknown>;
  const rawParameters = body.parameters;
  if (rawParameters != null && (typeof rawParameters !== "object" || Array.isArray(rawParameters))) {
    throw new BadRequestError("parameters 必须是对象");
  }

  return {
    action: readOptionalString(body.action, "action") as CreateVideoTaskRequest["action"],
    title: readOptionalString(body.title, "title"),
    productInfoId: readOptionalNullableString(body.productInfoId, "productInfoId"),
    productInfoTitle: readOptionalNullableString(body.productInfoTitle, "productInfoTitle"),
    productInfoSnapshot: readOptionalString(body.productInfoSnapshot, "productInfoSnapshot"),
    userPrompt: readOptionalString(body.userPrompt, "userPrompt"),
    optimizedUserPrompt: readOptionalString(body.optimizedUserPrompt, "optimizedUserPrompt"),
    videoMaterialId: readOptionalNullableString(body.videoMaterialId, "videoMaterialId"),
    videoMaterialName: readOptionalNullableString(body.videoMaterialName, "videoMaterialName"),
    videoTemplatePrompt: readOptionalString(body.videoTemplatePrompt, "videoTemplatePrompt"),
    videoTemplateId: readOptionalNullableString(body.videoTemplateId, "videoTemplateId"),
    parameters: rawParameters as CreateVideoTaskRequest["parameters"],
  };
}

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const includeVoiceOptions = request.nextUrl.searchParams.get("includeVoiceOptions") !== "0";
    const payload = await getTaskCreationIndexPayload({ includeVoiceOptions, userId: session.userId });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载视频任务列表失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = parseCreateVideoTaskRequest(await request.json().catch(() => ({})));
    if (
      body.action &&
      body.action !== directorPrimaryStepActionKeys.buildShotPlan &&
      body.action !== "ensure_input_task"
    ) {
      return NextResponse.json({ error: "当前请求动作不支持创建镜头规划" }, { status: 400 });
    }
    const rawMaterialId =
      typeof body.videoMaterialId === "string" && body.videoMaterialId.trim()
        ? body.videoMaterialId.trim()
        : typeof body.videoTemplateId === "string"
          ? body.videoTemplateId.trim()
          : null;
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
    if (rawMaterialId && !referenceMaterial) {
      return NextResponse.json({ error: "参考视频素材不存在或无权访问" }, { status: 400 });
    }
    const source: VideoTaskSource = normalizeVideoTaskSource({
      productInfoId: body.productInfoId ?? null,
      productInfoTitle: body.productInfoTitle ?? null,
      productInfoSnapshot: body.productInfoSnapshot?.trim() ?? "",
      userPrompt: body.userPrompt?.trim() ?? "",
      optimizedUserPrompt: body.optimizedUserPrompt?.trim() ?? "",
      videoMaterialId: referenceMaterial?.materialId ?? rawMaterialId,
      videoMaterialName: referenceMaterial?.name ?? body.videoMaterialName?.trim() ?? null,
      videoTemplatePrompt: referenceMaterial?.videoTemplatePrompt ?? body.videoTemplatePrompt?.trim() ?? "",
    });

    const ensureInputTaskOnly = body.action === "ensure_input_task";
    if (!ensureInputTaskOnly && !hasVideoTaskSourceContent(source)) {
      return NextResponse.json(
        { error: "请至少选择商品信息、填写主动提示词或选择参考视频素材后再创建视频任务" },
        { status: 400 },
      );
    }

    const parameters = hydrateTaskCreationParameterState(body.parameters ?? {});
    const planningSource = buildPlanningSourceWithOptimizedPrompt(source);
    const taskParameterBundle = buildTaskParameterBundle(planningSource, parameters);

    const task = createVideoTask({
      ownerUserId: session.userId,
      title: body.title?.trim() ?? "",
      source,
      draftBundle: {
        textToImagePrompt: "",
        imageToVideoPrompt: "",
        narrationScript: "",
      },
      shotPlan: null,
      directorPlan: null,
      parameters: taskParameterBundle,
    });
    recordAdminDataEvent({
      eventName: ensureInputTaskOnly ? "video_task.input_draft_create" : "video_task.create",
      actorType: "user",
      actorId: session.userId,
      objectType: "video_task",
      objectId: task.taskId,
      metadata: {
        videoType: task.parameters.video.videoType,
        sourceProductInfoId: task.source.productInfoId,
        sourceVideoMaterialId: task.source.videoMaterialId,
      },
    });
    if (ensureInputTaskOnly) {
      return NextResponse.json({ task, statusFlow: videoTaskStatusFlow });
    }

    grantGrowthForEvent({
      userId: session.userId,
      eventType: "video_task_create",
      sourceType: "rule",
      sourceBizId: task.taskId,
      idempotentKey: `video_task_create:${task.taskId}`,
      remark: "创建视频任务",
    });
    grantPointsForEvent({
      userId: session.userId,
      eventType: "video_task_create",
      sourceType: "rule",
      sourceBizId: task.taskId,
      idempotentKey: `video_task_create:${task.taskId}`,
      remark: "创建视频任务",
    });

    return createProgressStream((onProgress) =>
      runWithModelUsageContext(
        {
          userId: session.userId,
          routePath: "/api/video-tasks",
          objectType: "video_task",
          objectId: task.taskId,
        },
        async () => {
          const plannerRuntime = getTaskGenerationRuntime();
          const stageProgress = createTaskStageProgressReporter({
            taskId: task.taskId,
            stageKey: taskStageProgressKeys.shotPlan,
            provider: plannerRuntime.providerLabel,
            modelId: plannerRuntime.modelId,
            initialMessage: "任务已创建",
            initialPercent: 1,
          });
          const emitProgress = (step: string, percent: number, message: string, extra?: Record<string, unknown>) => {
            onProgress(step, percent, message, extra);
            stageProgress.onProgress(step, percent, message);
          };

          emitProgress("task_created", 1, "任务已创建", { task });

          try {
            const { draftBundle, shotPlan, directorPlan } = await generateVideoTaskDraftBundle(
              planningSource,
              taskParameterBundle,
              emitProgress,
              {
                referenceVideoMaterial: detailedReferenceMaterial,
              },
            );

            const updatedTask = patchVideoTask(task.taskId, {
              draftBundle,
              shotPlan,
              directorPlan,
            });

            if (!updatedTask) {
              throw new Error("视频任务已创建，但镜头规划写入失败");
            }

            stageProgress.complete("镜头规划已生成");
            return { task: updatedTask, statusFlow: videoTaskStatusFlow };
          } catch (error) {
            stageProgress.fail(error);
            throw error;
          }
        },
      ),
    );
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建视频任务失败" }, { status: 500 });
  }
}
