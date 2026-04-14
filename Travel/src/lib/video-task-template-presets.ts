/**
 * 与 `VideoMaterialRecord`（素材库）字段含义对齐：
 * - `materialId`：对应 `VideoMaterialRecord.materialId`
 * - `name`：对应 `VideoMaterialRecord.name`，仅用于下拉展示
 * - `videoTemplatePrompt`：对应 `VideoMaterialRecord.videoTemplatePrompt`，唯一进入镜头规划的正文
 */
export type VideoTaskReferenceMaterialPreset = {
  materialId: string;
  name: string;
  videoTemplatePrompt: string;
};

export const videoTaskReferenceMaterialPresets: VideoTaskReferenceMaterialPreset[] = [
  {
    materialId: "travel_pacing_hook",
    name: "参考-旅行短视频开场与节奏",
    videoTemplatePrompt:
      "视频结构：0–2 秒强钩子（地标/人物表情/悬念动作），中段用 2–3 次景别切换（远景交代环境→中景体验→特写细节），结尾 1 秒收束画面或品牌记忆点。节奏偏快，转场干净，避免拖沓长镜头。",
  },
  {
    materialId: "hotel_room_walkthrough",
    name: "参考-酒店客房空间动线",
    videoTemplatePrompt:
      "以客房入口为起点，沿动线展示玄关→起居→窗景→卫浴亮点；运镜平稳、透视自然，强调空间通透与灯光层次，避免夸张变形与过度广角畸变。",
  },
  {
    materialId: "scenery_montage_beats",
    name: "参考-风光卡点空镜混剪",
    videoTemplatePrompt:
      "以空镜与延时为主，人物可做点缀；镜头短、信息密度高，配合音乐假想节拍做切点；色调统一、天空与水面高光不过曝。",
  },
];

export function getVideoTaskReferenceMaterialPresetById(id: string | null | undefined): VideoTaskReferenceMaterialPreset | null {
  if (!id?.trim()) {
    return null;
  }
  return videoTaskReferenceMaterialPresets.find((item) => item.materialId === id.trim()) ?? null;
}

/** @deprecated 使用 {@link getVideoTaskReferenceMaterialPresetById} */
export const getVideoTaskTemplatePresetById = getVideoTaskReferenceMaterialPresetById;

/** @deprecated 使用 {@link videoTaskReferenceMaterialPresets} */
export const videoTaskTemplatePresets = videoTaskReferenceMaterialPresets;
