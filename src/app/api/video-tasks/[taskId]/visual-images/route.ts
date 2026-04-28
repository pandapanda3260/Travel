import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { createProgressStream } from "../../../../../lib/progress-stream";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";
import {
  createAdminTaskStageTracker,
  withAdminProviderCallTracking,
} from "../../../../../lib/admin-data-flow-tracking";
import {
  directorPrimaryStepActionKeys,
  directorSecondaryStepActionKeys,
} from "../../../../../lib/director-step-actions";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { generateSeedreamImages } from "../../../../../lib/image-provider";
import { getImageGenerationRuntime } from "../../../../../lib/image-provider-config";
import type { TaskVisualImageQualityCheck } from "../../../../../lib/task-visual-image-quality-check";
import { reviewTaskVisualImageBatch } from "../../../../../lib/task-visual-image-quality-check";
import { getVisionRuntime } from "../../../../../lib/vision-provider-config";
import { WeightedProgressTracker } from "../../../../../lib/weighted-progress-tracker";
import { validateVisualImages } from "../../../../../lib/generation-validator";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { capVideoTaskStatus, usesCapturedMaterialFirstWorkflow } from "../../../../../lib/video-task-schema";
import {
  clearTaskClipAndCompositionOutputs,
  clearTaskClipAndCompositionOutputsForShotIndexes,
} from "../../../../../lib/video-task-output-reset";
import { taskStageProgressKeys } from "../../../../../lib/task-stage-progress";
import { createTaskStageProgressReporter } from "../../../../../lib/task-stage-progress-store";
import { syncTaskVisualImageSelectionState } from "../../../../../lib/task-visual-image-stage";
import {
  autoSelectRecommendedCandidates,
  clearTaskVisualImageSelection,
  generateTaskVisualImageShot,
  listTaskVisualImageShots,
  parseTaskVisualImageShots,
  selectTaskVisualImageCandidate,
  type TaskVisualImageShotDraft,
  uploadTaskVisualImage,
} from "../../../../../lib/task-visual-image-store";
import { getActiveKeyMaterialWorkflow } from "../../../../../lib/key-material-task-store";
import { resolveRuntimeAssetUrlToPath } from "../../../../../lib/runtime-storage";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type VisualImagesRequest =
  | {
      action: typeof directorPrimaryStepActionKeys.buildVisualReferences | "generate_all";
      regenerateAll?: boolean;
    }
  | { action: typeof directorSecondaryStepActionKeys.regenerateShotImages | "generate_shot"; shotIndex: number }
  | {
      action: typeof directorSecondaryStepActionKeys.selectVisualCandidate | "select_candidate";
      shotIndex: number;
      candidateId: string;
    }
  | { action: typeof directorSecondaryStepActionKeys.clearVisualSelection | "clear_selection"; shotIndex: number }
  | { action: "sync_captured_material_shots"; force?: boolean }
  | { action: "upload_image"; shotIndex: number; imageData: string };

type CheckedImageAsset = Awaited<ReturnType<typeof generateSeedreamImages>>[number] & {
  qualityCheck?: TaskVisualImageQualityCheck;
};

const INITIAL_IMAGE_OUTPUT_COUNT = 6;
const RETRY_IMAGE_OUTPUT_COUNT = 3;
const MIN_ACCEPTABLE_CANDIDATE_COUNT = 3;
const MAX_SELF_CHECK_RETRY_ROUNDS = 1;
const MAX_MANUAL_UPLOAD_IMAGE_BYTES = 20 * 1024 * 1024;

function detectSupportedImageContentType(bytes: Buffer, declaredContentType: string) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }

  const normalizedContentType = declaredContentType.toLowerCase();
  if (["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(normalizedContentType)) {
    return normalizedContentType === "image/jpg" ? "image/jpeg" : normalizedContentType;
  }
  return null;
}

function isSelectVisualCandidateAction(action: unknown) {
  return action === directorSecondaryStepActionKeys.selectVisualCandidate || action === "select_candidate";
}

function attachQualityChecks(
  assets: Awaited<ReturnType<typeof generateSeedreamImages>>,
  checks: TaskVisualImageQualityCheck[],
): CheckedImageAsset[] {
  return assets.map((asset, index) => ({
    ...asset,
    qualityCheck: checks[index],
  }));
}

function selectPersistableVisualImageAssets(assets: CheckedImageAsset[]) {
  if (assets.length <= INITIAL_IMAGE_OUTPUT_COUNT) {
    return assets;
  }

  return assets
    .map((asset, index) => ({ asset, index }))
    .sort((left, right) => {
      const leftFailed = left.asset.qualityCheck?.status === "failed";
      const rightFailed = right.asset.qualityCheck?.status === "failed";
      if (leftFailed !== rightFailed) {
        return leftFailed ? 1 : -1;
      }
      return left.index - right.index;
    })
    .slice(0, INITIAL_IMAGE_OUTPUT_COUNT)
    .map((item) => item.asset);
}

async function generateValidatedAssetsForShot(input: {
  task: NonNullable<ReturnType<typeof getVideoTask>>;
  shot: TaskVisualImageShotDraft;
  referenceImageDataUrl?: string | null;
  onStatus?: (message: string) => void;
}) {
  const imageRuntime = getImageGenerationRuntime();
  const visionRuntime = getVisionRuntime();
  const stageTracker = createAdminTaskStageTracker({
    taskId: input.task.taskId,
    stageKey: "visual_images",
    provider: imageRuntime.providerLabel,
    modelId: imageRuntime.modelId,
  });
  let collectedAssets: CheckedImageAsset[] = [];
  let bestValidCount = 0;

  try {
    for (let attempt = 0; attempt <= MAX_SELF_CHECK_RETRY_ROUNDS; attempt += 1) {
      const outputCount = attempt === 0 ? INITIAL_IMAGE_OUTPUT_COUNT : RETRY_IMAGE_OUTPUT_COUNT;
      input.onStatus?.(
        attempt === 0
          ? `镜头 ${input.shot.shotIndex} 参考图生成中...`
          : `镜头 ${input.shot.shotIndex} 自检发现异常，自动补生成中...`,
      );

      const freshAssets = await withAdminProviderCallTracking(
        {
          enabled: imageRuntime.liveEnabled,
          serviceName: "image.generate",
          provider: imageRuntime.providerLabel,
          modelId: imageRuntime.modelId,
          objectType: "video_task_visual_shot",
          objectId: `${input.task.taskId}:${input.shot.shotIndex}`,
        },
        () =>
          generateSeedreamImages({
            prompt: input.shot.prompt,
            size: input.shot.size,
            guidanceScale: input.shot.guidanceScale,
            watermark: input.shot.watermark,
            seed: input.task.parameters.image.seed,
            outputCount,
            referenceImageDataUrl: input.referenceImageDataUrl,
          }),
      );

      input.onStatus?.(`镜头 ${input.shot.shotIndex} 参考图自检中...`);
      const review = await withAdminProviderCallTracking(
        {
          enabled: visionRuntime.liveEnabled,
          serviceName: "image.self_check",
          provider: visionRuntime.providerLabel,
          modelId: visionRuntime.modelId,
          objectType: "video_task_visual_shot",
          objectId: `${input.task.taskId}:${input.shot.shotIndex}`,
        },
        () =>
          reviewTaskVisualImageBatch({
            prompt: input.shot.prompt,
            shotTitle: input.shot.shotTitle,
            hasMainCharacter: Boolean(input.shot.hasMainCharacter),
            sceneContextText: input.shot.sceneContextText,
            assets: freshAssets,
          }),
      );

      const checkedAssets = attachQualityChecks(freshAssets, review.results);
      collectedAssets = [...collectedAssets, ...checkedAssets];
      bestValidCount += review.validCount;

      const anatomyFailureCount = review.results.filter((item) =>
        item.issues.some((issue) =>
          /多手|多臂|多腿|多脚|第三只手|第三只脚|肢体数量异常|extra limb|extra arm|extra hand|extra leg/i.test(issue),
        ),
      ).length;
      const shouldRetry =
        review.enabled &&
        review.checked &&
        attempt < MAX_SELF_CHECK_RETRY_ROUNDS &&
        (bestValidCount < MIN_ACCEPTABLE_CANDIDATE_COUNT || anatomyFailureCount >= 2);

      if (!shouldRetry) {
        break;
      }
    }

    stageTracker.complete();
  } catch (error) {
    stageTracker.fail(error);
    throw error;
  }

  return selectPersistableVisualImageAssets(collectedAssets);
}

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

function loadHotelReferenceImage(publicUrl: string) {
  const absolutePath = resolveRuntimeAssetUrlToPath(publicUrl);
  const imageBuffer = readFileSync(absolutePath);
  const contentType = inferImageContentType(publicUrl);
  return {
    imageBuffer,
    contentType,
    dataUrl: `data:${contentType};base64,${imageBuffer.toString("base64")}`,
  };
}

function buildShotPayload(taskId: string) {
  const savedShots = listTaskVisualImageShots(taskId);
  const savedMap = new Map(savedShots.map((shot) => [shot.shotIndex, shot]));
  return (task: NonNullable<ReturnType<typeof getVideoTask>>) =>
    parseTaskVisualImageShots(task).map((shot) => {
      const saved = savedMap.get(shot.shotIndex);
      const candidates = saved?.candidates ?? [];
      const selectedCandidate =
        candidates.find((candidate) => candidate.candidateId === saved?.selectedCandidateId) ?? null;
      const storyShot = task.directorPlan?.storyShots.find((item) => item.shotIndex === shot.shotIndex) ?? null;
      const shotPlanItem = task.shotPlan?.shots.find((item) => item.shotIndex === shot.shotIndex) ?? null;
      const storyboard =
        task.shotPlan?.storyboard?.shotBindings.find((item) => item.shotIndex === shot.shotIndex) ??
        task.directorPlan?.storyboard?.shotBindings.find((item) => item.shotIndex === shot.shotIndex) ??
        null;
      return {
        segmentId: shot.segmentId,
        segmentIndex: shot.segmentIndex,
        shotIndex: shot.shotIndex,
        shotTitle: shot.shotTitle,
        prompt: shot.prompt,
        sceneType: shot.sceneType ?? null,
        generationMode: shot.generationMode ?? null,
        assetId: shot.assetId ?? null,
        assetSubjectSummary: shot.assetSubjectSummary ?? null,
        narrationText: storyShot?.narrationText || shotPlanItem?.narrationHint || "",
        subtitleText: storyShot?.subtitleText || storyShot?.narrationText || shotPlanItem?.narrationHint || "",
        durationSeconds: storyShot?.durationSeconds ?? shotPlanItem?.durationSeconds ?? null,
        primaryAssetLabel: storyboard?.primaryAssetLabel ?? shot.assetSubjectSummary ?? null,
        bindingReason: storyboard?.bindingReason ?? null,
        userIntentPreserved: storyboard?.userIntentPreserved ?? null,
        narrationGoal: storyboard?.narrationGoal ?? null,
        subtitleGoal: storyboard?.subtitleGoal ?? null,
        needsAiFallback:
          storyboard?.needsAiFallback ??
          (!shot.assetId && shot.generationMode !== "photo_direct_i2v" && shot.generationMode !== "photo_enhanced_i2v"),
        referenceImageUrl: shot.referenceImageUrl ?? null,
        size: shot.size,
        guidanceScale: shot.guidanceScale,
        watermark: shot.watermark,
        generatedAt: saved?.generatedAt ?? null,
        updatedAt: saved?.updatedAt ?? null,
        recommendedCandidateId: saved?.recommendedCandidateId ?? null,
        selectedCandidateId: saved?.selectedCandidateId ?? null,
        selectionMode: saved?.selectionMode ?? null,
        selectedAt: saved?.selectedAt ?? null,
        selectedCandidate,
        candidates,
      };
    });
}

function resetTaskAfterVisualMutation(taskId: string, shotIndexes?: number[]) {
  const task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  const normalizedShotIndexes = Array.from(
    new Set(
      (shotIndexes ?? [])
        .map((shotIndex) => Number(shotIndex))
        .filter((shotIndex) => Number.isFinite(shotIndex) && shotIndex > 0),
    ),
  );
  if (normalizedShotIndexes.length > 0) {
    clearTaskClipAndCompositionOutputsForShotIndexes(taskId, normalizedShotIndexes);
  } else {
    clearTaskClipAndCompositionOutputs(taskId);
  }

  return patchVideoTask(taskId, {
    status: capVideoTaskStatus(task.status, "SUBTITLE_AUDIO_READY"),
    stageTimestamps: {
      IMAGES_READY: undefined,
      CLIPS_READY: undefined,
      COMPOSITION_READY: undefined,
    },
  });
}

function loadTaskVisualImagesPayload(taskId: string) {
  const task = syncTaskVisualImageSelectionState(taskId) ?? getVideoTask(taskId);
  const runtime = getImageGenerationRuntime();
  return {
    task,
    shots: task ? buildShotPayload(taskId)(getVideoTask(taskId) ?? task) : [],
    runtime: {
      providerLabel: runtime.providerLabel,
      modelId: runtime.modelId,
      liveEnabled: runtime.liveEnabled,
    },
  };
}

function shouldSeedReferenceBackedShot(shot: TaskVisualImageShotDraft) {
  return Boolean(
    shot.referenceImageUrl &&
    (shot.generationMode === "photo_direct_i2v" || shot.generationMode === "photo_enhanced_i2v"),
  );
}

async function syncCapturedMaterialVisualShots(input: {
  task: NonNullable<ReturnType<typeof getVideoTask>>;
  force?: boolean;
}) {
  const existingShotMap = new Map(listTaskVisualImageShots(input.task.taskId).map((shot) => [shot.shotIndex, shot]));
  const syncedShotIndexes: number[] = [];

  for (const shot of parseTaskVisualImageShots(input.task)) {
    if (!shouldSeedReferenceBackedShot(shot) || !shot.referenceImageUrl) {
      continue;
    }

    const existingShot = existingShotMap.get(shot.shotIndex);
    if (!input.force && existingShot?.candidates.length) {
      continue;
    }

    try {
      const referenceAsset = loadHotelReferenceImage(shot.referenceImageUrl);
      await uploadTaskVisualImage({
        task: input.task,
        segmentId: shot.segmentId,
        segmentIndex: shot.segmentIndex,
        shotIndex: shot.shotIndex,
        prompt: shot.prompt,
        imageBuffer: referenceAsset.imageBuffer,
        contentType: referenceAsset.contentType,
      });
      syncedShotIndexes.push(shot.shotIndex);
    } catch {
      // 单个实拍素材失效时不阻塞整个任务，用户仍可手动补图或重跑规划。
    }
  }

  if (syncedShotIndexes.length > 0) {
    autoSelectRecommendedCandidates(input.task.taskId);
  }

  return syncedShotIndexes;
}

async function executeVisualImageBatchGeneration(input: {
  taskId: string;
  task: NonNullable<ReturnType<typeof getVideoTask>>;
  userId: string;
  routePath: string;
  regenerateAll?: boolean;
  onProgress?: Parameters<typeof createProgressStream>[0] extends (send: infer T) => Promise<Record<string, unknown>>
    ? T
    : never;
}) {
  const taskId = input.taskId;
  const task = getVideoTask(taskId) ?? input.task;
  const capturedMaterialFirst = usesCapturedMaterialFirstWorkflow(task.parameters.video.videoType);
  const regenerateAll = Boolean(input.regenerateAll);
  const shotDrafts = parseTaskVisualImageShots(task);

  if (capturedMaterialFirst) {
    const syncedShotIndexes = await syncCapturedMaterialVisualShots({ task, force: regenerateAll });
    if (syncedShotIndexes.length > 0) {
      resetTaskAfterVisualMutation(taskId, syncedShotIndexes);
    }
  }

  const existingShots = listTaskVisualImageShots(taskId);
  const existingShotIndices = new Set(
    existingShots.filter((shot) => shot.candidates.length > 0).map((shot) => shot.shotIndex),
  );
  const targets = regenerateAll
    ? shotDrafts.filter((shot) => !shouldSeedReferenceBackedShot(shot))
    : shotDrafts.filter((shot) => !existingShotIndices.has(shot.shotIndex));

  return runWithModelUsageContext(
    {
      userId: input.userId,
      routePath: input.routePath,
      objectType: "video_task",
      objectId: taskId,
    },
    async () => {
      const runtime = getImageGenerationRuntime();
      const stageProgress = createTaskStageProgressReporter({
        taskId,
        stageKey: taskStageProgressKeys.visualImages,
        provider: runtime.providerLabel,
        modelId: runtime.modelId,
        initialMessage: "整理待出图镜头...",
        initialPercent: 2,
      });
      const emitProgress = (step: string, percent: number, message: string, extra?: Record<string, unknown>) => {
        input.onProgress?.(step, percent, message, extra);
        stageProgress.onProgress(step, percent, message);
      };

      try {
        const tracker = new WeightedProgressTracker(
          emitProgress,
          [
            { id: "prepare", weight: 8, estimatedMs: 500 },
            ...targets.map((shot) => ({
              id: `shot-${shot.shotIndex}`,
              weight: 10,
              estimatedMs: 4200,
              label: `镜头 ${shot.shotIndex}`,
            })),
            { id: "sync", weight: 6, estimatedMs: 400 },
            { id: "validate", weight: 6, estimatedMs: 400 },
          ],
          {
            step: "visual_images",
            floorPercent: 2,
            capPercent: 99,
          },
        );

        tracker.start("prepare", "整理待出图镜头...");
        tracker.complete("prepare", targets.length ? `共 ${targets.length} 镜待生成参考图` : "没有待生成镜头");

        for (const shot of targets) {
          tracker.start(`shot-${shot.shotIndex}`, `镜头 ${shot.shotIndex} 参考图生成中...`);
          const hotelReferenceAsset =
            shot.referenceImageUrl &&
            (shot.generationMode === "photo_direct_i2v" || shot.generationMode === "photo_enhanced_i2v")
              ? loadHotelReferenceImage(shot.referenceImageUrl)
              : null;

          if (shot.generationMode === "photo_direct_i2v" && hotelReferenceAsset) {
            tracker.setMessage(`镜头 ${shot.shotIndex} 导入酒店实拍图...`, true);
            await uploadTaskVisualImage({
              task,
              segmentId: shot.segmentId,
              segmentIndex: shot.segmentIndex,
              shotIndex: shot.shotIndex,
              prompt: shot.prompt,
              imageBuffer: hotelReferenceAsset.imageBuffer,
              contentType: hotelReferenceAsset.contentType,
            });
          } else {
            let assets;
            try {
              assets = await generateValidatedAssetsForShot({
                task,
                shot,
                referenceImageDataUrl:
                  shot.generationMode === "photo_enhanced_i2v" ? (hotelReferenceAsset?.dataUrl ?? null) : null,
                onStatus: (message) => tracker.setMessage(message, true),
              });
            } catch (error) {
              throw new Error(
                `片段 ${shot.shotIndex} 图片生成失败：${error instanceof Error ? error.message : "图片模型返回异常"}`,
              );
            }
            await generateTaskVisualImageShot({
              task,
              segmentId: shot.segmentId,
              segmentIndex: shot.segmentIndex,
              shotIndex: shot.shotIndex,
              prompt: shot.prompt,
              assets,
            });
          }
          resetTaskAfterVisualMutation(taskId, [shot.shotIndex]);
          tracker.complete(`shot-${shot.shotIndex}`, `镜头 ${shot.shotIndex} 参考图已生成`);
        }

        tracker.start("sync", "同步任务状态与选图结果...");
        const nextTask = syncTaskVisualImageSelectionState(taskId) ?? getVideoTask(taskId) ?? task;
        const shots = buildShotPayload(taskId)(getVideoTask(taskId) ?? nextTask);
        tracker.complete("sync", "参考图阶段已同步");

        tracker.start("validate", "校验图片数量与选图状态...");
        const validation = validateVisualImages(
          shots.length,
          shots.filter((shot) => Boolean(shot.selectedCandidateId)).length,
          getVideoTask(taskId) ?? nextTask,
        );
        const validationError = validation.passed
          ? null
          : `视觉图片校验未通过：${
              validation.issues
                .filter((issue) => issue.severity === "error")
                .map((issue) => issue.message)
                .join("；") || "结果不完整"
            }`;
        tracker.complete("validate", validation.passed ? "视觉图片校验通过" : "视觉图片校验未通过");
        tracker.finish(
          validation.passed ? (targets.length ? "参考图生成完成" : "参考图已是最新状态") : "参考图生成失败",
        );

        if (validationError) {
          stageProgress.fail(validationError, validationError);
          return {
            task: nextTask,
            shots,
            runtime: {
              providerLabel: runtime.providerLabel,
              modelId: runtime.modelId,
              liveEnabled: runtime.liveEnabled,
            },
            validation,
            error: validationError,
          };
        }

        stageProgress.complete(targets.length ? "参考图生成完成" : "参考图已是最新状态");
        return {
          task: nextTask,
          shots,
          runtime: {
            providerLabel: runtime.providerLabel,
            modelId: runtime.modelId,
            liveEnabled: runtime.liveEnabled,
          },
          validation,
        };
      } catch (error) {
        stageProgress.fail(error);
        throw error;
      }
    },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const access = requireOwnedVideoTask(request, taskId);
  if ("response" in access) {
    return access.response;
  }
  const { task } = access;

  const payload = loadTaskVisualImagesPayload(taskId);
  return NextResponse.json(payload);
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
    const { task, session } = access;
    const activeWorkflow = getActiveKeyMaterialWorkflow(taskId);
    const internalWorkflowId = request.headers.get("x-key-material-workflow-id")?.trim() || null;
    const withUsageContext = <T>(work: () => Promise<T>) =>
      runWithModelUsageContext(
        {
          userId: session.userId,
          routePath: "/api/video-tasks/[taskId]/visual-images",
          objectType: "video_task",
          objectId: taskId,
        },
        work,
      );

    const contentType = request.headers.get("content-type") ?? "";
    let body: Partial<VisualImagesRequest> & { file?: File } = {};

    if (
      activeWorkflow &&
      activeWorkflow.workflowId !== internalWorkflowId &&
      contentType.includes("multipart/form-data")
    ) {
      return NextResponse.json({ error: "关键素材生成中，请等待当前任务完成后再操作" }, { status: 409 });
    }

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      body = {
        action: formData.get("action") as string,
        shotIndex: Number(formData.get("shotIndex")),
        file: formData.get("file") as File | undefined,
      } as Partial<VisualImagesRequest> & { file?: File };
    } else {
      body = (await request.json().catch(() => ({}))) as Partial<VisualImagesRequest>;
    }

    if (
      activeWorkflow &&
      activeWorkflow.workflowId !== internalWorkflowId &&
      !isSelectVisualCandidateAction(body.action)
    ) {
      return NextResponse.json({ error: "关键素材生成中，请等待当前任务完成后再操作" }, { status: 409 });
    }

    const shotDrafts = parseTaskVisualImageShots(task);

    if (body.action === "sync_captured_material_shots") {
      if (!usesCapturedMaterialFirstWorkflow(task.parameters.video.videoType)) {
        return NextResponse.json({ error: "当前任务不是实拍素材优先流程，无法同步素材镜头" }, { status: 400 });
      }

      const syncedShotIndexes = await syncCapturedMaterialVisualShots({
        task,
        force: Boolean((body as { force?: boolean }).force),
      });
      if (syncedShotIndexes.length > 0) {
        resetTaskAfterVisualMutation(taskId, syncedShotIndexes);
      }
      return NextResponse.json(loadTaskVisualImagesPayload(taskId));
    }

    if (body.action === directorPrimaryStepActionKeys.buildVisualReferences || body.action === "generate_all") {
      return createProgressStream((onProgress) =>
        withUsageContext(() =>
          executeVisualImageBatchGeneration({
            taskId,
            task,
            userId: session.userId,
            routePath: "/api/video-tasks/[taskId]/visual-images",
            regenerateAll: Boolean((body as { regenerateAll?: boolean }).regenerateAll),
            onProgress,
          }),
        ),
      );
    }

    if (body.action === directorSecondaryStepActionKeys.regenerateShotImages || body.action === "generate_shot") {
      const shotIndex = Number(body.shotIndex);
      const shot = shotDrafts.find((item) => item.shotIndex === shotIndex);
      if (!shot) {
        return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
      }

      const runtime = getImageGenerationRuntime();
      const stageProgress = createTaskStageProgressReporter({
        taskId,
        stageKey: taskStageProgressKeys.visualImages,
        provider: runtime.providerLabel,
        modelId: runtime.modelId,
        initialMessage: `镜头 ${shotIndex} 参考图生成中...`,
        initialPercent: 5,
      });
      let assets;
      const hotelReferenceAsset =
        shot.referenceImageUrl &&
        (shot.generationMode === "photo_direct_i2v" || shot.generationMode === "photo_enhanced_i2v")
          ? loadHotelReferenceImage(shot.referenceImageUrl)
          : null;
      if (shot.generationMode === "photo_direct_i2v" && hotelReferenceAsset) {
        await uploadTaskVisualImage({
          task,
          segmentId: shot.segmentId,
          segmentIndex: shot.segmentIndex,
          shotIndex,
          prompt: shot.prompt,
          imageBuffer: hotelReferenceAsset.imageBuffer,
          contentType: hotelReferenceAsset.contentType,
        });
      } else {
        try {
          assets = await withUsageContext(() =>
            generateValidatedAssetsForShot({
              task,
              shot,
              referenceImageDataUrl:
                shot.generationMode === "photo_enhanced_i2v" ? (hotelReferenceAsset?.dataUrl ?? null) : null,
            }),
          );
        } catch (error) {
          stageProgress.fail(error);
          return NextResponse.json(
            { error: `片段 ${shotIndex} 图片生成失败：${error instanceof Error ? error.message : "图片模型返回异常"}` },
            { status: 500 },
          );
        }
        await generateTaskVisualImageShot({
          task,
          segmentId: shot.segmentId,
          segmentIndex: shot.segmentIndex,
          shotIndex,
          prompt: shot.prompt,
          assets,
        });
      }
      resetTaskAfterVisualMutation(taskId, [shotIndex]);
      const nextTask = syncTaskVisualImageSelectionState(taskId, {
        completionMessage: "已手动补图，参考图已就绪",
      });
      stageProgress.complete(`镜头 ${shotIndex} 参考图已生成`);
      return NextResponse.json({
        task: nextTask,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    if (body.action === directorSecondaryStepActionKeys.selectVisualCandidate || body.action === "select_candidate") {
      const shotIndex = Number(body.shotIndex);
      const candidateId = String(body.candidateId ?? "").trim();
      if (!candidateId) {
        return NextResponse.json({ error: "请选择图片" }, { status: 400 });
      }

      const selected = selectTaskVisualImageCandidate(taskId, shotIndex, candidateId);
      if (!selected) {
        return NextResponse.json({ error: "候选图片不存在" }, { status: 404 });
      }

      resetTaskAfterVisualMutation(taskId, [selected.shotIndex]);
      const nextTask = syncTaskVisualImageSelectionState(taskId, {
        completionMessage: "已确认参考图，视觉阶段恢复完成",
      });
      const runtime = getImageGenerationRuntime();
      return NextResponse.json({
        task: nextTask,
        shot: selected,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    if (body.action === directorSecondaryStepActionKeys.clearVisualSelection || body.action === "clear_selection") {
      const shotIndex = Number(body.shotIndex);
      const cleared = clearTaskVisualImageSelection(taskId, shotIndex);
      if (!cleared) {
        return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
      }

      resetTaskAfterVisualMutation(taskId, [cleared.shotIndex]);
      const nextTask = syncTaskVisualImageSelectionState(taskId);
      const runtime = getImageGenerationRuntime();
      return NextResponse.json({
        task: nextTask,
        shot: cleared,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    if (body.action === "upload_image") {
      const shotIndex = Number(body.shotIndex);
      const file = (body as { file?: File }).file;
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: "请选择图片" }, { status: 400 });
      }
      if (file.size > MAX_MANUAL_UPLOAD_IMAGE_BYTES) {
        return NextResponse.json({ error: "上传图片不能超过 20MB" }, { status: 400 });
      }

      const shot = shotDrafts.find((item) => item.shotIndex === shotIndex);
      if (!shot) {
        return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);
      const fileContentType = detectSupportedImageContentType(imageBuffer, file.type);

      if (imageBuffer.byteLength < 100) {
        return NextResponse.json({ error: "图片文件太小，请重新上传" }, { status: 400 });
      }
      if (!fileContentType) {
        return NextResponse.json({ error: "仅支持 png、jpg、jpeg、webp 格式图片" }, { status: 400 });
      }

      await uploadTaskVisualImage({
        task,
        segmentId: shot.segmentId,
        segmentIndex: shot.segmentIndex,
        shotIndex,
        prompt: shot.prompt,
        imageBuffer,
        contentType: fileContentType,
      });

      resetTaskAfterVisualMutation(taskId, [shotIndex]);
      const nextTask = syncTaskVisualImageSelectionState(taskId, {
        completionMessage: "已手动补图，参考图已就绪",
      });
      const runtime = getImageGenerationRuntime();
      return NextResponse.json({
        task: nextTask,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "视觉图片生成失败" }, { status: 500 });
  }
}
