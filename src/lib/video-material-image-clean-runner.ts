import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { runWithModelUsageContext } from "./model-usage-context";
import { cleanVideoMaterialImage } from "./video-material-image-cleaner";
import {
  createIdleVideoMaterialImageCleaningJob,
  getVideoMaterial,
  listVideoMaterials,
  persistVideoMaterialCleanedFrameDirectory,
  type VideoMaterialImageAsset,
  type VideoMaterialRecord,
  upsertVideoMaterialCleanedFrames,
  updateVideoMaterial,
} from "./video-material-store";
import { resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const activeImageCleaningRuns = new Set<string>();

function getImageContentType(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function formatImageCleaningMessage(processedCount: number, totalCount: number, currentLabel?: string | null) {
  const percent = totalCount > 0 ? Math.min(100, Math.round((processedCount / totalCount) * 100)) : 0;
  if (currentLabel) {
    return `正在清洗图片… ${percent}%（当前：${currentLabel}）`;
  }
  return `正在清洗图片… ${percent}%`;
}

function formatImageCleaningCompletedMessage(cleanedCount: number, failedCount: number) {
  if (failedCount > 0) {
    return `图片清洗完成，成功 ${cleanedCount} 张，失败 ${failedCount} 张`;
  }
  return `图片清洗完成，共清洗 ${cleanedCount} 张`;
}

function isImageCleaningRunning(material: VideoMaterialRecord) {
  return material.imageCleaningJob.status === "running" && material.imageCleaningJob.totalCount > 0;
}

async function processVideoMaterialImageCleaning(materialId: string) {
  const initialMaterial = getVideoMaterial(materialId);
  if (!initialMaterial || !isImageCleaningRunning(initialMaterial)) {
    return getVideoMaterial(materialId);
  }

  const executeCleaning = async () => {
    try {
      const cleanedDir = persistVideoMaterialCleanedFrameDirectory(materialId);

      while (true) {
        const material = getVideoMaterial(materialId);
        if (!material) {
          return null;
        }

        const job = material.imageCleaningJob;
        if (job.status !== "running") {
          return material;
        }

        const nextImageId = job.requestedImageIds[job.processedCount];
        if (!nextImageId) {
          const finalized = updateVideoMaterial(materialId, {
            imageCleaningJob: {
              ...job,
              status: "completed",
              currentImageId: null,
              message: formatImageCleaningCompletedMessage(job.cleanedCount, job.failedImageIds.length),
              finishedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          });
          return finalized;
        }

        const frame = material.extractedFrames.find((item) => item.imageId === nextImageId);
        if (!frame) {
          const failedImageIds = [...job.failedImageIds, nextImageId];
          const nextProcessedCount = job.processedCount + 1;
          updateVideoMaterial(materialId, {
            imageCleaningJob: {
              ...job,
              processedCount: nextProcessedCount,
              failedImageIds,
              currentImageId: null,
              message:
                nextProcessedCount >= job.totalCount
                  ? formatImageCleaningCompletedMessage(job.cleanedCount, failedImageIds.length)
                  : formatImageCleaningMessage(nextProcessedCount, job.totalCount),
              updatedAt: new Date().toISOString(),
              ...(nextProcessedCount >= job.totalCount
                ? {
                    status: "completed" as const,
                    finishedAt: new Date().toISOString(),
                  }
                : {}),
            },
          });
          continue;
        }

        updateVideoMaterial(materialId, {
          imageCleaningJob: {
            ...job,
            currentImageId: frame.imageId,
            message: formatImageCleaningMessage(job.processedCount, job.totalCount, frame.label),
            updatedAt: new Date().toISOString(),
          },
        });

        let succeeded = false;
        try {
          const sourcePath = resolveRuntimeAssetUrlToPath(frame.imageUrl);
          const sourceBytes = readFileSync(sourcePath);
          const cleaned = await cleanVideoMaterialImage({
            materialId,
            sourceBytes,
            sourceMimeType: getImageContentType(frame.fileName),
            width: frame.width,
            height: frame.height,
          });

          const currentMaterial = getVideoMaterial(materialId);
          if (!currentMaterial) {
            return null;
          }
          const currentJob = currentMaterial.imageCleaningJob;
          if (currentJob.status !== "running" || currentJob.currentImageId !== frame.imageId) {
            return currentMaterial;
          }

          const fileName = `${frame.imageId}-${randomUUID()}.${cleaned.extension}`;
          const filePath = join(cleanedDir, fileName);
          writeFileSync(filePath, cleaned.bytes);

          const nextFrame: VideoMaterialImageAsset = {
            imageId: `clean-${frame.imageId}`,
            imageUrl: `/video-materials/${materialId}/cleaned/${fileName}`,
            fileName,
            width: cleaned.width,
            height: cleaned.height,
            byteSize: cleaned.bytes.byteLength,
            timestampSeconds: frame.timestampSeconds,
            label: frame.label.replace(/^抽帧/, "清洗"),
            sourceImageId: frame.imageId,
            createdAt: new Date().toISOString(),
          };

          upsertVideoMaterialCleanedFrames(materialId, [nextFrame]);
          succeeded = true;
        } catch {
          succeeded = false;
        }

        const latestMaterial = getVideoMaterial(materialId);
        if (!latestMaterial) {
          return null;
        }

        const latestJob = latestMaterial.imageCleaningJob;
        const nextProcessedCount = latestJob.processedCount + 1;
        const nextFailedIds = succeeded ? latestJob.failedImageIds : [...latestJob.failedImageIds, frame.imageId];
        const nextCleanedCount = latestMaterial.cleanedFrames.filter((item) =>
          latestJob.requestedImageIds.includes(item.sourceImageId ?? ""),
        ).length;

        updateVideoMaterial(materialId, {
          imageCleaningJob: {
            ...latestJob,
            processedCount: nextProcessedCount,
            cleanedCount: nextCleanedCount,
            failedImageIds: nextFailedIds,
            currentImageId: null,
            message:
              nextProcessedCount >= latestJob.totalCount
                ? formatImageCleaningCompletedMessage(nextCleanedCount, nextFailedIds.length)
                : formatImageCleaningMessage(nextProcessedCount, latestJob.totalCount),
            updatedAt: new Date().toISOString(),
            ...(nextProcessedCount >= latestJob.totalCount
              ? {
                  status: "completed" as const,
                  finishedAt: new Date().toISOString(),
                }
              : {}),
          },
        });
      }
    } catch (error) {
      const material = getVideoMaterial(materialId);
      if (!material || material.imageCleaningJob.status !== "running") {
        return material;
      }

      return updateVideoMaterial(materialId, {
        imageCleaningJob: {
          ...material.imageCleaningJob,
          status: "error",
          currentImageId: null,
          message: error instanceof Error ? error.message : "图片清洗失败",
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }
  };

  if (!initialMaterial.ownerUserId) {
    return executeCleaning();
  }

  return runWithModelUsageContext(
    {
      userId: initialMaterial.ownerUserId,
      routePath: "/internal/video-material-image-cleaning",
      objectType: "video_material",
      objectId: materialId,
    },
    executeCleaning,
  );
}

export function scheduleVideoMaterialImageCleaning(materialId: string) {
  const normalizedMaterialId = materialId.trim();
  if (!normalizedMaterialId || activeImageCleaningRuns.has(normalizedMaterialId)) {
    return false;
  }

  const material = getVideoMaterial(normalizedMaterialId);
  if (!material || !isImageCleaningRunning(material)) {
    return false;
  }

  activeImageCleaningRuns.add(normalizedMaterialId);
  void processVideoMaterialImageCleaning(normalizedMaterialId).finally(() => {
    activeImageCleaningRuns.delete(normalizedMaterialId);
  });
  return true;
}

export function ensurePendingVideoMaterialImageCleaning(materialId?: string) {
  const materials = materialId
    ? [getVideoMaterial(materialId)].filter((item): item is VideoMaterialRecord => Boolean(item))
    : listVideoMaterials();

  for (const material of materials) {
    if (!isImageCleaningRunning(material)) {
      continue;
    }

    scheduleVideoMaterialImageCleaning(material.materialId);
  }
}

export function startVideoMaterialImageCleaningJob(materialId: string, imageIds: string[]) {
  const material = getVideoMaterial(materialId);
  if (!material) {
    return null;
  }

  const requestedImageIds = imageIds.filter((imageId, index) => imageIds.indexOf(imageId) === index);
  const now = new Date().toISOString();
  const updated = updateVideoMaterial(materialId, {
    imageCleaningJob: {
      ...createIdleVideoMaterialImageCleaningJob(),
      status: "running",
      requestedImageIds,
      totalCount: requestedImageIds.length,
      processedCount: 0,
      cleanedCount: material.cleanedFrames.filter((item) => requestedImageIds.includes(item.sourceImageId ?? ""))
        .length,
      message: formatImageCleaningMessage(0, requestedImageIds.length),
      startedAt: now,
      updatedAt: now,
    },
  });

  if (!updated) {
    return null;
  }

  scheduleVideoMaterialImageCleaning(materialId);
  return updated;
}
