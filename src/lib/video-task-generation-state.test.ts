import assert from "node:assert/strict";
import test from "node:test";

import { hasGeneratedShotPlanArtifacts } from "./video-task-generation-state";
import type { ShotPlan, VideoTaskDirectorPlan } from "./video-task-schema";

function fallbackShotPlan(): ShotPlan {
  return {
    shots: [
      {
        shotIndex: 1,
        purpose: "hook",
        location: "",
        hasCharacters: false,
        characters: [],
        action: "景色与细节推进",
        emotion: "自然松弛",
        cameraMovement: "medium",
        durationSeconds: 5,
        sceneDescription: "围绕1号片段的主题画面",
        narrationHint: "1号片段亮点",
      },
    ],
    globalStyle: "默认风格",
    totalDurationSeconds: 5,
    validationErrors: [],
  };
}

test("空草稿不算已经生成镜头规划", () => {
  assert.equal(
    hasGeneratedShotPlanArtifacts({
      status: "CREATED",
      draftBundle: {
        textToImagePrompt: "",
        imageToVideoPrompt: "",
        narrationScript: "",
      },
      shotPlan: null,
      directorPlan: null,
    }),
    false,
  );
});

test("仅有兜底镜头规划不算已经生成镜头规划", () => {
  assert.equal(
    hasGeneratedShotPlanArtifacts({
      status: "CREATED",
      draftBundle: {
        textToImagePrompt: "",
        imageToVideoPrompt: "",
        narrationScript: "",
      },
      shotPlan: fallbackShotPlan(),
      directorPlan: null,
    }),
    false,
  );
});

test("真实 planner 草稿文案算已经生成镜头规划", () => {
  assert.equal(
    hasGeneratedShotPlanArtifacts({
      status: "CREATED",
      draftBundle: {
        textToImagePrompt: "镜头1：酒店外观建立镜头",
        imageToVideoPrompt: "",
        narrationScript: "",
      },
      shotPlan: null,
      directorPlan: null,
    }),
    true,
  );
});

test("真实故事板或后续阶段算已经生成镜头规划", () => {
  assert.equal(
    hasGeneratedShotPlanArtifacts({
      status: "SUBTITLE_AUDIO_READY",
      draftBundle: {
        textToImagePrompt: "",
        imageToVideoPrompt: "",
        narrationScript: "",
      },
      shotPlan: null,
      directorPlan: null,
    }),
    true,
  );
});

test("导演计划中的具体镜头内容算已经生成镜头规划", () => {
  const directorPlan = {
    storyShots: [
      {
        sceneDescription: "酒店泳池外立面，夕阳下有明确到店氛围",
        imagePrompt: "酒店泳池外立面，夕阳下有明确到店氛围",
        videoPrompt: "镜头缓慢推进酒店泳池外立面",
      },
    ],
  } as VideoTaskDirectorPlan;

  assert.equal(
    hasGeneratedShotPlanArtifacts({
      status: "CREATED",
      draftBundle: {
        textToImagePrompt: "",
        imageToVideoPrompt: "",
        narrationScript: "",
      },
      shotPlan: null,
      directorPlan,
    }),
    true,
  );
});
