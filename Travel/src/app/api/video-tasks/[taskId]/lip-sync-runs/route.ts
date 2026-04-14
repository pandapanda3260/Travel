import { NextRequest, NextResponse } from "next/server";

import {
  buildTaskClipShotPayloads,
  getTaskClipNarrationResult,
  listTaskClipShots,
  parseTaskClipShots,
} from "../../../../../lib/task-clip-store";
import { getVideoJob } from "../../../../../lib/video-job-store";
import { ensurePendingVideoJobPolling } from "../../../../../lib/video-job-runner";
import { triggerShotLipSync } from "../../../../../lib/lip-sync-trigger";
import { getVideoTask } from "../../../../../lib/video-task-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type LipSyncRunRequest =
  | { action: "sync_all" }
  | { action: "sync_shot"; shotIndex: number };

export async function GET(_: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const task = getVideoTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
  }

  ensurePendingVideoJobPolling();

  return NextResponse.json({
    task,
    shots: await buildTaskClipShotPayloads(task, { readOnly: true }),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const task = getVideoTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<LipSyncRunRequest>;

    if (body.action === "sync_all") {
      const narrationResult = getTaskClipNarrationResult(taskId);
      const shotDefinitions = parseTaskClipShots(task, narrationResult);
      const clipRecords = listTaskClipShots(taskId);
      const results: Array<{ shotIndex: number; jobId: string | null; error: string | null }> = [];

      for (const shot of shotDefinitions) {
        const clipRecord = clipRecords.find((item) => item.shotIndex === shot.shotIndex);
        if (!clipRecord?.videoJobId) {
          results.push({ shotIndex: shot.shotIndex, jobId: null, error: "视频片段未生成" });
          continue;
        }

        const existingLipSyncJob = clipRecord.lipSyncJobId ? getVideoJob(clipRecord.lipSyncJobId) : null;
        if (existingLipSyncJob?.status === "COMPLETED") {
          results.push({ shotIndex: shot.shotIndex, jobId: existingLipSyncJob.jobId, error: null });
          continue;
        }

        try {
          const jobId = await triggerShotLipSync(taskId, shot.shotIndex);
          results.push({ shotIndex: shot.shotIndex, jobId, error: null });
        } catch (error) {
          results.push({
            shotIndex: shot.shotIndex,
            jobId: null,
            error: error instanceof Error ? error.message : "口型同步提交失败",
          });
        }
      }

      return NextResponse.json({
        task,
        shots: await buildTaskClipShotPayloads(task),
        results,
      });
    }

    if (body.action === "sync_shot") {
      const shotIndex = Number(body.shotIndex);
      if (!Number.isFinite(shotIndex) || shotIndex <= 0) {
        return NextResponse.json({ error: "镜头编号无效" }, { status: 400 });
      }

      const jobId = await triggerShotLipSync(taskId, shotIndex);
      if (!jobId) {
        return NextResponse.json({ error: `镜头 ${shotIndex} 无法提交口型同步，请检查视频和音频是否就绪` }, { status: 400 });
      }

      return NextResponse.json({
        task,
        shots: await buildTaskClipShotPayloads(task),
        result: { shotIndex, jobId },
      });
    }

    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "口型同步失败" },
      { status: 500 },
    );
  }
}
