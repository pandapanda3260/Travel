import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import { isPathWithinDirectory, joinRuntimePublicStoragePath } from "./runtime-storage";

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
  return Readable.toWeb(createReadStream(filePath, start != null || end != null ? { start, end } : undefined)) as ReadableStream;
}

function getMimeType(filePath: string) {
  return mimeTypeMap[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveAssetPath(rootFolder: string, pathParts: string[]) {
  const normalizedParts = pathParts
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter(Boolean);
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
  const resolved = resolveAssetPath(rootFolder, pathParts);
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
    "Cache-Control": "public, max-age=3600",
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
