import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { after, NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { getHotelAssetDisplayOrder } from "../../../../../lib/hotel-asset-ordering";
import { buildPendingHotelAssetAnalysis } from "../../../../../lib/hotel-asset-upload";
import { generateSeedreamImages, type ImageGenerationResult } from "../../../../../lib/image-provider";
import { getImageCleaningRuntime } from "../../../../../lib/image-provider-config";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { buildTaskHotelAssetAnalysisStats } from "../../../../../lib/task-hotel-asset-analysis-stats";
import {
  analyzeHotelAssetImage,
  buildFallbackHotelAssetAnalysis,
  getHotelAssetVisionProviderMeta,
} from "../../../../../lib/hotel-asset-vision";
import {
  autoGroupTaskHotelAssetByScene,
  createTaskHotelAsset,
  deleteTaskHotelAssetFileByUrl,
  deleteTaskHotelAsset,
  getTaskHotelAsset,
  getTaskHotelAssetPublicPath,
  listTaskHotelAssets,
  patchTaskHotelAsset,
  type TaskHotelAssetRecord,
} from "../../../../../lib/task-hotel-asset-store";
import {
  deleteTaskHotelAssetOptimizationHistoryForRoot,
  findRootAssetIdForHotelAsset,
  listDisposableEnhancedCandidateAssetIds,
  listTaskHotelAssetOptimizationStates,
  prepareNextTaskHotelAssetOptimizationRound,
  removeTaskHotelAssetFromOptimizationStates,
  replaceTaskHotelAssetOptimizationRoundCandidates,
  selectTaskHotelAssetOptimizationVariant,
} from "../../../../../lib/task-hotel-asset-optimization-store";
import { resolveRuntimeAssetUrlToPath } from "../../../../../lib/runtime-storage";
import { writeUploadedFileToPath } from "../../../../../lib/file-stream";
import type { HotelAssetSceneType } from "../../../../../lib/video-task-schema";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type PatchHotelAssetRequest = {
  action?: "enhance_images" | "select_asset_variant";
  assetId?: string;
  rootAssetId?: string;
  displayName?: string;
  prompt?: string;
  sceneType?: HotelAssetSceneType;
  userNote?: string;
  reviewStatus?: TaskHotelAssetRecord["reviewStatus"];
  sortOrder?: number;
  assetOrders?: Array<{
    assetId?: string;
    sortOrder?: number;
  }>;
  reanalyze?: boolean;
};

const maxFileSizeBytes = 25 * 1024 * 1024;
const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function getGeneratedImageExtension(contentType: string) {
  if (contentType.includes("png")) {
    return "png";
  }
  if (contentType.includes("webp")) {
    return "webp";
  }
  return "jpg";
}

async function readGeneratedImageAsset(asset: ImageGenerationResult) {
  if (asset.b64Json) {
    return {
      bytes: Buffer.from(asset.b64Json, "base64"),
      contentType: "image/jpeg",
    };
  }

  if (!asset.url) {
    throw new Error("AI 优化图片结果为空");
  }

  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error("AI 优化图片下载失败");
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "image/jpeg",
  };
}

function getHotelAssetEnhancementSize(asset: TaskHotelAssetRecord) {
  if (asset.orientation === "square") {
    return "1920x1920";
  }

  return asset.orientation === "landscape" ? "2560x1440" : "1440x2560";
}

function listTaskHotelAssetsForResponse(taskId: string) {
  return getHotelAssetDisplayOrder(listTaskHotelAssets(taskId));
}

function buildHotelAssetResponsePayload(taskId: string, task: unknown, extra?: Record<string, unknown>) {
  const assets = listTaskHotelAssetsForResponse(taskId);
  return {
    task,
    assets,
    analysisStats: buildTaskHotelAssetAnalysisStats(assets),
    optimizationStates: listTaskHotelAssetOptimizationStates(taskId),
    runtime: getHotelAssetVisionProviderMeta(),
    ...(extra ?? {}),
  };
}

function logHotelAssetAnalysisEvent(
  event: string,
  input: {
    taskId: string;
    assetId?: string;
    fileName?: string;
    usedFallback?: boolean;
  },
) {
  const assets = listTaskHotelAssetsForResponse(input.taskId);
  const stats = buildTaskHotelAssetAnalysisStats(assets);
  console.info("[hotel-assets:analysis]", {
    event,
    taskId: input.taskId,
    assetId: input.assetId,
    fileName: input.fileName,
    usedFallback: input.usedFallback,
    total: stats.total,
    completed: stats.completed,
    pending: stats.pending,
    skipped: stats.skipped,
    rejected: stats.rejected,
  });
}

function buildHotelAssetEnhancementPrompt(asset: TaskHotelAssetRecord, prompt: string) {
  const userPrompt = prompt.trim();
  const sceneLabel = asset.subjectSummary || asset.fileName || "酒店实拍画面";
  const basePrompt =
    userPrompt ||
    "提升清晰度、光影层次和画面通透感，保持真实酒店空间、主体结构、材质和构图，不新增不存在的家具、人物或文字。";

  return [
    `基于上传的酒店实拍参考图进行真实感图片优化，主体内容：${sceneLabel}。`,
    `优化方向：${basePrompt}`,
    "要求保持原图空间关系和真实质感，不改变酒店主体结构，不新增文字、水印、Logo 或夸张装饰。",
  ].join("\n");
}

function isRootHotelAssetRecord(asset: Pick<TaskHotelAssetRecord, "sourceType" | "enhancedFromAssetId">) {
  return asset.sourceType === "user_upload" && !asset.enhancedFromAssetId;
}

async function createEnhancedHotelAssetRecords(input: {
  taskId: string;
  ownerUserId: string | null;
  sourceAsset: TaskHotelAssetRecord;
  prompt: string;
  preserveAssetIds?: string[];
}) {
  const sourceBytes = readFileSync(resolveRuntimeAssetUrlToPath(input.sourceAsset.fileUrl));
  const referenceImageDataUrl = await buildAnalysisImageData(sourceBytes);
  const runtime = getImageCleaningRuntime();
  const prompt = buildHotelAssetEnhancementPrompt(input.sourceAsset, input.prompt);
  const generateEnhancedImages = () =>
    generateSeedreamImages({
      prompt,
      size: getHotelAssetEnhancementSize(input.sourceAsset),
      guidanceScale: 7.8,
      watermark: false,
      seed: null,
      outputCount: 4,
      referenceImageDataUrl,
      runtimeOverride: runtime,
    });
  const generatedResults = input.ownerUserId
    ? await runWithModelUsageContext(
        {
          userId: input.ownerUserId,
          routePath: "/api/video-tasks/[taskId]/hotel-assets",
          objectType: "video_task_hotel_asset",
          objectId: `${input.taskId}:${input.sourceAsset.assetId}`,
        },
        generateEnhancedImages,
      )
    : await generateEnhancedImages();

  const previousEnhancedAssetIds = listDisposableEnhancedCandidateAssetIds({
    assets: listTaskHotelAssets(input.taskId),
    sourceAssetId: input.sourceAsset.assetId,
    preserveAssetIds: input.preserveAssetIds,
  });

  for (const assetId of previousEnhancedAssetIds) {
    deleteTaskHotelAsset(assetId);
  }

  const nextSortOrderStart =
    listTaskHotelAssets(input.taskId).reduce((maxValue, asset) => Math.max(maxValue, asset.sortOrder), -1) + 1;
  const createdAt = new Date().toISOString();
  const createdAssets: TaskHotelAssetRecord[] = [];

  for (const [index, result] of generatedResults.slice(0, 4).entries()) {
    const { bytes, contentType } = await readGeneratedImageAsset(result);
    const metadata = await sharp(bytes, { failOn: "none" }).metadata();
    const width = metadata.width ?? input.sourceAsset.width;
    const height = metadata.height ?? input.sourceAsset.height;
    const extension = getGeneratedImageExtension(contentType);
    const storedFileName = `${crypto.randomUUID()}.${extension}`;
    const absolutePath = getTaskHotelAssetPublicPath(input.taskId, storedFileName);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
    const publicUrl = `/video-tasks/${input.taskId}/hotel-assets/${storedFileName}`;

    createdAssets.push(
      createTaskHotelAsset({
        taskId: input.taskId,
        ownerUserId: input.ownerUserId,
        fileUrl: publicUrl,
        fileName: `ai-enhanced-${index + 1}.${extension}`,
        displayName: `优化图${index + 1}`,
        sourceType: "enhanced",
        enhancedFromAssetId: input.sourceAsset.assetId,
        sceneType: input.sourceAsset.sceneType,
        subjectSummary: input.sourceAsset.subjectSummary || "AI 优化酒店实拍图",
        tags: Array.from(new Set([...input.sourceAsset.tags, "AI优化"])).slice(0, 12),
        compositionType: input.sourceAsset.compositionType,
        recommendedShotScale: input.sourceAsset.recommendedShotScale,
        isHeroCandidate: input.sourceAsset.isHeroCandidate,
        isCloseupCandidate: input.sourceAsset.isCloseupCandidate,
        canDirectI2V: true,
        needEnhancement: false,
        qualityScore: Math.max(input.sourceAsset.qualityScore, 88),
        commercialScore: Math.max(input.sourceAsset.commercialScore, 86),
        width,
        height,
        userNote: input.prompt.trim(),
        reviewStatus: "passed",
        analyzedAt: createdAt,
        sortOrder: nextSortOrderStart + index,
      }),
    );
  }

  return createdAssets;
}

function getSafeExtension(fileName: string, mimeType: string) {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }
  if (mimeType.includes("png")) {
    return "png";
  }
  if (mimeType.includes("jpeg")) {
    return "jpg";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  return "";
}

function normalizeUploadSceneType(value: FormDataEntryValue | null): HotelAssetSceneType | null {
  const raw = typeof value === "string" ? value.trim() : "";
  switch (raw) {
    case "exterior":
    case "lobby":
    case "room":
    case "bathroom":
    case "dining":
    case "food":
    case "facility":
    case "neighborhood":
    case "service_detail":
    case "atmosphere":
    case "other":
      return raw;
    default:
      return null;
  }
}

async function buildAnalysisImageData(bytes: Buffer) {
  const normalizedBuffer = await sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${normalizedBuffer.toString("base64")}`;
}

async function analyzeUploadedHotelAsset(input: {
  ownerUserId: string | null;
  taskId: string;
  bytes: Buffer;
  width: number;
  height: number;
  fileName: string;
  userNote: string;
  sceneType: HotelAssetSceneType | null;
}) {
  const request = {
    imageDataUrl: await buildAnalysisImageData(input.bytes),
    width: input.width,
    height: input.height,
    fileName: input.fileName,
    userNote: input.userNote,
    preferredSceneType: input.sceneType,
  };

  if (!input.ownerUserId) {
    return analyzeHotelAssetImage(request);
  }

  return runWithModelUsageContext(
    {
      userId: input.ownerUserId,
      routePath: "/api/video-tasks/[taskId]/hotel-assets",
      objectType: "video_task",
      objectId: input.taskId,
    },
    () => analyzeHotelAssetImage(request),
  );
}

async function reanalyzeExistingAsset(input: {
  asset: TaskHotelAssetRecord;
  taskId: string;
  ownerUserId: string | null;
  preferredSceneType?: HotelAssetSceneType | null;
  userNote?: string;
}) {
  const absolutePath = resolveRuntimeAssetUrlToPath(input.asset.fileUrl);
  const bytes = readFileSync(absolutePath);

  return analyzeUploadedHotelAsset({
    ownerUserId: input.ownerUserId,
    taskId: input.taskId,
    bytes,
    width: input.asset.width,
    height: input.asset.height,
    fileName: input.asset.fileName,
    userNote: input.userNote ?? input.asset.userNote,
    sceneType: input.preferredSceneType ?? input.asset.sceneType,
  });
}

function normalizeDisplayName(rawValue: FormDataEntryValue | string | null | undefined) {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) {
    return "";
  }
  return Array.from(value).slice(0, 6).join("");
}

function buildHotelAssetFallbackInput(input: {
  width: number;
  height: number;
  fileName: string;
  userNote: string;
  preferredSceneType: HotelAssetSceneType | null;
}) {
  return {
    imageDataUrl: "",
    width: input.width,
    height: input.height,
    fileName: input.fileName,
    userNote: input.userNote,
    preferredSceneType: input.preferredSceneType,
  };
}

async function persistHotelAssetAnalysis(input: {
  assetId: string;
  taskId: string;
  ownerUserId: string | null;
  autoGroupOnFirstAnalysis?: boolean;
}) {
  const asset = getTaskHotelAsset(input.assetId);
  if (!asset || asset.taskId !== input.taskId) {
    return;
  }
  const shouldAutoGroupOnFirstAnalysis = input.autoGroupOnFirstAnalysis && !asset.analyzedAt;

  const analysisFingerprint = {
    fileUrl: asset.fileUrl,
    userNote: asset.userNote,
    sceneType: asset.sceneType,
    sortOrder: asset.sortOrder,
  };

  let usedFallback = false;
  const analysis =
    (await reanalyzeExistingAsset({
      asset,
      taskId: input.taskId,
      ownerUserId: input.ownerUserId,
      preferredSceneType: asset.sceneType,
      userNote: asset.userNote,
    }).catch((error) => {
      usedFallback = true;
      console.warn("[hotel-assets:analysis] 模型解析失败，已使用本地兜底", {
        taskId: input.taskId,
        assetId: asset.assetId,
        fileName: asset.fileName,
        error: error instanceof Error ? error.message : String(error),
      });
      return buildFallbackHotelAssetAnalysis(
        buildHotelAssetFallbackInput({
          width: asset.width,
          height: asset.height,
          fileName: asset.fileName,
          userNote: asset.userNote,
          preferredSceneType: asset.sceneType,
        }),
      );
    })) ?? null;

  if (!analysis) {
    return;
  }

  const latestAsset = getTaskHotelAsset(asset.assetId);
  if (
    !latestAsset ||
    latestAsset.taskId !== input.taskId ||
    latestAsset.fileUrl !== analysisFingerprint.fileUrl ||
    latestAsset.userNote !== analysisFingerprint.userNote ||
    latestAsset.sceneType !== analysisFingerprint.sceneType
  ) {
    return;
  }

  patchTaskHotelAsset(latestAsset.assetId, {
    sceneType: analysis.sceneType,
    subjectSummary: analysis.subjectSummary,
    tags: analysis.tags,
    compositionType: analysis.compositionType,
    recommendedShotScale: analysis.recommendedShotScale,
    isHeroCandidate: analysis.isHeroCandidate,
    isCloseupCandidate: analysis.isCloseupCandidate,
    canDirectI2V: analysis.canDirectI2V,
    needEnhancement: analysis.needEnhancement,
    qualityScore: analysis.qualityScore,
    commercialScore: analysis.commercialScore,
    reviewStatus: analysis.reviewStatus,
    analyzedAt: new Date().toISOString(),
  });
  logHotelAssetAnalysisEvent("completed", {
    taskId: input.taskId,
    assetId: latestAsset.assetId,
    fileName: latestAsset.fileName,
    usedFallback,
  });

  if (shouldAutoGroupOnFirstAnalysis && latestAsset.sortOrder === analysisFingerprint.sortOrder) {
    autoGroupTaskHotelAssetByScene(input.taskId, latestAsset.assetId);
  }
}

function scheduleHotelAssetAnalysis(input: {
  assetId: string;
  taskId: string;
  ownerUserId: string | null;
  autoGroupOnFirstAnalysis?: boolean;
}) {
  after(async () => {
    try {
      await persistHotelAssetAnalysis(input);
    } catch (error) {
      console.error("酒店素材后台分析失败", error);
    }
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const access = requireOwnedVideoTask(request, taskId, {
    forbiddenMessage: "无权查看该任务的酒店素材",
  });
  if ("response" in access) {
    return access.response;
  }

  return NextResponse.json(buildHotelAssetResponsePayload(taskId, access.task));
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId, {
      forbiddenMessage: "无权上传该任务的酒店素材",
    });
    if ("response" in access) {
      return access.response;
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请先选择酒店实拍图" }, { status: 400 });
    }

    if (file.size > maxFileSizeBytes) {
      return NextResponse.json({ error: "图片不能超过 25MB" }, { status: 400 });
    }

    const extension = getSafeExtension(file.name, file.type);
    if (!extension || (file.type && !supportedMimeTypes.has(file.type))) {
      return NextResponse.json({ error: "仅支持 png、jpg、jpeg、webp 格式图片" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(bytes, { failOn: "none" }).rotate().metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) {
      return NextResponse.json({ error: "图片尺寸解析失败，请更换一张图片后重试" }, { status: 400 });
    }

    const preferredSceneType = normalizeUploadSceneType(formData.get("sceneType"));
    const userNote = String(formData.get("userNote") ?? "").trim();
    const replaceAssetId = String(formData.get("replaceAssetId") ?? "").trim();
    const displayNameFromInput = normalizeDisplayName(formData.get("displayName"));
    const existingAssets = listTaskHotelAssets(taskId);
    const replaceAsset = replaceAssetId ? getTaskHotelAsset(replaceAssetId) : null;
    if (replaceAssetId && (!replaceAsset || replaceAsset.taskId !== taskId)) {
      return NextResponse.json({ error: "需要替换的酒店素材不存在" }, { status: 404 });
    }
    if (replaceAsset && !isRootHotelAssetRecord(replaceAsset)) {
      return NextResponse.json({ error: "只能重新上传原始酒店实拍图" }, { status: 400 });
    }

    const nextSortOrder = existingAssets.reduce((maxValue, asset) => Math.max(maxValue, asset.sortOrder), -1) + 1;
    const nextDefaultDisplayName = displayNameFromInput || `图片${nextSortOrder + 1}`;
    const pendingAnalysis = buildPendingHotelAssetAnalysis({
      width,
      height,
      fileName: file.name,
      userNote: replaceAsset ? replaceAsset.userNote : userNote,
      preferredSceneType: replaceAsset ? replaceAsset.sceneType : preferredSceneType,
    });

    const storedFileName = `${crypto.randomUUID()}.${extension}`;
    const absolutePath = getTaskHotelAssetPublicPath(taskId, storedFileName);
    await writeUploadedFileToPath(file, absolutePath);
    const publicUrl = `/video-tasks/${taskId}/hotel-assets/${storedFileName}`;

    const asset = replaceAsset
      ? (() => {
          deleteTaskHotelAssetOptimizationHistoryForRoot(taskId, replaceAsset.assetId);
          const previousFileUrl = replaceAsset.fileUrl;
          const updated = patchTaskHotelAsset(replaceAsset.assetId, {
            fileUrl: publicUrl,
            fileName: file.name,
            displayName: replaceAsset.displayName || nextDefaultDisplayName,
            sourceType: "user_upload",
            enhancedFromAssetId: null,
            sceneType: pendingAnalysis.sceneType,
            subjectSummary: pendingAnalysis.subjectSummary,
            tags: pendingAnalysis.tags,
            compositionType: pendingAnalysis.compositionType,
            recommendedShotScale: pendingAnalysis.recommendedShotScale,
            isHeroCandidate: pendingAnalysis.isHeroCandidate,
            isCloseupCandidate: pendingAnalysis.isCloseupCandidate,
            canDirectI2V: pendingAnalysis.canDirectI2V,
            needEnhancement: pendingAnalysis.needEnhancement,
            qualityScore: pendingAnalysis.qualityScore,
            commercialScore: pendingAnalysis.commercialScore,
            width,
            height,
            userNote: replaceAsset.userNote,
            reviewStatus: pendingAnalysis.reviewStatus,
            analyzedAt: pendingAnalysis.analyzedAt,
          });
          if (updated && previousFileUrl !== publicUrl) {
            deleteTaskHotelAssetFileByUrl(previousFileUrl);
          }
          return updated;
        })()
      : createTaskHotelAsset({
          taskId,
          ownerUserId: access.task.ownerUserId,
          fileUrl: publicUrl,
          fileName: file.name,
          displayName: nextDefaultDisplayName,
          sourceType: "user_upload",
          sceneType: pendingAnalysis.sceneType,
          subjectSummary: pendingAnalysis.subjectSummary,
          tags: pendingAnalysis.tags,
          compositionType: pendingAnalysis.compositionType,
          recommendedShotScale: pendingAnalysis.recommendedShotScale,
          isHeroCandidate: pendingAnalysis.isHeroCandidate,
          isCloseupCandidate: pendingAnalysis.isCloseupCandidate,
          canDirectI2V: pendingAnalysis.canDirectI2V,
          needEnhancement: pendingAnalysis.needEnhancement,
          qualityScore: pendingAnalysis.qualityScore,
          commercialScore: pendingAnalysis.commercialScore,
          width,
          height,
          userNote,
          reviewStatus: pendingAnalysis.reviewStatus,
          analyzedAt: pendingAnalysis.analyzedAt,
          sortOrder: nextSortOrder,
        });

    if (!asset) {
      return NextResponse.json({ error: "酒店素材更新失败" }, { status: 500 });
    }

    scheduleHotelAssetAnalysis({
      assetId: asset.assetId,
      taskId,
      ownerUserId: access.task.ownerUserId,
      autoGroupOnFirstAnalysis: false,
    });
    logHotelAssetAnalysisEvent("queued", {
      taskId,
      assetId: asset.assetId,
      fileName: asset.fileName,
    });

    return NextResponse.json(buildHotelAssetResponsePayload(taskId, access.task, {
      asset,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "酒店素材上传失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId, {
      forbiddenMessage: "无权编辑该任务的酒店素材",
    });
    if ("response" in access) {
      return access.response;
    }

    const body = (await request.json().catch(() => null)) as PatchHotelAssetRequest | null;
    if (body?.action === "enhance_images") {
      const assetId = body.assetId?.trim();
      if (!assetId) {
        return NextResponse.json({ error: "缺少需要优化的素材 ID" }, { status: 400 });
      }

      const asset = getTaskHotelAsset(assetId);
      if (!asset || asset.taskId !== taskId) {
        return NextResponse.json({ error: "酒店素材不存在" }, { status: 404 });
      }
      const allAssets = listTaskHotelAssets(taskId);
      const rootAssetId = body.rootAssetId?.trim() || findRootAssetIdForHotelAsset(asset.assetId, allAssets);
      const rootAsset = getTaskHotelAsset(rootAssetId);
      if (!rootAsset || rootAsset.taskId !== taskId) {
        return NextResponse.json({ error: "原始酒店素材不存在" }, { status: 404 });
      }
      if (!isRootHotelAssetRecord(rootAsset)) {
        return NextResponse.json({ error: "原始酒店素材状态异常，请刷新后重试" }, { status: 400 });
      }
      const selectedRootAssetId = findRootAssetIdForHotelAsset(asset.assetId, allAssets);
      if (selectedRootAssetId !== rootAsset.assetId) {
        return NextResponse.json({ error: "当前图片不属于该原图的优化历史" }, { status: 400 });
      }

      const preparedRound = prepareNextTaskHotelAssetOptimizationRound({
        taskId,
        rootAssetId: rootAsset.assetId,
      });
      for (const staleAssetId of preparedRound.staleCandidateIds) {
        const staleAsset = getTaskHotelAsset(staleAssetId);
        if (staleAsset && staleAsset.taskId === taskId && staleAsset.assetId !== preparedRound.state.currentAssetId) {
          deleteTaskHotelAsset(staleAsset.assetId);
        }
      }
      const sourceAsset = getTaskHotelAsset(preparedRound.state.currentAssetId) ?? rootAsset;

      const enhancedAssets = await createEnhancedHotelAssetRecords({
        taskId,
        ownerUserId: access.task.ownerUserId,
        sourceAsset,
        prompt: typeof body.prompt === "string" ? body.prompt : "",
        preserveAssetIds: [
          rootAsset.assetId,
          preparedRound.state.currentAssetId,
          ...preparedRound.state.historyAssetIds,
          ...preparedRound.state.currentRoundCandidateIds,
        ],
      });
      const optimizationState = replaceTaskHotelAssetOptimizationRoundCandidates({
        taskId,
        rootAssetId: rootAsset.assetId,
        candidateIds: enhancedAssets.map((enhancedAsset) => enhancedAsset.assetId),
      });

      return NextResponse.json(buildHotelAssetResponsePayload(taskId, access.task, {
        asset: sourceAsset,
        rootAsset,
        enhancedAssets,
        optimizationState,
      }));
    }

    if (body?.action === "select_asset_variant") {
      const assetId = body.assetId?.trim();
      if (!assetId) {
        return NextResponse.json({ error: "缺少需要选择的素材 ID" }, { status: 400 });
      }
      const asset = getTaskHotelAsset(assetId);
      if (!asset || asset.taskId !== taskId) {
        return NextResponse.json({ error: "酒店素材不存在" }, { status: 404 });
      }

      const allAssets = listTaskHotelAssets(taskId);
      const resolvedRootAssetId = findRootAssetIdForHotelAsset(asset.assetId, allAssets);
      const rootAssetId = body.rootAssetId?.trim() || resolvedRootAssetId;
      if (rootAssetId !== resolvedRootAssetId) {
        return NextResponse.json({ error: "选择的图片不属于该原图的优化历史" }, { status: 400 });
      }
      const rootAsset = getTaskHotelAsset(rootAssetId);
      if (!rootAsset || rootAsset.taskId !== taskId) {
        return NextResponse.json({ error: "原始酒店素材不存在" }, { status: 404 });
      }
      if (!isRootHotelAssetRecord(rootAsset)) {
        return NextResponse.json({ error: "原始酒店素材状态异常，请刷新后重试" }, { status: 400 });
      }

      const optimizationState = selectTaskHotelAssetOptimizationVariant({
        taskId,
        rootAssetId,
        assetId: asset.assetId,
      });

      return NextResponse.json(buildHotelAssetResponsePayload(taskId, access.task, {
        asset,
        rootAsset,
        optimizationState,
      }));
    }

    if (Array.isArray(body?.assetOrders) && body.assetOrders.length > 0) {
      for (const item of body.assetOrders) {
        const assetId = item.assetId?.trim();
        if (!assetId) {
          continue;
        }
        const asset = getTaskHotelAsset(assetId);
        if (!asset || asset.taskId !== taskId) {
          return NextResponse.json({ error: "酒店素材不存在" }, { status: 404 });
        }
        patchTaskHotelAsset(assetId, {
          sortOrder: Math.max(0, Math.round(Number(item.sortOrder ?? 0))),
        });
      }

      return NextResponse.json(buildHotelAssetResponsePayload(taskId, access.task));
    }

    if (!body?.assetId?.trim()) {
      return NextResponse.json({ error: "缺少素材 ID" }, { status: 400 });
    }

    const asset = getTaskHotelAsset(body.assetId.trim());
    if (!asset || asset.taskId !== taskId) {
      return NextResponse.json({ error: "酒店素材不存在" }, { status: 404 });
    }

    const nextSceneType =
      body.sceneType &&
      [
        "exterior",
        "lobby",
        "room",
        "bathroom",
        "dining",
        "food",
        "facility",
        "neighborhood",
        "service_detail",
        "atmosphere",
        "other",
      ].includes(body.sceneType)
        ? body.sceneType
        : asset.sceneType;
    const nextUserNote = typeof body.userNote === "string" ? body.userNote.trim() : asset.userNote;
    const nextDisplayName = normalizeDisplayName(body.displayName) || asset.displayName || asset.fileName;
    const shouldQueueReanalysis = Boolean(body.reanalyze);

    const updated = patchTaskHotelAsset(asset.assetId, {
      displayName: nextDisplayName,
      userNote: nextUserNote,
      sortOrder:
        typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
          ? Math.max(0, Math.round(body.sortOrder))
          : asset.sortOrder,
      sceneType: nextSceneType,
      reviewStatus: shouldQueueReanalysis ? "pending" : (body.reviewStatus ?? asset.reviewStatus),
      analyzedAt: shouldQueueReanalysis ? null : asset.analyzedAt,
    });

    if (updated && shouldQueueReanalysis) {
      scheduleHotelAssetAnalysis({
        assetId: updated.assetId,
        taskId,
        ownerUserId: access.task.ownerUserId,
        autoGroupOnFirstAnalysis: false,
      });
      logHotelAssetAnalysisEvent("reanalysis_queued", {
        taskId,
        assetId: updated.assetId,
        fileName: updated.fileName,
      });
    }

      return NextResponse.json(buildHotelAssetResponsePayload(taskId, access.task, {
        asset: updated,
      }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "酒店素材更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId, {
      forbiddenMessage: "无权删除该任务的酒店素材",
    });
    if ("response" in access) {
      return access.response;
    }

    const assetId = request.nextUrl.searchParams.get("assetId")?.trim();
    if (!assetId) {
      return NextResponse.json({ error: "缺少素材 ID" }, { status: 400 });
    }

    const asset = getTaskHotelAsset(assetId);
    if (!asset || asset.taskId !== taskId) {
      return NextResponse.json({ error: "酒店素材不存在" }, { status: 404 });
    }

    const allAssets = listTaskHotelAssets(taskId);
    const rootAssetId = findRootAssetIdForHotelAsset(assetId, allAssets);
    if (isRootHotelAssetRecord(asset)) {
      deleteTaskHotelAssetOptimizationHistoryForRoot(taskId, asset.assetId);
    } else {
      removeTaskHotelAssetFromOptimizationStates(taskId, assetId);
    }
    deleteTaskHotelAsset(assetId);

    return NextResponse.json(buildHotelAssetResponsePayload(taskId, access.task));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "酒店素材删除失败" }, { status: 500 });
  }
}
