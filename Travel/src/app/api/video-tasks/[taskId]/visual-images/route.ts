import { NextRequest, NextResponse } from "next/server";

import { generateSeedreamImages } from "../../../../../lib/image-provider";
import { getImageGenerationRuntime } from "../../../../../lib/image-provider-config";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { getVideoTaskStatusIndex } from "../../../../../lib/video-task-schema";
import {
  clearTaskVisualImageSelection,
  generateTaskVisualImageShot,
  listTaskVisualImageShots,
  parseTaskVisualImageShots,
  selectTaskVisualImageCandidate,
} from "../../../../../lib/task-visual-image-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type VisualImagesRequest =
  | { action: "generate_all" }
  | { action: "generate_shot"; shotIndex: number }
  | { action: "select_candidate"; shotIndex: number; candidateId: string }
  | { action: "clear_selection"; shotIndex: number };

function buildShotPayload(taskId: string) {
  const savedShots = listTaskVisualImageShots(taskId);
  const savedMap = new Map(savedShots.map((shot) => [shot.shotIndex, shot]));
  return (task: NonNullable<ReturnType<typeof getVideoTask>>) =>
    parseTaskVisualImageShots(task).map((shot) => {
      const saved = savedMap.get(shot.shotIndex);
      const candidates = saved?.candidates ?? [];
      const selectedCandidate =
        candidates.find((candidate) => candidate.candidateId === saved?.selectedCandidateId) ?? null;
      return {
        segmentId: shot.segmentId,
        segmentIndex: shot.segmentIndex,
        shotIndex: shot.shotIndex,
        shotTitle: shot.shotTitle,
        prompt: shot.prompt,
        size: shot.size,
        guidanceScale: shot.guidanceScale,
        watermark: shot.watermark,
        generatedAt: saved?.generatedAt ?? null,
        updatedAt: saved?.updatedAt ?? null,
        recommendedCandidateId: saved?.recommendedCandidateId ?? null,
        selectedCandidateId: saved?.selectedCandidateId ?? null,
        selectionMode: saved?.selectionMode ?? null,
        selectedAt: saved?.selectedAt ?? null,
        selectedCandidate,
        candidates,
      };
    });
}

function patchTaskStatusBySelections(taskId: string) {
  const task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  const shots = listTaskVisualImageShots(taskId);
  const parsedShots = parseTaskVisualImageShots(task);
  const allSelected =
    parsedShots.length > 0 &&
    parsedShots.every((shot) =>
      shots.some((item) => item.shotIndex === shot.shotIndex && Boolean(item.selectedCandidateId)),
    );

  if (allSelected && getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("IMAGES_READY")) {
    return patchVideoTask(taskId, { status: "IMAGES_READY" });
  }

  if (!allSelected && getVideoTaskStatusIndex(task.status) >= getVideoTaskStatusIndex("IMAGES_READY")) {
    return patchVideoTask(taskId, { status: "SUBTITLE_AUDIO_READY" });
  }

  return task;
}

export async function GET(_: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const task = getVideoTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
  }

  const runtime = getImageGenerationRuntime();
  return NextResponse.json({
    task,
    shots: buildShotPayload(taskId)(task),
    runtime: {
      providerLabel: runtime.providerLabel,
      modelId: runtime.modelId,
      liveEnabled: runtime.liveEnabled,
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const task = getVideoTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<VisualImagesRequest>;
    const shotDrafts = parseTaskVisualImageShots(task);

    if (body.action === "generate_all") {
      const existingShots = listTaskVisualImageShots(taskId);
      const existingSet = new Set(
        existingShots.filter((shot) => shot.candidates.length > 0).map((shot) => shot.segmentId),
      );
      const targets = shotDrafts.filter((shot) => !existingSet.has(shot.segmentId));

      for (const shot of targets) {
        let assets;
        try {
          assets = await generateSeedreamImages({
            prompt: shot.prompt,
            size: shot.size,
            guidanceScale: shot.guidanceScale,
            watermark: shot.watermark,
            seed: task.parameters.image.seed,
            outputCount: 6,
          });
        } catch (error) {
          throw new Error(
            `片段 ${shot.shotIndex} 图片生成失败：${error instanceof Error ? error.message : "图片模型返回异常"}`,
          );
        }
        await generateTaskVisualImageShot({
          task,
          segmentId: shot.segmentId,
          shotIndex: shot.shotIndex,
          prompt: shot.prompt,
          assets,
        });
      }

      const nextTask = patchTaskStatusBySelections(taskId);
      const runtime = getImageGenerationRuntime();
      return NextResponse.json({
        task: nextTask,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    if (body.action === "generate_shot") {
      const shotIndex = Number(body.shotIndex);
      const shot = shotDrafts.find((item) => item.shotIndex === shotIndex);
      if (!shot) {
        return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
      }

      let assets;
      try {
        assets = await generateSeedreamImages({
          prompt: shot.prompt,
          size: shot.size,
          guidanceScale: shot.guidanceScale,
          watermark: shot.watermark,
          seed: task.parameters.image.seed,
          outputCount: 6,
        });
      } catch (error) {
        return NextResponse.json(
          { error: `片段 ${shotIndex} 图片生成失败：${error instanceof Error ? error.message : "图片模型返回异常"}` },
          { status: 500 },
        );
      }
      await generateTaskVisualImageShot({
        task,
        segmentId: shot.segmentId,
        shotIndex,
        prompt: shot.prompt,
        assets,
      });
      const nextTask = patchTaskStatusBySelections(taskId);
      const runtime = getImageGenerationRuntime();
      return NextResponse.json({
        task: nextTask,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    if (body.action === "select_candidate") {
      const shotIndex = Number(body.shotIndex);
      const candidateId = String(body.candidateId ?? "").trim();
      if (!candidateId) {
        return NextResponse.json({ error: "请选择图片" }, { status: 400 });
      }

      const selected = selectTaskVisualImageCandidate(taskId, shotIndex, candidateId);
      if (!selected) {
        return NextResponse.json({ error: "候选图片不存在" }, { status: 404 });
      }

      const nextTask = patchTaskStatusBySelections(taskId);
      const runtime = getImageGenerationRuntime();
      return NextResponse.json({
        task: nextTask,
        shot: selected,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    if (body.action === "clear_selection") {
      const shotIndex = Number(body.shotIndex);
      const cleared = clearTaskVisualImageSelection(taskId, shotIndex);
      if (!cleared) {
        return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
      }

      const nextTask = patchTaskStatusBySelections(taskId);
      const runtime = getImageGenerationRuntime();
      return NextResponse.json({
        task: nextTask,
        shot: cleared,
        shots: buildShotPayload(taskId)(getVideoTask(taskId) ?? task),
        runtime: {
          providerLabel: runtime.providerLabel,
          modelId: runtime.modelId,
          liveEnabled: runtime.liveEnabled,
        },
      });
    }

    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "视觉图片生成失败" }, { status: 500 });
  }
}
