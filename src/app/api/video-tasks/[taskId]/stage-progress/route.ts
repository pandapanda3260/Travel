import { NextRequest, NextResponse } from "next/server";

import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { listTaskStageProgress } from "../../../../../lib/task-stage-progress-store";
import { listTaskWorkflowEvents } from "../../../../../lib/task-workflow-event-store";
import type { TaskStageProgressPayload } from "../../../../../lib/task-stage-progress";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const access = requireOwnedVideoTask(request, taskId);
  if ("response" in access) {
    return access.response;
  }

  const stages = Object.fromEntries(
    listTaskStageProgress(taskId).map((record) => [record.stageKey, record]),
  ) as TaskStageProgressPayload["stages"];

  return NextResponse.json({
    taskId,
    stages,
    events: listTaskWorkflowEvents(taskId, { limit: 80 }),
  } satisfies TaskStageProgressPayload);
}
