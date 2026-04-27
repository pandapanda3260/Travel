import { notFound } from "next/navigation";

import { requireUserPageSession } from "../../../../../lib/auth-session";
import { getVideoTask } from "../../../../../lib/video-task-store";
import { getVideoTaskTypeProfile } from "../../../../../lib/video-task-schema";
import {
  getTaskCreationWorkflowModeConfig,
  getTaskCreationWorkflowModeForTask,
} from "../../../../../lib/task-creation-workflow-mode";
import { buildShotPlanEditorState } from "../../../../../lib/video-task-plan-edit";
import { ShotPlanEditor } from "./shot-plan-editor";

type PageProps = {
  params: Promise<{
    taskId: string;
  }>;
  searchParams?: Promise<{
    shot?: string | string[];
  }>;
};

export default async function ShotPlanPromptTablePage({ params, searchParams }: PageProps) {
  const session = await requireUserPageSession();
  const { taskId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const task = getVideoTask(taskId);

  if (!task || (task.ownerUserId && task.ownerUserId !== session.userId)) {
    notFound();
  }

  const rawTargetShot = Array.isArray(resolvedSearchParams?.shot)
    ? resolvedSearchParams?.shot[0]
    : resolvedSearchParams?.shot;
  const targetShotIndex = Number(rawTargetShot);
  const highlightedShotIndex =
    Number.isFinite(targetShotIndex) && targetShotIndex > 0 ? Math.round(targetShotIndex) : null;
  const videoTypeProfile = getVideoTaskTypeProfile(task.parameters.video.videoType);
  const workflowConfig = getTaskCreationWorkflowModeConfig(getTaskCreationWorkflowModeForTask(task));
  const returnHref = `${workflowConfig.href}?taskId=${encodeURIComponent(task.taskId)}`;

  return (
    <ShotPlanEditor
      taskId={task.taskId}
      title={task.title}
      videoTypeLabel={videoTypeProfile.label}
      updatedAt={task.updatedAt}
      returnHref={returnHref}
      highlightedShotIndex={highlightedShotIndex}
      initialEditorState={buildShotPlanEditorState(task)}
    />
  );
}
