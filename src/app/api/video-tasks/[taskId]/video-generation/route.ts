import { NextRequest, NextResponse } from "next/server";

import { directorSecondaryStepActionKeys } from "../../../../../lib/director-step-actions";
import { createProgressStream, type ProgressCallback } from "../../../../../lib/progress-stream";
import { readJsonProgressStream } from "../../../../../lib/progress-stream-reader";
import {
  acquireVideoGenerationWorkflowLock,
  completeVideoGenerationWorkflow,
  completeVideoGenerationWorkflowStep,
  createVideoGenerationWorkflow,
  failVideoGenerationWorkflow,
  getActiveVideoGenerationWorkflow,
  getLatestVideoGenerationWorkflow,
  getVideoGenerationWorkflow,
  getVideoGenerationWorkflowByRequestId,
  isVideoGenerationWorkflowRunning,
  releaseVideoGenerationWorkflowLock,
  startVideoGenerationWorkflow,
  startVideoGenerationWorkflowStep,
  touchVideoGenerationWorkflow,
  videoGenerationStepKeys,
  type VideoGenerationWorkflowRecord,
} from "../../../../../lib/video-generation-workflow-store";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { getVideoTask } from "../../../../../lib/video-task-store";
import { reconcileVideoTaskRuntimeStatus } from "../../../../../lib/video-task-runtime-status";
import { getVideoTaskStatusIndex, type VideoTaskRecord } from "../../../../../lib/video-task-schema";
import { getDefaultSubtitleConfig, hydrateSubtitleConfig, type SubtitleConfig } from "../../../../../lib/subtitle-style-config";
import { normalizeNullableMediaSourceInput } from "../../../../../lib/media-source-input";
import { normalizeCompositionBackgroundMusicVolume } from "../../../../../lib/task-creation-parameters";
import { buildTaskClipShotPayloads } from "../../../../../lib/task-clip-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type VideoGenerationWorkflowAction = "run" | "continue" | "fail";

type VideoGenerationRunRequest = {
  action?: VideoGenerationWorkflowAction;
  requestId?: string;
  workflowId?: string;
  error?: string;
  composition?: {
    includeBackgroundMusic?: boolean;
    backgroundMusicUrl?: string;
    backgroundMusicVolume?: number;
    subtitleConfig?: Partial<SubtitleConfig>;
  };
};

type CompositionRunPayload = {
  task?: VideoTaskRecord | null;
  latestComposition?: {
    compositionId: string;
    status: "DRAFT" | "PROCESSING" | "COMPLETED" | "FAILED";
    outputVideoUrl: string | null;
    subtitleConfig: SubtitleConfig;
    backgroundMusicUrl: string | null;
    backgroundMusicVolume: number;
  } | null;
  result?: {
    compositionId: string;
    status: "DRAFT" | "PROCESSING" | "COMPLETED" | "FAILED";
    outputVideoUrl: string | null;
    subtitleConfig: SubtitleConfig;
    backgroundMusicUrl: string | null;
    backgroundMusicVolume: number;
  } | null;
  error?: string;
};

function buildRequestSnapshot(body: VideoGenerationRunRequest) {
  const includeBackgroundMusic = body.composition?.includeBackgroundMusic === true;
  const backgroundMusicUrl = includeBackgroundMusic
    ? normalizeNullableMediaSourceInput(body.composition?.backgroundMusicUrl)
    : null;
  const backgroundMusicVolume = normalizeCompositionBackgroundMusicVolume(body.composition?.backgroundMusicVolume);

  return {
    composition: {
      includeBackgroundMusic,
      backgroundMusicUrl,
      backgroundMusicVolume,
      subtitleConfig: hydrateSubtitleConfig(
        body.composition?.subtitleConfig,
        getDefaultSubtitleConfig(),
      ),
    },
  } satisfies Record<string, unknown>;
}

function buildInternalRequestHeaders(input: {
  cookieHeader: string | null;
  authorizationHeader: string | null;
  workflowId: string;
}) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-video-generation-workflow-id": input.workflowId,
  });

  if (input.cookieHeader) {
    headers.set("cookie", input.cookieHeader);
  }
  if (input.authorizationHeader) {
    headers.set("authorization", input.authorizationHeader);
  }

  return headers;
}

async function runCompositionChildStep(input: {
  baseUrl: string;
  taskId: string;
  workflowId: string;
  composition: {
    includeBackgroundMusic: boolean;
    backgroundMusicUrl: string | null;
    backgroundMusicVolume: number;
    subtitleConfig: SubtitleConfig;
  };
  cookieHeader: string | null;
  authorizationHeader: string | null;
  onEvent?: (event: Record<string, unknown>) => void;
}) {
  const response = await fetch(new URL(`/api/video-tasks/${input.taskId}/composition-runs`, input.baseUrl), {
    method: "POST",
    headers: buildInternalRequestHeaders({
      cookieHeader: input.cookieHeader,
      authorizationHeader: input.authorizationHeader,
      workflowId: input.workflowId,
    }),
    body: JSON.stringify({
      action: directorSecondaryStepActionKeys.autoComposeStoryVideo,
      includeBackgroundMusic: input.composition.includeBackgroundMusic,
      backgroundMusicUrl: input.composition.backgroundMusicUrl ?? undefined,
      backgroundMusicVolume: input.composition.backgroundMusicVolume,
      subtitleConfig: input.composition.subtitleConfig,
    }),
    cache: "no-store",
  });

  return readJsonProgressStream<CompositionRunPayload>({
    response,
    defaultErrorMessage: "视频合成子任务执行失败",
    missingBodyMessage: "视频合成子任务未返回可读取的进度流",
    missingResultMessage: "视频合成子任务流结束但未返回结果",
    onEvent: input.onEvent,
  });
}

function emitWorkflowProgress(input: {
  send?: ProgressCallback;
  workflow: VideoGenerationWorkflowRecord;
  task: VideoTaskRecord | null;
  message: string;
  childPercent?: number;
  childStep?: string;
  extra?: Record<string, unknown>;
}) {
  const normalizedChildPercent = Math.max(0, Math.min(100, Math.round(input.childPercent ?? 0)));
  const percent =
    input.workflow.status === "success"
      ? 100
      : input.workflow.currentStepKey === videoGenerationStepKeys.composition
        ? Math.max(50, Math.min(99, 50 + Math.round(normalizedChildPercent / 2)))
        : Math.max(1, Math.min(49, normalizedChildPercent > 0 ? Math.round(normalizedChildPercent / 2) : 1));

  input.send?.(input.childStep ?? "video_generation", percent, input.message, {
    workflow: input.workflow,
    task: input.task,
    ...(input.extra ?? {}),
  });
}

function buildImmediateResult(workflow: VideoGenerationWorkflowRecord | null, task: VideoTaskRecord | null, extra?: Record<string, unknown>) {
  return {
    workflow,
    task,
    ...(extra ?? {}),
  };
}

function hasPlayableClipJob(job: { status?: string | null; videoUrl?: string | null; remoteVideoUrl?: string | null } | null | undefined) {
  return Boolean(job?.status === "COMPLETED" && (job.videoUrl || job.remoteVideoUrl));
}

async function resolveClipGenerationReadiness(task: VideoTaskRecord) {
  const shots = await buildTaskClipShotPayloads(task, { readOnly: true });
  const totalCount = shots.length;
  const completedCount = shots.filter((shot) => hasPlayableClipJob(shot.job)).length;
  const failedCount = shots.filter((shot) => shot.job?.status === "FAILED").length;
  const missingCount = shots.filter((shot) => !shot.clipRecord || !shot.job).length;

  return {
    totalCount,
    completedCount,
    failedCount,
    missingCount,
    allCompleted: totalCount > 0 && completedCount === totalCount && failedCount === 0 && missingCount === 0,
  };
}

async function runCompositionWorkflow(input: {
  workflow: VideoGenerationWorkflowRecord;
  task: VideoTaskRecord;
  baseUrl: string;
  cookieHeader: string | null;
  authorizationHeader: string | null;
  send?: ProgressCallback;
}) {
  const workflowId = input.workflow.workflowId;
  const taskId = input.task.taskId;
  let latestTask = getVideoTask(taskId) ?? input.task;
  let latestWorkflow = completeVideoGenerationWorkflowStep(workflowId, videoGenerationStepKeys.clipGeneration) ?? input.workflow;
  latestWorkflow =
    startVideoGenerationWorkflowStep(workflowId, videoGenerationStepKeys.composition) ?? latestWorkflow;

  const compositionSnapshot = (latestWorkflow.requestSnapshot?.composition as
    | {
        includeBackgroundMusic?: boolean;
        backgroundMusicUrl?: string | null;
        backgroundMusicVolume?: number;
        subtitleConfig?: Partial<SubtitleConfig>;
      }
    | undefined) ?? {
    includeBackgroundMusic: false,
    backgroundMusicUrl: null,
    backgroundMusicVolume: normalizeCompositionBackgroundMusicVolume(null),
    subtitleConfig: getDefaultSubtitleConfig(),
  };

  emitWorkflowProgress({
    send: input.send,
    workflow: latestWorkflow,
    task: latestTask,
    message: "正在合成视频...",
    childPercent: 1,
    childStep: videoGenerationStepKeys.composition,
  });

  try {
    const compositionPayload = await runCompositionChildStep({
      baseUrl: input.baseUrl,
      taskId,
      workflowId,
      composition: {
        includeBackgroundMusic: compositionSnapshot.includeBackgroundMusic === true,
        backgroundMusicUrl: compositionSnapshot.backgroundMusicUrl ?? null,
        backgroundMusicVolume: normalizeCompositionBackgroundMusicVolume(compositionSnapshot.backgroundMusicVolume),
        subtitleConfig: hydrateSubtitleConfig(
          compositionSnapshot.subtitleConfig,
          getDefaultSubtitleConfig(),
        ),
      },
      cookieHeader: input.cookieHeader,
      authorizationHeader: input.authorizationHeader,
      onEvent: (event) => {
        touchVideoGenerationWorkflow(workflowId);
        const refreshedWorkflow = getVideoGenerationWorkflow(workflowId) ?? latestWorkflow;
        emitWorkflowProgress({
          send: input.send,
          workflow: refreshedWorkflow,
          task: getVideoTask(taskId) ?? latestTask,
          message: String(event.message ?? "正在合成视频..."),
          childPercent: Number(event.percent ?? 0),
          childStep: String(event.step ?? videoGenerationStepKeys.composition),
          extra: Object.fromEntries(
            Object.entries(event).filter(([key]) => !["step", "percent", "message"].includes(key)),
          ),
        });
      },
    });

    latestTask = compositionPayload.task ?? getVideoTask(taskId) ?? latestTask;
    if (compositionPayload.error || !compositionPayload.result) {
      latestWorkflow = failVideoGenerationWorkflow(
        workflowId,
        compositionPayload.error ?? "视频合成失败",
      ) ?? latestWorkflow;
      emitWorkflowProgress({
        send: input.send,
        workflow: latestWorkflow,
        task: latestTask,
        message: compositionPayload.error ?? "视频合成失败",
        childPercent: 100,
        childStep: videoGenerationStepKeys.composition,
      });
      return buildImmediateResult(latestWorkflow, latestTask, {
        error: compositionPayload.error ?? "视频合成失败",
      });
    }

    latestWorkflow =
      completeVideoGenerationWorkflowStep(workflowId, videoGenerationStepKeys.composition) ?? latestWorkflow;
    latestWorkflow = completeVideoGenerationWorkflow(workflowId) ?? latestWorkflow;
    emitWorkflowProgress({
      send: input.send,
      workflow: latestWorkflow,
      task: latestTask,
      message: "视频生成完成",
      childPercent: 100,
      childStep: videoGenerationStepKeys.composition,
      extra: {
        result: compositionPayload.result,
      },
    });
    return buildImmediateResult(latestWorkflow, latestTask, {
      result: compositionPayload.result,
    });
  } catch (error) {
    latestWorkflow = failVideoGenerationWorkflow(workflowId, error) ?? latestWorkflow;
    latestTask = getVideoTask(taskId) ?? latestTask;
    emitWorkflowProgress({
      send: input.send,
      workflow: latestWorkflow,
      task: latestTask,
      message: error instanceof Error ? error.message : "视频生成失败",
      childStep: videoGenerationStepKeys.composition,
    });
    return buildImmediateResult(latestWorkflow, latestTask, {
      error: error instanceof Error ? error.message : "视频生成失败",
    });
  } finally {
    releaseVideoGenerationWorkflowLock(taskId, workflowId);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const access = requireOwnedVideoTask(request, taskId);
  if ("response" in access) {
    return access.response;
  }

  const activeWorkflow = getActiveVideoGenerationWorkflow(taskId);
  const latestWorkflow = getLatestVideoGenerationWorkflow(taskId);

  return NextResponse.json({
    taskId,
    task: reconcileVideoTaskRuntimeStatus(taskId) ?? getVideoTask(taskId),
    workflow: activeWorkflow ?? latestWorkflow,
    hasActiveWorkflow: isVideoGenerationWorkflowRunning(activeWorkflow),
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

    const body = (await request.json().catch(() => ({}))) as VideoGenerationRunRequest;
    const action = body.action ?? "run";
    const requestId = body.requestId?.trim() || crypto.randomUUID();
    const task = getVideoTask(taskId) ?? access.task;

    if (!["run", "continue", "fail"].includes(action)) {
      return NextResponse.json({ error: "不支持的视频生成操作" }, { status: 400 });
    }

    if (action === "run") {
      const existingByRequestId = getVideoGenerationWorkflowByRequestId(taskId, requestId);
      if (existingByRequestId) {
        return NextResponse.json(buildImmediateResult(existingByRequestId, getVideoTask(taskId) ?? task, { reused: true }));
      }

      const activeWorkflow = getActiveVideoGenerationWorkflow(taskId);
      if (activeWorkflow) {
        return NextResponse.json(buildImmediateResult(activeWorkflow, getVideoTask(taskId) ?? task, { reused: true }));
      }

      const workflow = createVideoGenerationWorkflow({
        taskId,
        ownerUserId: task.ownerUserId,
        requestId,
        requestSnapshot: buildRequestSnapshot(body),
      });
      const lock = acquireVideoGenerationWorkflowLock({
        taskId,
        workflowId: workflow.workflowId,
      });
      if (!lock.ok) {
        return NextResponse.json(buildImmediateResult(lock.workflow, getVideoTask(taskId) ?? task, { reused: true }));
      }

      const startedWorkflow =
        startVideoGenerationWorkflowStep(
          startVideoGenerationWorkflow(workflow.workflowId)?.workflowId ?? workflow.workflowId,
          videoGenerationStepKeys.clipGeneration,
        ) ?? workflow;

      return NextResponse.json(buildImmediateResult(startedWorkflow, getVideoTask(taskId) ?? task));
    }

    const workflow = body.workflowId?.trim()
      ? getVideoGenerationWorkflow(body.workflowId.trim())
      : getActiveVideoGenerationWorkflow(taskId);

    if (!workflow || workflow.taskId !== taskId) {
      return NextResponse.json({ error: "未找到正在执行的视频生成任务" }, { status: 404 });
    }

    if (action === "fail") {
      const failedWorkflow = failVideoGenerationWorkflow(
        workflow.workflowId,
        body.error?.trim() || "视频片段生成失败",
      );
      releaseVideoGenerationWorkflowLock(taskId, workflow.workflowId);
      return NextResponse.json(
        buildImmediateResult(failedWorkflow, getVideoTask(taskId) ?? task, {
          error: body.error?.trim() || "视频片段生成失败",
        }),
      );
    }

    if (workflow.currentStepKey !== videoGenerationStepKeys.clipGeneration) {
      return createProgressStream(async () =>
        buildImmediateResult(getVideoGenerationWorkflow(workflow.workflowId) ?? workflow, getVideoTask(taskId) ?? task, {
          reused: true,
        }),
      );
    }

    const latestTask = getVideoTask(taskId) ?? task;
    const clipReadiness = await resolveClipGenerationReadiness(latestTask);
    if (!clipReadiness.allCompleted) {
      return NextResponse.json(
        {
          error:
            clipReadiness.completedCount <= 0
              ? "没有已完成的片段可供合成，请先完成视频片段生成。"
              : "视频片段还没有全部生成完成，请先处理失败或缺失片段后再继续合成。",
          clipReadiness,
        },
        { status: 409 },
      );
    }

    if (getVideoTaskStatusIndex(latestTask.status) < getVideoTaskStatusIndex("CLIPS_READY")) {
      return NextResponse.json({ error: "请先完成视频片段生成后再继续合成。", clipReadiness }, { status: 409 });
    }

    return createProgressStream((send) =>
      runCompositionWorkflow({
        workflow,
        task: latestTask,
        baseUrl: new URL(request.url).origin,
        cookieHeader: request.headers.get("cookie"),
        authorizationHeader: request.headers.get("authorization"),
        send,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频生成失败" },
      { status: 500 },
    );
  }
}
