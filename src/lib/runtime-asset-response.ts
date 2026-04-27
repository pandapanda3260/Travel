import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "./auth-session";
import { getProductArchive } from "./product-archive-store";
import { isPathWithinDirectory, joinRuntimePublicStoragePath } from "./runtime-storage";
import { getVideoMaterial } from "./video-material-store";
import { getVideoTask } from "./video-task-store";

const mimeTypeMap: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pcm": "application/octet-stream",
  ".srt": "application/x-subrip",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function toReadableStream(filePath: string, start?: number, end?: number) {
  return Readable.toWeb(
    createReadStream(filePath, start != null || end != null ? { start, end } : undefined),
  ) as ReadableStream;
}

function getMimeType(filePath: string) {
  return mimeTypeMap[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function normalizeAssetPathParts(pathParts: string[]) {
  return pathParts
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveAssetPath(rootFolder: string, normalizedParts: string[]) {
  const rootDir = joinRuntimePublicStoragePath(rootFolder);
  const targetPath = joinRuntimePublicStoragePath(rootFolder, ...normalizedParts);

  if (!isPathWithinDirectory(rootDir, targetPath)) {
    return null;
  }

  return {
    rootDir,
    targetPath,
  };
}

const taskScopedAssetRoots = new Set([
  "generated-images",
  "generated-videos",
  "generated-final-videos",
  "generated-compositions",
  "generated-audio",
  "generated-subtitles",
]);

function authorizeTaskScopedAsset(request: NextRequest, normalizedParts: string[]) {
  const session = requireUserApiSession(request);
  if (!session) {
    return {
      response: userApiUnauthorizedResponse(),
    } as const;
  }

  const taskId = normalizedParts[0]?.trim() ?? "";
  if (!taskId || taskId === "_unassigned") {
    return {
      cacheControl: "private, no-store",
      varyCookie: true,
    } as const;
  }

  const task = getVideoTask(taskId);
  if (!task) {
    return {
      response: NextResponse.json({ error: "视频任务不存在" }, { status: 404 }),
    } as const;
  }

  if (task.ownerUserId && task.ownerUserId !== session.userId) {
    return {
      response: NextResponse.json({ error: "无权访问该视频任务产物", code: "VIDEO_TASK_FORBIDDEN" }, { status: 403 }),
    } as const;
  }

  return {
    cacheControl: "private, no-store",
    varyCookie: true,
  } as const;
}

function authorizeProductArchiveAsset(request: NextRequest, normalizedParts: string[]) {
  const session = requireUserApiSession(request);
  if (!session) {
    return {
      response: userApiUnauthorizedResponse(),
    } as const;
  }

  const archiveId = normalizedParts[0]?.trim() ?? "";
  if (!archiveId) {
    return {
      response: NextResponse.json({ error: "商品档案不存在" }, { status: 404 }),
    } as const;
  }

  const archive = getProductArchive(archiveId);
  if (!archive) {
    return {
      response: NextResponse.json({ error: "商品档案不存在" }, { status: 404 }),
    } as const;
  }

  if (archive.ownerUserId && archive.ownerUserId !== session.userId) {
    return {
      response: NextResponse.json(
        { error: "无权访问该商品档案文件", code: "PRODUCT_ARCHIVE_FORBIDDEN" },
        { status: 403 },
      ),
    } as const;
  }

  return {
    cacheControl: "private, no-store",
    varyCookie: true,
  } as const;
}

function authorizeVideoMaterialAsset(request: NextRequest, normalizedParts: string[]) {
  const session = requireUserApiSession(request);
  if (!session) {
    return {
      response: userApiUnauthorizedResponse(),
    } as const;
  }

  const nestedMaterialId =
    normalizedParts.length > 1 && normalizedParts[0]?.trim().startsWith("vm-") ? normalizedParts[0].trim() : "";
  const fileName = normalizedParts[normalizedParts.length - 1]?.trim() ?? "";
  const materialId = nestedMaterialId || fileName.replace(/\.[^.]+$/, "").trim();
  if (!materialId) {
    return {
      response: NextResponse.json({ error: "素材不存在" }, { status: 404 }),
    } as const;
  }

  const material = getVideoMaterial(materialId);
  if (!material) {
    return {
      response: NextResponse.json({ error: "素材不存在" }, { status: 404 }),
    } as const;
  }

  if (material.ownerUserId && material.ownerUserId !== session.userId) {
    return {
      response: NextResponse.json({ error: "无权访问该素材文件", code: "VIDEO_MATERIAL_FORBIDDEN" }, { status: 403 }),
    } as const;
  }

  return {
    cacheControl: "private, no-store",
    varyCookie: true,
  } as const;
}

function authorizeRuntimeAssetRequest(request: NextRequest, rootFolder: string, normalizedParts: string[]) {
  if (taskScopedAssetRoots.has(rootFolder)) {
    return authorizeTaskScopedAsset(request, normalizedParts);
  }

  if (rootFolder === "product-archives") {
    return authorizeProductArchiveAsset(request, normalizedParts);
  }

  if (rootFolder === "video-materials") {
    return authorizeVideoMaterialAsset(request, normalizedParts);
  }

  return {
    cacheControl: "public, max-age=3600",
    varyCookie: false,
  } as const;
}

function parseRangeHeader(rangeHeader: string, totalSize: number) {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) {
    return null;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : totalSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSize) {
    return null;
  }

  return {
    start,
    end: Math.min(end, totalSize - 1),
  };
}

export function serveRuntimeAssetRequest(request: NextRequest, rootFolder: string, pathParts: string[]) {
  const normalizedParts = normalizeAssetPathParts(pathParts);
  const access = authorizeRuntimeAssetRequest(request, rootFolder, normalizedParts);
  if ("response" in access) {
    return access.response;
  }

  const resolved = resolveAssetPath(rootFolder, normalizedParts);
  if (!resolved) {
    return NextResponse.json({ error: "文件路径不合法" }, { status: 400 });
  }

  if (!existsSync(resolved.targetPath)) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const stats = statSync(resolved.targetPath);
  if (!stats.isFile()) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const mimeType = getMimeType(resolved.targetPath);
  const commonHeaders = {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": access.cacheControl,
    ...(access.varyCookie ? { Vary: "Cookie" } : {}),
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method === "HEAD") {
    return new NextResponse(null, {
      status: 200,
      headers: {
        ...commonHeaders,
        "Content-Length": String(stats.size),
      },
    });
  }

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const parsedRange = parseRangeHeader(rangeHeader, stats.size);
    if (!parsedRange) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...commonHeaders,
          "Content-Range": `bytes */${stats.size}`,
        },
      });
    }

    const contentLength = parsedRange.end - parsedRange.start + 1;
    return new NextResponse(toReadableStream(resolved.targetPath, parsedRange.start, parsedRange.end), {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Length": String(contentLength),
        "Content-Range": `bytes ${parsedRange.start}-${parsedRange.end}/${stats.size}`,
      },
    });
  }

  return new NextResponse(toReadableStream(resolved.targetPath), {
    status: 200,
    headers: {
      ...commonHeaders,
      "Content-Length": String(stats.size),
    },
  });
}
