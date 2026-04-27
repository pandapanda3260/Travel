import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  deleteTaskStageProgressByTaskId,
  failTaskStageProgress,
  getTaskStageProgress,
  startTaskStageProgress,
} from "./task-stage-progress-store";
import { taskStageProgressKeys } from "./task-stage-progress";
import { getDefaultTaskCreationParameterState } from "./task-creation-parameters";
import { syncTaskVisualImageSelectionState } from "./task-visual-image-stage";
import {
  deleteTaskVisualImageShotsByTaskId,
  generateTaskVisualImageShot,
  selectTaskVisualImageCandidate,
  uploadTaskVisualImage,
} from "./task-visual-image-store";
import {
  completeKeyMaterialWorkflowStep,
  createKeyMaterialWorkflow,
  deleteKeyMaterialWorkflowsByTaskId,
  failKeyMaterialWorkflow,
  getLatestKeyMaterialWorkflow,
  keyMaterialStepKeys,
  startKeyMaterialWorkflowStep,
} from "./key-material-task-store";
import { createVideoTask, deleteVideoTask } from "./video-task-store";
import type { ShotPlan, VideoTaskParameterBundle } from "./video-task-schema";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII=",
  "base64",
);

function buildShotPlan(): ShotPlan {
  return {
    globalStyle: "测试风格",
    totalDurationSeconds: 4,
    validationErrors: [],
    shots: [
      {
        shotIndex: 1,
        segmentIndex: 1,
        segmentId: "segment-1",
        purpose: "hook",
        location: "测试地点",
        hasCharacters: false,
        characters: [],
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: true,
        hasSubtitle: true,
        requiresLipSync: false,
        action: "展示测试空间",
        emotion: "自然",
        cameraMovement: "auto",
        durationSeconds: 4,
        sceneDescription: "测试镜头画面",
        narrationHint: "测试讲解",
      },
    ],
  };
}

function buildParameters(): VideoTaskParameterBundle {
  const state = getDefaultTaskCreationParameterState();

  return {
    image: {
      size: state.imageSize,
      guidanceScale: state.imageGuidanceScale,
      watermark: state.imageWatermark,
      seed: null,
    },
    video: {
      videoType: "agency_guide_voiceover",
      segmentMode: "multi_shot_montage",
      expectedDurationRange: state.videoExpectedDurationRange,
      storyShotCount: 1,
      storyShotsPerSegment: 1,
      introSegmentDurationSeconds: null,
      mode: state.videoMode,
      multiShot: true,
      shotType: "customize",
      enableTailFrame: false,
      segmentCount: 1,
      durationSeconds: 4,
      aspectRatio: state.videoAspectRatio,
      cfgScale: state.videoCfgScale,
      cameraControl: state.videoCameraControl,
      generateAudio: state.videoGenerateAudio,
      watermark: state.videoWatermark,
      negativePrompt: state.videoNegativePrompt,
    },
    audio: {
      voiceId: state.audioVoiceId,
      storyboardEnabled: state.audioStoryboardEnabled,
      storyboardVoiceIds: state.audioStoryboardVoiceIds,
      format: state.audioFormat,
      sampleRate: state.audioSampleRate,
      speechRate: state.audioSpeechRate,
      loudnessRate: state.audioLoudnessRate,
      enableSubtitle: state.audioEnableSubtitle,
    },
    composition: {
      includeBackgroundMusic: state.compositionIncludeBackgroundMusic,
      backgroundMusicUrl: state.compositionBackgroundMusicUrl || null,
      backgroundMusicVolume: state.compositionBackgroundMusicVolume,
      subtitleConfig: state.compositionSubtitleConfig,
    },
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "low",
      sceneConsistency: "low",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  };
}

function createVisualTestTask() {
  return createVideoTask({
    ownerUserId: "test-user",
    title: "视觉状态测试任务",
    source: {
      productInfoId: null,
      productInfoTitle: null,
      productInfoSnapshot: "测试商品信息",
      userPrompt: "",
      videoMaterialId: null,
      videoMaterialName: null,
      videoTemplatePrompt: "",
    },
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: "",
    },
    shotPlan: buildShotPlan(),
    parameters: buildParameters(),
  });
}

test("补图后会自动清除旧的视觉失败状态", async () => {
  const task = createVisualTestTask();

  try {
    failTaskStageProgress(task.taskId, taskStageProgressKeys.visualImages, new Error("片段 12 图片生成失败"));

    await uploadTaskVisualImage({
      task,
      segmentId: "segment-1",
      segmentIndex: 1,
      shotIndex: 1,
      prompt: "测试镜头提示词",
      imageBuffer: TINY_PNG,
      contentType: "image/png",
    });

    const nextTask = syncTaskVisualImageSelectionState(task.taskId, {
      completionMessage: "已手动补图，参考图已就绪",
    });
    const progress = getTaskStageProgress(task.taskId, taskStageProgressKeys.visualImages);

    assert.equal(nextTask?.status, "IMAGES_READY");
    assert.equal(progress?.status, "COMPLETED");
    assert.equal(progress?.errorMessage, null);
    assert.equal(progress?.message, "已手动补图，参考图已就绪");
  } finally {
    deleteTaskVisualImageShotsByTaskId(task.taskId, { reason: "user_manual_delete" });
    deleteTaskStageProgressByTaskId(task.taskId);
    deleteVideoTask(task.taskId);
  }
});

test("补图后会自动清除关键素材流程里的旧视觉失败错误", async () => {
  const task = createVisualTestTask();

  try {
    const workflow = createKeyMaterialWorkflow({
      taskId: task.taskId,
      mode: "run",
    });
    startKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.subtitleAudio);
    completeKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.subtitleAudio);
    startKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.visualImages);
    failKeyMaterialWorkflow(workflow.workflowId, "片段 12.1 图片生成失败：图片生成触发安全拦截");

    await uploadTaskVisualImage({
      task,
      segmentId: "segment-1",
      segmentIndex: 1,
      shotIndex: 1,
      prompt: "测试镜头提示词",
      imageBuffer: TINY_PNG,
      contentType: "image/png",
    });

    syncTaskVisualImageSelectionState(task.taskId, {
      completionMessage: "已手动补图，参考图已就绪",
    });
    const nextWorkflow = getLatestKeyMaterialWorkflow(task.taskId);

    assert.equal(nextWorkflow?.status, "success");
    assert.equal(nextWorkflow?.lastError, null);
    assert.equal(nextWorkflow?.steps[keyMaterialStepKeys.visualImages].status, "success");
    assert.equal(nextWorkflow?.steps[keyMaterialStepKeys.visualImages].errorMessage, null);
    assert.equal(nextWorkflow?.steps[keyMaterialStepKeys.visualImages].output?.selectedShotCount, 1);
  } finally {
    deleteTaskVisualImageShotsByTaskId(task.taskId, { reason: "user_manual_delete" });
    deleteTaskStageProgressByTaskId(task.taskId);
    deleteKeyMaterialWorkflowsByTaskId(task.taskId);
    deleteVideoTask(task.taskId);
  }
});

test("视觉阶段仍在运行时不会被补图动作误标记为完成", async () => {
  const task = createVisualTestTask();

  try {
    startTaskStageProgress({
      taskId: task.taskId,
      stageKey: taskStageProgressKeys.visualImages,
      runId: "visual-running",
      message: "镜头 12 参考图生成中...",
      percent: 40,
      status: "IN_PROGRESS",
    });

    await uploadTaskVisualImage({
      task,
      segmentId: "segment-1",
      segmentIndex: 1,
      shotIndex: 1,
      prompt: "测试镜头提示词",
      imageBuffer: TINY_PNG,
      contentType: "image/png",
    });

    syncTaskVisualImageSelectionState(task.taskId, {
      completionMessage: "已手动补图，参考图已就绪",
    });
    const progress = getTaskStageProgress(task.taskId, taskStageProgressKeys.visualImages);

    assert.equal(progress?.status, "IN_PROGRESS");
    assert.equal(progress?.message, "镜头 12 参考图生成中...");
  } finally {
    deleteTaskVisualImageShotsByTaskId(task.taskId, { reason: "user_manual_delete" });
    deleteTaskStageProgressByTaskId(task.taskId);
    deleteVideoTask(task.taskId);
  }
});

test("重新生成参考图会追加 AI 候选并保留已选候选", async () => {
  const task = createVisualTestTask();
  const asset = { url: null, b64Json: TINY_PNG.toString("base64") };

  try {
    const firstRecord = await generateTaskVisualImageShot({
      task,
      segmentId: "segment-1",
      segmentIndex: 1,
      shotIndex: 1,
      prompt: "测试镜头提示词",
      assets: [asset, asset],
    });
    const selectedCandidateId = firstRecord.candidates[0]?.candidateId ?? "";
    assert.ok(selectedCandidateId);
    selectTaskVisualImageCandidate(task.taskId, 1, selectedCandidateId);

    const nextRecord = await generateTaskVisualImageShot({
      task,
      segmentId: "segment-1",
      segmentIndex: 1,
      shotIndex: 1,
      prompt: "测试镜头提示词",
      assets: [asset, asset],
    });

    assert.equal(nextRecord.candidates.length, 4);
    assert.equal(nextRecord.selectedCandidateId, selectedCandidateId);
    assert.ok(nextRecord.candidates.some((candidate) => candidate.candidateId === selectedCandidateId));
  } finally {
    deleteTaskVisualImageShotsByTaskId(task.taskId, { reason: "user_manual_delete" });
    deleteVideoTask(task.taskId);
  }
});
