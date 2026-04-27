import { getTaskDirectorPlan } from "./video-task-director";

/**
 * 导演页第三步“视觉图片生成”按镜头级产出，一镜对应一组候选图和一张最终定稿图。
 * 这里必须基于 storyShots 统计，不能误用 renderSegments（片段数）。
 */
export function getExpectedVisualReferenceShotCount(task: Parameters<typeof getTaskDirectorPlan>[0]) {
  return getTaskDirectorPlan(task).storyShots.length;
}

export function getExpectedClipSegmentCount(task: Parameters<typeof getTaskDirectorPlan>[0]) {
  return getTaskDirectorPlan(task).renderSegments.length;
}
