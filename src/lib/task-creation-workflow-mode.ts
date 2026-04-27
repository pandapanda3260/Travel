import {
  DEFAULT_VIDEO_TASK_VIDEO_TYPE,
  usesCapturedMaterialFirstWorkflow,
  type VideoTaskRecord,
  type VideoTaskVideoType,
} from "./video-task-schema";

export const taskCreationWorkflowModeValues = ["ai_image_to_video", "real_photo_to_video"] as const;

export type TaskCreationWorkflowMode = (typeof taskCreationWorkflowModeValues)[number];

export type TaskCreationWorkflowModeConfig = {
  key: TaskCreationWorkflowMode;
  label: string;
  href: string;
  description: string;
  taskListTitle: string;
  taskListEyebrow: string;
  generatedVideoTypeLabel: string;
  previewTitle: string;
  previewEyebrow: string;
  detailTitle: string;
  inputStepTitle: string;
  productFieldLabel: string;
  productEmptyLabel: string;
  videoMaterialFieldLabel: string;
  videoMaterialEmptyLabel: string;
  userPromptFieldLabel: string;
  userPromptPlaceholder: string;
  optimizedPromptFieldLabel: string;
  sourceRequirementText: string;
};

export const taskCreationWorkflowModeConfigs: Record<TaskCreationWorkflowMode, TaskCreationWorkflowModeConfig> = {
  ai_image_to_video: {
    key: "ai_image_to_video",
    label: "AI 素材成片",
    href: "/studio/task-creation/ai-image-video",
    description: "从商品信息、线路信息和创作提示词出发，由 AI 生成参考图后再生成视频。",
    taskListTitle: "AI 素材成片列表",
    taskListEyebrow: "AI 素材成片",
    generatedVideoTypeLabel: "AI 素材成片",
    previewTitle: "AI 成片预览",
    previewEyebrow: "AI 视频结果",
    detailTitle: "AI 素材成片详情",
    inputStepTitle: "第一步：创作信息",
    productFieldLabel: "选择商品/线路信息",
    productEmptyLabel: "请选择商品/线路信息",
    videoMaterialFieldLabel: "选择参考视频素材（可选）",
    videoMaterialEmptyLabel: "不使用参考视频素材",
    userPromptFieldLabel: "输入你对 AI 视频的要求和想法",
    userPromptPlaceholder: "输入你希望额外强调的卖点、风格、场景或视频方向。",
    optimizedPromptFieldLabel: "系统优化后的 AI 创作提示词",
    sourceRequirementText: "请先提供商品/线路信息、创作提示词或参考视频素材中的至少一项内容。",
  },
  real_photo_to_video: {
    key: "real_photo_to_video",
    label: "实拍素材成片",
    href: "/studio/task-creation/real-photo-video",
    description: "从实拍图片或实拍视频素材出发，先绑定真实素材镜头，再生成视频。",
    taskListTitle: "实拍素材成片列表",
    taskListEyebrow: "实拍素材成片",
    generatedVideoTypeLabel: "实拍素材成片",
    previewTitle: "实拍成片预览",
    previewEyebrow: "实拍视频结果",
    detailTitle: "实拍素材成片详情",
    inputStepTitle: "第一步：素材与任务信息",
    productFieldLabel: "选择酒店/商品信息",
    productEmptyLabel: "请选择酒店/商品信息",
    videoMaterialFieldLabel: "选择实拍/参考视频素材（可选）",
    videoMaterialEmptyLabel: "不使用实拍/参考视频素材",
    userPromptFieldLabel: "输入实拍素材使用要求",
    userPromptPlaceholder: "输入希望强调的房型、设施、动线、真实场景或剪辑节奏。",
    optimizedPromptFieldLabel: "系统优化后的实拍剪辑提示词",
    sourceRequirementText: "请先提供酒店/商品信息、参考视频素材或酒店实拍图中的至少一项内容。",
  },
};

export function isTaskCreationWorkflowMode(value: string | null | undefined): value is TaskCreationWorkflowMode {
  return taskCreationWorkflowModeValues.includes(value as TaskCreationWorkflowMode);
}

export function getTaskCreationWorkflowModeConfig(mode: TaskCreationWorkflowMode) {
  return taskCreationWorkflowModeConfigs[mode];
}

export function getDefaultVideoTypeForTaskCreationWorkflowMode(
  mode: TaskCreationWorkflowMode | null | undefined,
): VideoTaskVideoType {
  return mode === "real_photo_to_video" ? "hotel_explore_roaming_voiceover" : DEFAULT_VIDEO_TASK_VIDEO_TYPE;
}

export function getTaskCreationWorkflowModeForVideoType(
  videoType?: VideoTaskVideoType | null,
): TaskCreationWorkflowMode {
  return usesCapturedMaterialFirstWorkflow(videoType) ? "real_photo_to_video" : "ai_image_to_video";
}

export function getTaskCreationWorkflowModeForTask(
  task: Pick<VideoTaskRecord, "parameters"> | null | undefined,
): TaskCreationWorkflowMode {
  return getTaskCreationWorkflowModeForVideoType(task?.parameters.video.videoType);
}

export function taskMatchesCreationWorkflowMode(
  task: Pick<VideoTaskRecord, "parameters">,
  mode: TaskCreationWorkflowMode | null | undefined,
) {
  return !mode || getTaskCreationWorkflowModeForTask(task) === mode;
}
