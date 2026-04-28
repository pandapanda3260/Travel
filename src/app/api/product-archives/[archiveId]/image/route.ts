import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";
import { getProductArchive, patchProductArchive } from "../../../../../lib/product-archive-store";
import { extractProductArchiveFromImageChunks } from "../../../../../lib/product-archive-vision";
import { joinRuntimePublicStoragePath } from "../../../../../lib/runtime-storage";

type RouteContext = {
  params: Promise<{
    archiveId: string;
  }>;
};

const maxFileSizeBytes = 50 * 1024 * 1024;
const maxVisionPixels = 36_000_000;
const maxVisionImageBytes = 9 * 1024 * 1024;
const chunkOverlapPixels = 240;
const chunkSearchWindowPixels = 360;
const minimumSearchHeightPixels = 480;

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

function trimTitle(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return Array.from(normalized).slice(0, 10).join("") || "未命名商品档案";
}

function buildDataUrl(mimeType: string, bytes: Buffer) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function buildVisionImageChunks(bytes: Buffer, mimeType: string, extension: string) {
  const normalizedMimeType = mimeType || `image/${extension}`;
  const image = sharp(bytes, { failOn: "none" });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (!width || !height) {
    throw new Error("图片尺寸解析失败，请更换一张清晰图片后重试");
  }

  const totalPixels = width * height;
  const minimumChunkCountBySize = Math.max(1, Math.ceil(bytes.byteLength / maxVisionImageBytes));
  const minimumChunkCountByPixels = Math.max(1, Math.ceil(totalPixels / maxVisionPixels));
  if (totalPixels <= maxVisionPixels && bytes.byteLength <= maxVisionImageBytes) {
    return [
      {
        imageDataUrl: buildDataUrl(normalizedMimeType, bytes),
        prompt: "请识别这张商品图片中的文字和关键信息，并按指定 JSON 返回。",
      },
    ];
  }

  const analysisWidth = Math.min(width, 256);
  const analysis = await sharp(bytes, { failOn: "none" })
    .resize({
      width: analysisWidth,
      fit: "inside",
      withoutEnlargement: true,
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const analysisHeight = analysis.info.height;
  const rowDarkRatios = Array.from({ length: analysisHeight }, (_, rowIndex) => {
    let darkPixels = 0;
    const rowOffset = rowIndex * analysis.info.width;
    for (let columnIndex = 0; columnIndex < analysis.info.width; columnIndex += 1) {
      if (analysis.data[rowOffset + columnIndex] < 245) {
        darkPixels += 1;
      }
    }
    return darkPixels / analysis.info.width;
  });
  const analysisScale = height / analysisHeight;
  const toAnalysisRow = (pixelRow: number) =>
    Math.min(analysisHeight - 1, Math.max(0, Math.round(pixelRow / analysisScale)));
  const toPixelRow = (analysisRow: number) => Math.min(height, Math.max(0, Math.round(analysisRow * analysisScale)));
  const pickCutPosition = (expectedEnd: number, minEnd: number, maxEnd: number) => {
    const searchStart = toAnalysisRow(Math.max(minEnd, expectedEnd - chunkSearchWindowPixels));
    const searchEnd = toAnalysisRow(Math.min(maxEnd, expectedEnd + chunkSearchWindowPixels));
    let bestRow = toAnalysisRow(expectedEnd);
    let bestScore = Number.POSITIVE_INFINITY;

    for (let row = searchStart; row <= searchEnd; row += 1) {
      const score = rowDarkRatios[row];
      if (score < bestScore) {
        bestScore = score;
        bestRow = row;
      }
    }

    return Math.max(minEnd, toPixelRow(bestRow));
  };
  const maximumChunkCount = Math.max(minimumChunkCountBySize, minimumChunkCountByPixels) + 24;

  for (
    let targetChunkCount = Math.max(minimumChunkCountBySize, minimumChunkCountByPixels);
    targetChunkCount <= maximumChunkCount;
    targetChunkCount += 1
  ) {
    const targetChunkHeight = Math.max(1, Math.ceil(height / targetChunkCount));
    const baseChunks: Array<{ start: number; end: number }> = [];
    let segmentStart = 0;

    while (segmentStart < height) {
      const remainingHeight = height - segmentStart;
      if (remainingHeight <= targetChunkHeight) {
        baseChunks.push({ start: segmentStart, end: height });
        break;
      }

      const minEnd = Math.min(
        height,
        segmentStart + Math.max(minimumSearchHeightPixels, Math.floor(targetChunkHeight * 0.7)),
      );
      const maxEnd = Math.min(
        height,
        segmentStart + Math.max(minimumSearchHeightPixels, Math.ceil(targetChunkHeight * 1.3)),
      );
      const expectedEnd = Math.min(height, segmentStart + targetChunkHeight);
      const cutEnd = Math.max(minEnd, pickCutPosition(expectedEnd, minEnd, maxEnd));
      baseChunks.push({ start: segmentStart, end: cutEnd });
      segmentStart = cutEnd;
    }

    const chunks: Array<{ imageDataUrl: string; prompt: string }> = [];
    let allChunksFit = true;
    const chunkByteSizes: number[] = [];
    const chunkHeights: number[] = [];

    for (const [chunkIndex, chunk] of baseChunks.entries()) {
      const effectiveTop = chunkIndex === 0 ? chunk.start : Math.max(0, chunk.start - chunkOverlapPixels);
      const effectiveBottom =
        chunkIndex === baseChunks.length - 1 ? chunk.end : Math.min(height, chunk.end + chunkOverlapPixels);
      const currentHeight = effectiveBottom - effectiveTop;
      chunkHeights.push(currentHeight);

      if (width * currentHeight > maxVisionPixels) {
        allChunksFit = false;
        break;
      }

      const chunkBuffer = await sharp(bytes, { failOn: "none" })
        .extract({
          left: 0,
          top: effectiveTop,
          width,
          height: currentHeight,
        })
        .toBuffer();

      if (chunkBuffer.byteLength > maxVisionImageBytes) {
        allChunksFit = false;
        chunkByteSizes.push(chunkBuffer.byteLength);
        break;
      }

      chunkByteSizes.push(chunkBuffer.byteLength);

      chunks.push({
        imageDataUrl: buildDataUrl(normalizedMimeType, chunkBuffer),
        prompt: `这是一张超长商品图的第 ${chunkIndex + 1} 段（与相邻分段有重叠区域，请优先保留完整语义并避免重复抄录边界内容），请完整识别当前分段中的文字内容与关键信息，并按指定 JSON 返回。`,
      });
    }

    if (allChunksFit && chunks.length) {
      return chunks;
    }
  }

  throw new Error("图片切块后仍无法满足视觉模型单图 9MB 限制，请手动裁剪后重试");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { archiveId } = await context.params;
    const archive = getProductArchive(archiveId);
    if (!archive) {
      return NextResponse.json({ error: "商品档案不存在" }, { status: 404 });
    }
    if (archive.ownerUserId && archive.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权修改该商品档案", code: "PRODUCT_ARCHIVE_FORBIDDEN" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传商品图片" }, { status: 400 });
    }

    if (file.size > maxFileSizeBytes) {
      return NextResponse.json({ error: "上传图片不能超过 50MB" }, { status: 400 });
    }

    const extension = getSafeExtension(file.name, file.type);
    if (!extension) {
      return NextResponse.json({ error: "仅支持 png、jpg、jpeg、webp 格式图片" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const imageChunks = await buildVisionImageChunks(bytes, file.type, extension);
    const parsed = await runWithModelUsageContext(
      {
        userId: archive.ownerUserId ?? session.userId,
        routePath: "/api/product-archives/[archiveId]/image",
        objectType: "product_archive",
        objectId: archiveId,
      },
      () => extractProductArchiveFromImageChunks(imageChunks),
    );

    const imageDir = joinRuntimePublicStoragePath("product-archives", archiveId, "source");
    mkdirSync(imageDir, { recursive: true });
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const absolutePath = join(/* turbopackIgnore: true */ imageDir, fileName);
    writeFileSync(absolutePath, bytes);
    const publicUrl = `/product-archives/${archiveId}/source/${fileName}`;
    const uploadedAt = new Date().toISOString();
    const nextTitle = trimTitle(parsed.summaryTitle || parsed.rawText.split(/\r?\n/).find(Boolean) || archive.title);

    const saved = patchProductArchive(archiveId, {
      title: nextTitle,
      sourceImageUrl: publicUrl,
      sourceImageFileName: file.name,
      sourceImageUploadedAt: uploadedAt,
      parsedText: parsed.rawText,
      parsedData: parsed,
      keyInfo: {
        productName: nextTitle,
        packagePersonCount: parsed.packagePersonCount || archive.keyInfo.packagePersonCount,
      },
    });

    return NextResponse.json({
      archive: saved,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "商品图片解析失败" }, { status: 500 });
  }
}
