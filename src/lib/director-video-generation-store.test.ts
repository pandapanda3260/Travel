import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import test from "node:test";

import {
  createDirectorVideoGenerationSession,
  deleteDirectorVideoGenerationImageCandidate,
  deleteDirectorVideoGenerationSession,
  getDirectorVideoGenerationSession,
  insertUploadedDirectorVideoGenerationImageCandidate,
  patchDirectorVideoGenerationSession,
  replaceDirectorVideoGenerationImageCandidate,
  replaceUploadedDirectorVideoGenerationImageCandidate,
  setDirectorVideoGenerationImageCandidates,
} from "./director-video-generation-store";
import { resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function createTestOwnerId() {
  return `director-video-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("快速生成新会话默认出图数量为 10", () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
  });

  try {
    assert.equal(session.imageSettings.outputCount, 10);
    const saved = getDirectorVideoGenerationSession(session.sessionId);
    assert.equal(saved?.imageSettings.outputCount, 10);
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

test("快速生成文生图提示词不会自动填充图生视频提示词", () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
    originalPrompt: "生成一张酒店大堂海报",
  });

  try {
    assert.equal(session.originalPrompt, "生成一张酒店大堂海报");
    assert.equal(session.imagePrompt, "生成一张酒店大堂海报");
    assert.equal(session.videoOriginalPrompt, "");
    assert.equal(session.videoPrompt, "");

    const withImagePrompt = patchDirectorVideoGenerationSession(session.sessionId, {
      optimizedPrompt: "优化后的文生图提示词",
      imagePrompt: "优化后的文生图提示词",
      promptStatus: "success",
    });

    assert.ok(withImagePrompt);
    assert.equal(withImagePrompt.videoOriginalPrompt, "");
    assert.equal(withImagePrompt.videoOptimizedPrompt, "");
    assert.equal(withImagePrompt.videoPrompt, "");
    assert.equal(withImagePrompt.videoPromptStatus, "idle");

    const saved = getDirectorVideoGenerationSession(session.sessionId);
    assert.equal(saved?.videoOriginalPrompt, "");
    assert.equal(saved?.videoOptimizedPrompt, "");
    assert.equal(saved?.videoPrompt, "");
    assert.equal(saved?.videoPromptStatus, "idle");
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

test("快速生成会清理旧会话中待处理的图生视频自动拷贝提示词", () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
    originalPrompt: "生成一张酒店大堂海报",
  });

  try {
    const withLegacyVideoPrompt = patchDirectorVideoGenerationSession(session.sessionId, {
      videoOriginalPrompt: "生成一张酒店大堂海报",
      videoOptimizedPrompt: "生成一张酒店大堂海报",
      videoPrompt: "生成一张酒店大堂海报",
      videoPromptStatus: "idle",
    });

    assert.ok(withLegacyVideoPrompt);

    const saved = getDirectorVideoGenerationSession(session.sessionId);
    assert.equal(saved?.videoOriginalPrompt, "");
    assert.equal(saved?.videoOptimizedPrompt, "");
    assert.equal(saved?.videoPrompt, "");
    assert.equal(saved?.videoPromptStatus, "idle");
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

test("快速生成会保留已优化成功的图生视频提示词", () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
    originalPrompt: "生成一张酒店大堂海报",
  });

  try {
    const withVideoPrompt = patchDirectorVideoGenerationSession(session.sessionId, {
      videoOriginalPrompt: "生成一张酒店大堂海报",
      videoOptimizedPrompt: "生成一张酒店大堂海报",
      videoPrompt: "生成一张酒店大堂海报",
      videoPromptStatus: "success",
    });

    assert.ok(withVideoPrompt);

    const saved = getDirectorVideoGenerationSession(session.sessionId);
    assert.equal(saved?.videoOriginalPrompt, "生成一张酒店大堂海报");
    assert.equal(saved?.videoOptimizedPrompt, "生成一张酒店大堂海报");
    assert.equal(saved?.videoPrompt, "生成一张酒店大堂海报");
    assert.equal(saved?.videoPromptStatus, "success");
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

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

test("快速生成上传图片会置顶并在批量重生时保留用户上传图", async () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
  });

  try {
    const withGeneratedImages = await setDirectorVideoGenerationImageCandidates({
      session,
      assets: [
        { url: null, b64Json: ONE_PIXEL_PNG_BASE64 },
        { url: null, b64Json: ONE_PIXEL_PNG_BASE64 },
      ],
    });
    const [oldGeneratedCandidate] = withGeneratedImages.imageCandidates;
    assert.ok(oldGeneratedCandidate);
    const oldGeneratedPath = resolveRuntimeAssetUrlToPath(oldGeneratedCandidate.imageUrl);
    assert.equal(existsSync(oldGeneratedPath), true);

    const withUploadedImage = await insertUploadedDirectorVideoGenerationImageCandidate({
      session: withGeneratedImages,
      bytes: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      contentType: "image/png",
    });
    const [uploadedCandidate] = withUploadedImage.imageCandidates;
    assert.ok(uploadedCandidate);
    const uploadedPath = resolveRuntimeAssetUrlToPath(uploadedCandidate.imageUrl);

    assert.equal(uploadedCandidate.source, "uploaded");
    assert.equal(withUploadedImage.selectedImageCandidateId, uploadedCandidate.candidateId);
    assert.equal(existsSync(uploadedPath), true);

    const withRegeneratedImages = await setDirectorVideoGenerationImageCandidates({
      session: withUploadedImage,
      assets: [{ url: null, b64Json: ONE_PIXEL_PNG_BASE64 }],
    });

    assert.equal(withRegeneratedImages.imageCandidates.length, 2);
    assert.equal(withRegeneratedImages.imageCandidates[0]?.candidateId, uploadedCandidate.candidateId);
    assert.equal(withRegeneratedImages.imageCandidates[0]?.source, "uploaded");
    assert.equal(withRegeneratedImages.imageCandidates[1]?.source, "generated");
    assert.equal(withRegeneratedImages.selectedImageCandidateId, uploadedCandidate.candidateId);
    assert.equal(existsSync(uploadedPath), true);
    assert.equal(existsSync(oldGeneratedPath), false);
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});

test("快速生成重新上传会保留候选 ID 和选择状态", async () => {
  const session = createDirectorVideoGenerationSession({
    ownerUserId: createTestOwnerId(),
  });

  try {
    const withUploadedImage = await insertUploadedDirectorVideoGenerationImageCandidate({
      session,
      bytes: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      contentType: "image/png",
    });
    const [uploadedCandidate] = withUploadedImage.imageCandidates;
    assert.ok(uploadedCandidate);
    const uploadedPath = resolveRuntimeAssetUrlToPath(uploadedCandidate.imageUrl);
    assert.equal(existsSync(uploadedPath), true);

    const withReuploadedImage = await replaceUploadedDirectorVideoGenerationImageCandidate({
      session: withUploadedImage,
      candidateId: uploadedCandidate.candidateId,
      bytes: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      contentType: "image/png",
    });

    assert.ok(withReuploadedImage);
    const [reuploadedCandidate] = withReuploadedImage.imageCandidates;
    assert.ok(reuploadedCandidate);
    assert.equal(withReuploadedImage.imageCandidates.length, 1);
    assert.equal(reuploadedCandidate.candidateId, uploadedCandidate.candidateId);
    assert.equal(reuploadedCandidate.source, "uploaded");
    assert.notEqual(reuploadedCandidate.imageUrl, uploadedCandidate.imageUrl);
    assert.equal(withReuploadedImage.selectedImageCandidateId, uploadedCandidate.candidateId);
    assert.equal(existsSync(uploadedPath), false);
    assert.equal(existsSync(resolveRuntimeAssetUrlToPath(reuploadedCandidate.imageUrl)), true);
  } finally {
    deleteDirectorVideoGenerationSession(session.sessionId);
  }
});
