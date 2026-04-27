import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectLocalMediaArtifactErrors, validateLocalMediaArtifact } from "./media-artifact-validator";

test("validateLocalMediaArtifact validates local media file existence and size", () => {
  const dir = mkdtempSync(join(tmpdir(), "travel-media-artifact-"));
  const validPath = join(dir, "valid.mp4");
  const emptyPath = join(dir, "empty.mp4");

  try {
    writeFileSync(validPath, Buffer.from("not-a-real-video-but-non-empty"));
    writeFileSync(emptyPath, Buffer.alloc(0));

    assert.equal(validateLocalMediaArtifact(validPath, "有效视频").passed, true);
    assert.match(validateLocalMediaArtifact(emptyPath, "空视频").message ?? "", /文件为空/);
    assert.match(validateLocalMediaArtifact(join(dir, "missing.mp4"), "丢失视频").message ?? "", /不存在/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectLocalMediaArtifactErrors does not block remote media URLs", () => {
  assert.deepEqual(
    collectLocalMediaArtifactErrors([
      {
        sourceUrl: "https://example.test/video.mp4",
        label: "远程视频",
      },
    ]),
    [],
  );
});
