import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import test from "node:test";

import {
  createDirectorVideoGenerationSession,
  deleteDirectorVideoGenerationImageCandidate,
  deleteDirectorVideoGenerationSession,
  getDirectorVideoGenerationSession,
  replaceDirectorVideoGenerationImageCandidate,
  setDirectorVideoGenerationImageCandidates,
} from "./director-video-generation-store";
import { resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function createTestOwnerId() {
  return `director-video-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("快速生成读取会话时过滤缺失的图片候选并提示重新生成", async () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
  });

  try {
    const withImage = await setDirectorVideoGenerationImageCandidates({
      session,
      assets: [{ url: null, b64Json: ONE_PIXEL_PNG_BASE64 }],
    });
    const [candidate] = withImage.imageCandidates;
    assert.ok(candidate);

    rmSync(resolveRuntimeAssetUrlToPath(candidate.imageUrl), { force: true });

    const repaired = getDirectorVideoGenerationSession(session.sessionId);
    assert.equal(repaired?.imageCandidates.length, 0);
    assert.equal(repaired?.selectedImageCandidateId, null);
    assert.equal(repaired?.imageStatus, "failed");
    assert.equal(repaired?.imageError, "图片文件已丢失，请重新生成图片。");
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

test("快速生成保存新图片失败时保留上一批本地图片文件", async () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
  });
  const originalFetch = globalThis.fetch;

  try {
    const withImage = await setDirectorVideoGenerationImageCandidates({
      session,
      assets: [{ url: null, b64Json: ONE_PIXEL_PNG_BASE64 }],
    });
    const [candidate] = withImage.imageCandidates;
    assert.ok(candidate);
    const oldImagePath = resolveRuntimeAssetUrlToPath(candidate.imageUrl);
    assert.equal(existsSync(oldImagePath), true);

    globalThis.fetch = (async () => new Response("failed", { status: 503 })) as typeof fetch;

    await assert.rejects(
      () =>
        setDirectorVideoGenerationImageCandidates({
          session: withImage,
          assets: [{ url: "https://example.com/new-image.png", b64Json: null }],
        }),
      /下载生成图片失败/,
    );

    assert.equal(existsSync(oldImagePath), true);
    const current = getDirectorVideoGenerationSession(session.sessionId);
    assert.equal(current?.imageCandidates[0]?.imageUrl, candidate.imageUrl);
  } finally {
    globalThis.fetch = originalFetch;
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

test("快速生成删除已选图片后会移除文件并自动选择下一张", async () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
  });

  try {
    const withImages = await setDirectorVideoGenerationImageCandidates({
      session,
      assets: [
        { url: null, b64Json: ONE_PIXEL_PNG_BASE64 },
        { url: null, b64Json: ONE_PIXEL_PNG_BASE64 },
      ],
    });
    const [firstCandidate, secondCandidate] = withImages.imageCandidates;
    assert.ok(firstCandidate);
    assert.ok(secondCandidate);
    const deletedPath = resolveRuntimeAssetUrlToPath(firstCandidate.imageUrl);
    assert.equal(existsSync(deletedPath), true);

    const next = deleteDirectorVideoGenerationImageCandidate(session.sessionId, firstCandidate.candidateId);

    assert.equal(existsSync(deletedPath), false);
    assert.equal(next?.imageCandidates.length, 1);
    assert.equal(next?.selectedImageCandidateId, secondCandidate.candidateId);
    assert.equal(next?.videoStatus, "idle");
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

test("快速生成单张重生失败时保留原图片候选", async () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
  });
  const originalFetch = globalThis.fetch;

  try {
    const withImage = await setDirectorVideoGenerationImageCandidates({
      session,
      assets: [{ url: null, b64Json: ONE_PIXEL_PNG_BASE64 }],
    });
    const [candidate] = withImage.imageCandidates;
    assert.ok(candidate);
    const oldImagePath = resolveRuntimeAssetUrlToPath(candidate.imageUrl);
    assert.equal(existsSync(oldImagePath), true);

    globalThis.fetch = (async () => new Response("failed", { status: 503 })) as typeof fetch;

    await assert.rejects(
      () =>
        replaceDirectorVideoGenerationImageCandidate({
          session: withImage,
          candidateId: candidate.candidateId,
          asset: { url: "https://example.com/new-image.png", b64Json: null },
        }),
      /下载生成图片失败/,
    );

    assert.equal(existsSync(oldImagePath), true);
    const current = getDirectorVideoGenerationSession(session.sessionId);
    assert.equal(current?.imageCandidates[0]?.imageUrl, candidate.imageUrl);
  } finally {
    globalThis.fetch = originalFetch;
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});
