import { TaskCreationWorkflowPage } from "../_components/task-creation-workflow-page";

export const dynamic = "force-dynamic";

export default function AiImageVideoTaskCreationPage() {
  return <TaskCreationWorkflowPage workflowMode="ai_image_to_video" />;
}
