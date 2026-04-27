import { NextRequest, NextResponse } from "next/server";

import { directorPrimaryStepActionKeys } from "../../../../../lib/director-step-actions";
import {
  acquireKeyMaterialWorkflowLock,
  buildRetryKeyMaterialWorkflow,
  completeKeyMaterialWorkflow,
  completeKeyMaterialWorkflowStep,
  createKeyMaterialWorkflow,
  failKeyMaterialWorkflow,
  getActiveKeyMaterialWorkflow,
  getKeyMaterialWorkflowByRequestId,
  getLatestKeyMaterialWorkflow,
  isKeyMaterialWorkflowRunning,
  keyMaterialStepKeys,
  patchKeyMaterialWorkflow,
  releaseKeyMaterialWorkflowLock,
  startKeyMaterialWorkflow,
  startKeyMaterialWorkflowStep,
  touchKeyMaterialWorkflow,
  type KeyMaterialWorkflowRecord,
} from "../../../../../lib/key-material-task-store";
import { createProgressStream, type ProgressCallback } from "../../../../../lib/progress-stream";
import { readJsonProgressStream } from "../../../../../lib/progress-stream-reader";
import { failTaskStageProgress } from "../../../../../lib/task-stage-progress-store";
import { taskStageProgressKeys } from "../../../../../lib/task-stage-progress";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { getVideoTask } from "../../../../../lib/video-task-store";
import { usesCapturedMaterialFirstWorkflow, type VideoTaskRecord } from "../../../../../lib/video-task-schema";

import type { GenerateSubtitleAudioRequest } from "../subtitle-audio-run/route";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type KeyMaterialWorkflowAction = "run" | "retry_failed_step" | "retry_all";

type KeyMaterialRunRequest = Omit<GenerateSubtitleAudioRequest, "action"> & {
  action?: KeyMaterialWorkflowAction;
  requestId?: string;
};

type SubtitleAudioRunPayload = {
  task?: VideoTaskRecord | null;
  result?: {
    resultId: string;
    subtitleSrtUrl: string | null;
    mergedAudioUrl: string | null;
  } | null;
  validation?: {
    passed?: boolean;
  } | null;
  error?: string;
};

type VisualImageRunPayload = {
  task?: VideoTaskRecord | null;
  shots?: Array<{
    selectedCandidateId?: string | null;
  }> | null;
  validation?: {
    passed?: boolean;
  } | null;
  error?: string;
};

function buildRequestSnapshot(body: KeyMaterialRunRequest) {
  return {
    narrationScriptLength: body.narrationScript?.trim().length ?? 0,
    video: body.video ?? null,
    audio: body.audio
      ? {
          storyboardEnabled: body.audio.storyboardEnabled ?? null,
          voiceId: body.audio.voiceId ?? null,
          storyboardVoiceCount: body.audio.storyboardVoiceIds?.length ?? 0,
          format: body.audio.format ?? null,
          sampleRate: body.audio.sampleRate ?? null,
          speechRate: body.audio.speechRate ?? null,
          loudnessRate: body.audio.loudnessRate ?? null,
          enableSubtitle: body.audio.enableSubtitle ?? null,
        }
      : null,
  } satisfies Record<string, unknown>;
}

function resolveOverallPercent(workflow: KeyMaterialWorkflowRecord, childPercent = 0) {
  const subtitleStep = workflow.steps[keyMaterialStepKeys.subtitleAudio];
  const visualStep = workflow.steps[keyMaterialStepKeys.visualImages];
  const normalizedChildPercent = Math.max(0, Math.min(100, Math.round(childPercent)));

  if (workflow.status === "success") {
    return 100;
  }

  if (visualStep.status === "running") {
    return Math.max(50, Math.min(99, 50 + Math.round(normalizedChildPercent / 2)));
  }

  if (subtitleStep.status === "running") {
    return Math.max(1, Math.min(49, Math.round(normalizedChildPercent / 2)));
  }

  if (subtitleStep.status === "success" && visualStep.status === "pending") {
    return 50;
  }

  if (subtitleStep.status === "success" && visualStep.status === "success") {
    return 100;
  }

  return 1;
}

function emitWorkflowProgress(input: {
  send?: ProgressCallback;
  workflow: KeyMaterialWorkflowRecord;
  task: VideoTaskRecord | null;
  message: string;
  childPercent?: number;
  childStep?: string;
  extra?: Record<string, unknown>;
}) {
  input.send?.(
    input.childStep ?? "key_materials",
    resolveOverallPercent(input.workflow, input.childPercent ?? 0),
    input.message,
    {
      workflow: input.workflow,
      task: input.task,
      ...(input.extra ?? {}),
    },
  );
}

function buildImmediateResult(workflow: KeyMaterialWorkflowRecord, task: VideoTaskRecord | null, extra?: Record<string, unknown>) {
  return {
    workflow,
    task,
    ...(extra ?? {}),
  };
}

function getVisualKeyMaterialStepMessage(task: VideoTaskRecord | null, fallback = "视觉图片生成中...") {
  if (task && usesCapturedMaterialFirstWorkflow(task.parameters.video.videoType)) {
    return "素材镜头同步与 AI 补图中...";
  }
  return fallback;
}

function taskUsesCapturedMaterialFirstWorkflow(task: VideoTaskRecord | null) {
  return Boolean(task && usesCapturedMaterialFirstWorkflow(task.parameters.video.videoType));
}

function failVisualStageProgressFromWorkflow(taskId: string, workflowId: string, error: unknown) {
  failTaskStageProgress(taskId, taskStageProgressKeys.visualImages, error, {
    runId: `${workflowId}:failed`,
    startedAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error ?? "视觉图片生成失败"),
  });
}

function buildInternalRequestHeaders(input: {
  cookieHeader: string | null;
  authorizationHeader: string | null;
  workflowId: string;
}) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-key-material-workflow-id": input.workflowId,
  });

  if (input.cookieHeader) {
    headers.set("cookie", input.cookieHeader);
  }
  if (input.authorizationHeader) {
    headers.set("authorization", input.authorizationHeader);
  }

  return headers;
}

async function runSubtitleAudioChildStep(input: {
  baseUrl: string;
  taskId: string;
  workflowId: string;
  body: GenerateSubtitleAudioRequest;
  cookieHeader: string | null;
  authorizationHeader: string | null;
  onEvent?: (event: Record<string, unknown>) => void;
}) {
  const response = await fetch(new URL(`/api/video-tasks/${input.taskId}/subtitle-audio-run`, input.baseUrl), {
    method: "POST",
    headers: buildInternalRequestHeaders({
      cookieHeader: input.cookieHeader,
      authorizationHeader: input.authorizationHeader,
      workflowId: input.workflowId,
    }),
    body: JSON.stringify(input.body),
    cache: "no-store",
  });

  return readJsonProgressStream<SubtitleAudioRunPayload>({
    response,
    defaultErrorMessage: "关键素材子任务执行失败",
    missingBodyMessage: "关键素材子任务未返回可读取的进度流",
    missingResultMessage: "关键素材子任务流结束但未返回结果",
    onEvent: input.onEvent,
  });
}

async function runVisualImageChildStep(input: {
  baseUrl: string;
  taskId: string;
  workflowId: string;
  regenerateAll: boolean;
  cookieHeader: string | null;
  authorizationHeader: string | null;
  onEvent?: (event: Record<string, unknown>) => void;
}) {
  const response = await fetch(new URL(`/api/video-tasks/${input.taskId}/visual-images`, input.baseUrl), {
    method: "POST",
    headers: buildInternalRequestHeaders({
      cookieHeader: input.cookieHeader,
      authorizationHeader: input.authorizationHeader,
      workflowId: input.workflowId,
    }),
    body: JSON.stringify({
      action: directorPrimaryStepActionKeys.buildVisualReferences,
      regenerateAll: input.regenerateAll,
    }),
    cache: "no-store",
  });

  return readJsonProgressStream<VisualImageRunPayload>({
    response,
    defaultErrorMessage: "关键素材子任务执行失败",
    missingBodyMessage: "关键素材子任务未返回可读取的进度流",
    missingResultMessage: "关键素材子任务流结束但未返回结果",
    onEvent: input.onEvent,
  });
}

async function runKeyMaterialWorkflow(input: {
  workflow: KeyMaterialWorkflowRecord;
  task: VideoTaskRecord;
  action: KeyMaterialWorkflowAction;
  body: KeyMaterialRunRequest;
  baseUrl: string;
  cookieHeader: string | null;
  authorizationHeader: string | null;
  send?: ProgressCallback;
}) {
  const workflowId = input.workflow.workflowId;
  const taskId = input.task.taskId;
  let latestTask = getVideoTask(taskId) ?? input.task;
  let latestWorkflow = startKeyMaterialWorkflow(workflowId) ?? input.workflow;

  emitWorkflowProgress({
    send: input.send,
    workflow: latestWorkflow,
    task: latestTask,
    message:
      latestWorkflow.steps[keyMaterialStepKeys.subtitleAudio].status === "success"
        ? "字幕音频已就绪，准备生成视觉图片..."
        : "准备生成关键素材...",
  });

  try {
    const needsSubtitleAudio = latestWorkflow.steps[keyMaterialStepKeys.subtitleAudio].status !== "success";
    if (needsSubtitleAudio) {
      latestWorkflow = startKeyMaterialWorkflowStep(workflowId, keyMaterialStepKeys.subtitleAudio) ?? latestWorkflow;
      emitWorkflowProgress({
        send: input.send,
        workflow: latestWorkflow,
        task: latestTask,
        message: "字幕音频生成中...",
        childPercent: 1,
        childStep: keyMaterialStepKeys.subtitleAudio,
      });

      const subtitlePayload = await runSubtitleAudioChildStep({
        baseUrl: input.baseUrl,
        taskId,
        workflowId,
        body: {
          ...input.body,
          action: directorPrimaryStepActionKeys.buildSubtitleAudio,
        },
        cookieHeader: input.cookieHeader,
        authorizationHeader: input.authorizationHeader,
        onEvent: (event) => {
          touchKeyMaterialWorkflow(workflowId);
          const refreshedWorkflow = patchKeyMaterialWorkflow(workflowId, {}) ?? latestWorkflow;
          emitWorkflowProgress({
            send: input.send,
            workflow: refreshedWorkflow,
            task: getVideoTask(taskId) ?? latestTask,
            message: String(event.message ?? "字幕音频生成中..."),
            childPercent: Number(event.percent ?? 0),
            childStep: String(event.step ?? keyMaterialStepKeys.subtitleAudio),
            extra: Object.fromEntries(
              Object.entries(event).filter(([key]) => !["step", "percent", "message"].includes(key)),
            ),
          });
        },
      });

      latestTask = subtitlePayload.task ?? getVideoTask(taskId) ?? latestTask;
      if (subtitlePayload.error || !subtitlePayload.result) {
        const failedWorkflow = failKeyMaterialWorkflow(workflowId, subtitlePayload.error ?? "字幕音频生成失败") ?? latestWorkflow;
        latestWorkflow = failedWorkflow;
        emitWorkflowProgress({
          send: input.send,
          workflow: latestWorkflow,
          task: latestTask,
          message: subtitlePayload.error ?? "字幕音频生成失败",
          childPercent: 100,
          childStep: keyMaterialStepKeys.subtitleAudio,
        });
        return buildImmediateResult(latestWorkflow, latestTask, {
          subtitle: subtitlePayload,
          error: subtitlePayload.error ?? "字幕音频生成失败",
        });
      }

      latestWorkflow =
        completeKeyMaterialWorkflowStep(workflowId, keyMaterialStepKeys.subtitleAudio, {
          narrationResultId: subtitlePayload.result.resultId,
          subtitleSrtUrl: subtitlePayload.result.subtitleSrtUrl,
          mergedAudioUrl: subtitlePayload.result.mergedAudioUrl,
          validationPassed: subtitlePayload.validation?.passed ?? null,
        }) ?? latestWorkflow;
      emitWorkflowProgress({
        send: input.send,
        workflow: latestWorkflow,
        task: latestTask,
        message: "字幕音频生成完成",
        childPercent: 100,
        childStep: keyMaterialStepKeys.subtitleAudio,
        extra: {
          subtitle: subtitlePayload,
        },
      });
    } else {
      latestWorkflow = touchKeyMaterialWorkflow(workflowId) ?? latestWorkflow;
      emitWorkflowProgress({
        send: input.send,
        workflow: latestWorkflow,
        task: latestTask,
        message: taskUsesCapturedMaterialFirstWorkflow(latestTask)
          ? "复用已成功的字幕音频结果，继续同步素材镜头..."
          : "复用已成功的字幕音频结果，继续生成视觉图片...",
        childPercent: 100,
        childStep: keyMaterialStepKeys.subtitleAudio,
      });
    }

    latestWorkflow = startKeyMaterialWorkflowStep(workflowId, keyMaterialStepKeys.visualImages) ?? latestWorkflow;
    emitWorkflowProgress({
      send: input.send,
      workflow: latestWorkflow,
      task: latestTask,
      message: getVisualKeyMaterialStepMessage(latestTask),
      childPercent: 1,
      childStep: keyMaterialStepKeys.visualImages,
    });

    const visualPayload = await runVisualImageChildStep({
      baseUrl: input.baseUrl,
      taskId,
      workflowId,
      regenerateAll: input.action === "retry_all",
      cookieHeader: input.cookieHeader,
      authorizationHeader: input.authorizationHeader,
      onEvent: (event) => {
        touchKeyMaterialWorkflow(workflowId);
        const refreshedWorkflow = patchKeyMaterialWorkflow(workflowId, {}) ?? latestWorkflow;
        emitWorkflowProgress({
          send: input.send,
          workflow: refreshedWorkflow,
          task: getVideoTask(taskId) ?? latestTask,
          message: String(event.message ?? getVisualKeyMaterialStepMessage(getVideoTask(taskId) ?? latestTask)),
          childPercent: Number(event.percent ?? 0),
          childStep: String(event.step ?? keyMaterialStepKeys.visualImages),
          extra: Object.fromEntries(
            Object.entries(event).filter(([key]) => !["step", "percent", "message"].includes(key)),
          ),
        });
      },
    });

    latestTask = visualPayload.task ?? getVideoTask(taskId) ?? latestTask;
    if (visualPayload.error) {
      const failedWorkflow = failKeyMaterialWorkflow(workflowId, visualPayload.error) ?? latestWorkflow;
      latestWorkflow = failedWorkflow;
      failVisualStageProgressFromWorkflow(taskId, workflowId, visualPayload.error);
      emitWorkflowProgress({
        send: input.send,
        workflow: latestWorkflow,
        task: latestTask,
        message: visualPayload.error,
        childPercent: 100,
        childStep: keyMaterialStepKeys.visualImages,
      });
      return buildImmediateResult(latestWorkflow, latestTask, {
        visual: visualPayload,
        error: visualPayload.error,
      });
    }

    latestWorkflow =
      completeKeyMaterialWorkflowStep(workflowId, keyMaterialStepKeys.visualImages, {
        generatedShotCount: visualPayload.shots?.length ?? 0,
        selectedShotCount: visualPayload.shots?.filter((shot) => Boolean(shot.selectedCandidateId)).length ?? 0,
        validationPassed: visualPayload.validation?.passed ?? null,
      }) ?? latestWorkflow;
    latestWorkflow = completeKeyMaterialWorkflow(workflowId) ?? latestWorkflow;

    emitWorkflowProgress({
      send: input.send,
      workflow: latestWorkflow,
      task: latestTask,
      message: "关键素材生成完成",
      childPercent: 100,
      childStep: keyMaterialStepKeys.visualImages,
      extra: {
        visual: visualPayload,
      },
    });

    return buildImmediateResult(latestWorkflow, latestTask, {
      visual: visualPayload,
    });
  } catch (error) {
    const failedWorkflow = failKeyMaterialWorkflow(workflowId, error) ?? latestWorkflow;
    latestWorkflow = failedWorkflow;
    latestTask = getVideoTask(taskId) ?? latestTask;
    if (latestWorkflow.steps[keyMaterialStepKeys.visualImages].status === "failed") {
      failVisualStageProgressFromWorkflow(taskId, workflowId, error);
    }
    emitWorkflowProgress({
      send: input.send,
      workflow: latestWorkflow,
      task: latestTask,
      message: error instanceof Error ? error.message : "关键素材生成失败",
    });
    return buildImmediateResult(latestWorkflow, latestTask, {
      error: error instanceof Error ? error.message : "关键素材生成失败",
    });
  } finally {
    releaseKeyMaterialWorkflowLock(taskId, workflowId);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const access = requireOwnedVideoTask(request, taskId);
  if ("response" in access) {
    return access.response;
  }

  const activeWorkflow = getActiveKeyMaterialWorkflow(taskId);
  const latestWorkflow = getLatestKeyMaterialWorkflow(taskId);

  return NextResponse.json({
    taskId,
    task: getVideoTask(taskId),
    workflow: activeWorkflow ?? latestWorkflow,
    hasActiveWorkflow: isKeyMaterialWorkflowRunning(activeWorkflow),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId, {
      forbiddenMessage: "无权修改该视频任务",
    });
    if ("response" in access) {
      return access.response;
    }

    const body = (await request.json().catch(() => ({}))) as KeyMaterialRunRequest;
    const action = body.action ?? "run";
    const requestId = body.requestId?.trim() || crypto.randomUUID();
    const task = getVideoTask(taskId) ?? access.task;

    if (!["run", "retry_failed_step", "retry_all"].includes(action)) {
      return NextResponse.json({ error: "不支持的关键素材操作" }, { status: 400 });
    }

    const existingByRequestId = getKeyMaterialWorkflowByRequestId(taskId, requestId);
    if (existingByRequestId) {
      return createProgressStream(async () =>
        buildImmediateResult(existingByRequestId, getVideoTask(taskId) ?? task, {
          reused: true,
        }),
      );
    }

    const activeWorkflow = getActiveKeyMaterialWorkflow(taskId);
    if (activeWorkflow) {
      return createProgressStream(async () =>
        buildImmediateResult(activeWorkflow, getVideoTask(taskId) ?? task, {
          reused: true,
        }),
      );
    }

    const latestWorkflow = getLatestKeyMaterialWorkflow(taskId);
    const requestSnapshot = buildRequestSnapshot(body);
    let workflow: KeyMaterialWorkflowRecord;

    if (action === "retry_failed_step" || action === "retry_all") {
      if (!latestWorkflow || (latestWorkflow.status !== "failed" && latestWorkflow.status !== "partial_failed")) {
        return NextResponse.json({ error: "当前没有可重试的关键素材失败任务" }, { status: 400 });
      }

      workflow = buildRetryKeyMaterialWorkflow({
        taskId,
        ownerUserId: task.ownerUserId,
        requestId,
        mode: action,
        previousWorkflow: latestWorkflow,
        requestSnapshot,
      });
    } else {
      workflow = createKeyMaterialWorkflow({
        taskId,
        ownerUserId: task.ownerUserId,
        requestId,
        mode: "run",
        requestSnapshot,
      });
    }

    const lock = acquireKeyMaterialWorkflowLock({
      taskId,
      workflowId: workflow.workflowId,
    });
    if (!lock.ok) {
      return createProgressStream(async () =>
        buildImmediateResult(lock.workflow, getVideoTask(taskId) ?? task, {
          reused: true,
        }),
      );
    }

    return createProgressStream((send) =>
      runKeyMaterialWorkflow({
        workflow,
        task,
        action,
        body,
        baseUrl: new URL(request.url).origin,
        cookieHeader: request.headers.get("cookie"),
        authorizationHeader: request.headers.get("authorization"),
        send,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "关键素材生成失败" },
      { status: 500 },
    );
  }
}
