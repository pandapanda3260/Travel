import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { getActiveKeyMaterialWorkflow } from "../../../../../lib/key-material-task-store";
import { getGeneratedVideoRecordForTask } from "../../../../../lib/task-creation-index-data";
import { remapTaskVisualImageShots } from "../../../../../lib/task-visual-image-store";
import { clearTaskClipAndCompositionOutputs } from "../../../../../lib/video-task-output-reset";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import {
  applyShotPlanEditorSave,
  buildShotPlanEditorState,
  type AppliedShotPlanEditorSave,
  type ShotPlanEditorSavePayload,
} from "../../../../../lib/video-task-plan-edit";
import { getActiveVideoGenerationWorkflow } from "../../../../../lib/video-generation-workflow-store";
import { capVideoTaskStatus, videoTaskStatusFlow } from "../../../../../lib/video-task-schema";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type UpdateShotPlanRequest = ShotPlanEditorSavePayload & {
  baseUpdatedAt?: string;
};

function buildVisualImageShotOrderMappings(body: UpdateShotPlanRequest, applied: AppliedShotPlanEditorSave) {
  const shotPlanByIndex = new Map(applied.shotPlan.shots.map((shot) => [shot.shotIndex, shot]));
  const mappings =
    body.segments?.flatMap((segment) =>
      (segment.shots ?? [])
        .map((shot) => {
          const shotIndex = Number(shot.shotIndex);
          const sourceShotIndex = Number(shot.sourceShotIndex ?? shot.shotIndex);
          if (
            !Number.isFinite(shotIndex) ||
            shotIndex <= 0 ||
            !Number.isFinite(sourceShotIndex) ||
            sourceShotIndex <= 0
          ) {
            return null;
          }
          const planShot = shotPlanByIndex.get(shotIndex);
          return {
            sourceShotIndex,
            shotIndex,
            segmentId: planShot?.segmentId ?? segment.segmentId ?? `segment-${segment.segmentIndex}`,
            segmentIndex: planShot?.segmentIndex ?? segment.segmentIndex,
            prompt: planShot?.img2imgPrompt ?? planShot?.sceneDescription ?? null,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ) ?? [];

  return {
    mappings,
    hasReorderedShots: mappings.some((mapping) => mapping.sourceShotIndex !== mapping.shotIndex),
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { taskId } = await context.params;
    const body = (await request.json().catch(() => null)) as UpdateShotPlanRequest | null;
    if (!body) {
      return NextResponse.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
    }

    const existingTask = getVideoTask(taskId);
    if (!existingTask) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }
    if (existingTask.ownerUserId && existingTask.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权修改该视频任务", code: "VIDEO_TASK_FORBIDDEN" }, { status: 403 });
    }
    if (body.baseUpdatedAt && body.baseUpdatedAt !== existingTask.updatedAt) {
      return NextResponse.json(
        {
          error: "任务已在其他页面更新，请刷新后再继续编辑",
          code: "VIDEO_TASK_EDIT_CONFLICT",
          task: existingTask,
          editorState: buildShotPlanEditorState(existingTask),
        },
        { status: 409 },
      );
    }
    if (getActiveKeyMaterialWorkflow(taskId) || getActiveVideoGenerationWorkflow(taskId)) {
      return NextResponse.json({ error: "当前任务正在生成中，暂时不能修改镜头计划，请稍后重试" }, { status: 409 });
    }

    const applied = applyShotPlanEditorSave(existingTask, body);
    const visualImageShotOrder = buildVisualImageShotOrderMappings(body, applied);
    if (visualImageShotOrder.hasReorderedShots) {
      remapTaskVisualImageShots(taskId, visualImageShotOrder.mappings);
      clearTaskClipAndCompositionOutputs(taskId);
    }
    const task = patchVideoTask(taskId, {
      shotPlan: applied.shotPlan,
      draftBundle: applied.draftBundle,
      directorPlan: applied.directorPlan,
      ...(visualImageShotOrder.hasReorderedShots
        ? {
            status: capVideoTaskStatus(existingTask.status, "IMAGES_READY"),
            stageTimestamps: {
              CLIPS_READY: undefined,
              COMPOSITION_READY: undefined,
            },
          }
        : {}),
    });

    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    return NextResponse.json({
      task,
      editorState: buildShotPlanEditorState(task),
      generatedVideo: await getGeneratedVideoRecordForTask(task),
      statusFlow: videoTaskStatusFlow,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存镜头计划失败" }, { status: 500 });
  }
}
