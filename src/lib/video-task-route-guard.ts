import type { NextRequest } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "./auth-session";
import { getVideoTask } from "./video-task-store";

export function requireOwnedVideoTask(
  request: NextRequest,
  taskId: string,
  options?: {
    missingMessage?: string;
    forbiddenMessage?: string;
  },
) {
  const session = requireUserApiSession(request);
  if (!session) {
    return {
      response: userApiUnauthorizedResponse(),
    } as const;
  }

  const task = getVideoTask(taskId);
  if (!task) {
    return {
      response: Response.json({ error: options?.missingMessage ?? "视频任务不存在" }, { status: 404 }),
    } as const;
  }

  if (task.ownerUserId && task.ownerUserId !== session.userId) {
    return {
      response: Response.json(
        {
          error: options?.forbiddenMessage ?? "无权访问该视频任务",
          code: "VIDEO_TASK_FORBIDDEN",
        },
        { status: 403 },
      ),
    } as const;
  }

  return {
    session,
    task,
  } as const;
}
