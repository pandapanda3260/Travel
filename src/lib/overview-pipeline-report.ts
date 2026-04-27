import { getAsrRuntime } from "./asr-provider-config";
import { getSpeechSynthesisRuntime } from "./audio-provider-config";
import { getFfmpegBinaryPathOrNull } from "./ffmpeg-runtime";
import { getImageGenerationRuntime } from "./image-provider-config";
import { getProductArchiveVisionProviderMeta } from "./product-archive-vision";
import { getTaskGenerationRuntime } from "./task-generation-runtime";
import { getLipSyncProviderRuntime, getProviderRuntime } from "./video-provider-config";
import { getGenerationRuntime, getVisionRuntime } from "./vision-provider-config";
import { getVoiceManagementRuntime } from "./voice-management-config";

type OverviewStatusTone = "success" | "warning" | "danger";

export type OverviewPipelineStageGroup =
  | "输入解析"
  | "导演规划"
  | "图片生成"
  | "音频字幕"
  | "视频生成"
  | "输出合成"
  | "音色资产";

export const overviewPipelineStageGroups: OverviewPipelineStageGroup[] = [
  "输入解析",
  "导演规划",
  "图片生成",
  "音频字幕",
  "视频生成",
  "输出合成",
  "音色资产",
];

export type OverviewPipelineStage = {
  id: string;
  group: OverviewPipelineStageGroup;
  title: string;
  trigger: string;
  type: "调用大模型 API" | "本地服务";
  modelOrService: string;
  role: string;
  status: string;
  statusTone: OverviewStatusTone;
};

function getFfmpegStatus() {
  try {
    return getFfmpegBinaryPathOrNull() ? "可正常调用" : "缺少 FFmpeg";
  } catch {
    return "缺少 FFmpeg";
  }
}

function joinApiUrl(apiBase: string, endpoint: string) {
  const normalizedBase = apiBase.replace(/\/$/, "");
  if (!endpoint) {
    return normalizedBase;
  }
  if (endpoint.startsWith("/")) {
    return `${normalizedBase}${endpoint}`;
  }
  return `${normalizedBase}/${endpoint}`;
}

function buildRuntimeDescriptor(input: {
  providerLabel: string;
  endpoint: string;
  modelId?: string | null;
  suffix?: string | null;
}) {
  const segments = [input.providerLabel];
  if (input.modelId && !input.providerLabel.includes(input.modelId)) {
    segments.push(input.modelId);
  }
  if (input.suffix?.trim()) {
    segments.push(input.suffix.trim());
  }
  segments.push(input.endpoint);
  return segments.join(" · ");
}

function getVideoGenerationEndpoint() {
  const runtime = getProviderRuntime();
  if (runtime.provider === "seedance") {
    return joinApiUrl(runtime.apiBase, "/contents/generations/tasks");
  }
  return joinApiUrl(runtime.apiBase, "/v1/videos/image2video");
}

export function buildOverviewPipelineModelMap(): OverviewPipelineStage[] {
  const productVisionRuntime = getProductArchiveVisionProviderMeta();
  const asrRuntime = getAsrRuntime();
  const visionRuntime = getVisionRuntime();
  const generationRuntime = getGenerationRuntime();
  const taskGenerationRuntime = getTaskGenerationRuntime();
  const imageRuntime = getImageGenerationRuntime();
  const audioRuntime = getSpeechSynthesisRuntime();
  const activeVideoRuntime = getProviderRuntime();
  const klingVideoRuntime = getLipSyncProviderRuntime();
  const voiceRuntime = getVoiceManagementRuntime();
  const ffmpegStatus = getFfmpegStatus();
  const ffmpegStatusTone: OverviewStatusTone = ffmpegStatus === "可正常调用" ? "success" : "danger";

  return [
    {
      id: "product-vision",
      group: "输入解析",
      title: "商品图 OCR / 卖点抽取",
      trigger: "上传商品档案图片时",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: productVisionRuntime.providerLabel,
        modelId: productVisionRuntime.modelId,
        endpoint: joinApiUrl(productVisionRuntime.apiBase, "/api/v3/chat/completions"),
      }),
      role: "抽取商品图文字、标题、人数标签和卖点，沉淀为结构化商品档案。",
      status: productVisionRuntime.liveEnabled ? "可正常调用" : "未启用，商品图上传后不会自动解析结构化信息",
      statusTone: productVisionRuntime.liveEnabled ? "success" : "danger",
    },
    {
      id: "video-asr",
      group: "输入解析",
      title: "参考视频语音转写",
      trigger: "参考视频走 auto_all / audio_only 处理时",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: asrRuntime.providerLabel,
        modelId: asrRuntime.resourceId,
        endpoint: joinApiUrl(asrRuntime.apiBase, "/api/v3/auc/bigmodel/recognize/flash"),
      }),
      role: "把参考视频音轨转成可搜索文稿，供脚本反推和模板提示词生成使用。",
      status: asrRuntime.liveEnabled ? "可正常调用" : "未启用时参考视频只能依赖画面分析",
      statusTone: asrRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "video-analysis",
      group: "输入解析",
      title: "参考视频逐帧视觉分析",
      trigger: "参考视频走 auto_all 处理时",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: visionRuntime.providerLabel,
        endpoint: joinApiUrl(visionRuntime.apiBase, visionRuntime.chatEndpoint),
      }),
      role: "对采样帧做镜头拆解、节奏分析和卖点归纳，补足纯转写无法提供的画面信息。",
      status: visionRuntime.liveEnabled ? "可正常调用" : "未启用时参考视频不会做逐帧画面分析",
      statusTone: visionRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "video-template-generation",
      group: "输入解析",
      title: "参考视频脚本反推 / 模板提示词生成",
      trigger: "参考视频分析完成后",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: generationRuntime.providerLabel,
        endpoint: joinApiUrl(generationRuntime.apiBase, generationRuntime.chatEndpoint),
      }),
      role: "根据转写与画面分析生成 content script、reverse prompt 和视频模板提示词。",
      status: generationRuntime.liveEnabled ? "可正常调用" : "未启用时退回 transcript / analysis 文本拼装",
      statusTone: generationRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "director-llm",
      group: "导演规划",
      title: "导演镜头规划 / Prompt 生成 / 旁白修复",
      trigger: "创建任务、重建镜头、修复旁白时",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: taskGenerationRuntime.providerLabel,
        endpoint: joinApiUrl(taskGenerationRuntime.apiBase, taskGenerationRuntime.chatEndpoint),
      }),
      role: "生成 shot plan、文生图 prompt、图生视频 prompt、旁白草稿，并在超时长时改写旁白。",
      status: taskGenerationRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地兜底镜头规划与模板",
      statusTone: taskGenerationRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "image-moderation-rewrite",
      group: "导演规划",
      title: "图片安全降敏改写",
      trigger: "Seedream 返回安全拦截时按需触发",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: taskGenerationRuntime.providerLabel,
        endpoint: joinApiUrl(taskGenerationRuntime.apiBase, taskGenerationRuntime.chatEndpoint),
      }),
      role: "把敏感生图提示词自动改写成更易通过审核的版本，然后重试图片生成。",
      status: taskGenerationRuntime.liveEnabled ? "按需可调用" : "未启用时仅保留规则式降敏改写",
      statusTone: taskGenerationRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "image-generation",
      group: "图片生成",
      title: "文生图候选图生成",
      trigger: "视觉图片步骤执行时",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: imageRuntime.providerLabel,
        modelId: imageRuntime.modelId,
        endpoint: joinApiUrl(imageRuntime.apiBase, "/api/v3/images/generations"),
      }),
      role: "为每个镜头生成多张候选参考图，供后续 AI 自检、推荐排序和图生视频使用。",
      status: imageRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地 Mock 图片",
      statusTone: imageRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "image-self-check",
      group: "图片生成",
      title: "候选图 AI 自检",
      trigger: "文生图返回候选图后",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: visionRuntime.providerLabel,
        endpoint: joinApiUrl(visionRuntime.apiBase, visionRuntime.chatEndpoint),
      }),
      role: "按镜头 prompt 审核人体解剖、人物数量、场景元素和违禁结构，输出 passed / warning / failed。",
      status: visionRuntime.liveEnabled ? "可正常调用" : "未启用，仅保留本地评分和人工确认",
      statusTone: visionRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "tts",
      group: "音频字幕",
      title: "TTS 配音生成",
      trigger: "字幕音频步骤执行时",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: audioRuntime.providerLabel,
        modelId: audioRuntime.resourceId,
        suffix: `默认音色 ${audioRuntime.defaultVoiceId}`,
        endpoint: joinApiUrl(audioRuntime.apiBase, "/api/v3/tts/unidirectional/sse"),
      }),
      role: "把分镜旁白合成为音频，并返回逐词时间轴供字幕与片段对齐。",
      status: audioRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地 Mock 静音配音",
      statusTone: audioRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "subtitle-export",
      group: "音频字幕",
      title: "字幕时间轴 / SRT 导出",
      trigger: "旁白结果落盘和最终合成前",
      type: "本地服务",
      modelOrService: "本地字幕导出器 · subtitle-export / narration-result-store",
      role: "根据词级时间轴和镜头切分写出 SRT，供预览、下载和最终烧录。",
      status: "可正常调用",
      statusTone: "success",
    },
    {
      id: "clip-generation",
      group: "视频生成",
      title: "图生视频片段生成",
      trigger: "片段生成步骤执行时",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: activeVideoRuntime.providerLabel,
        modelId: activeVideoRuntime.modelId,
        endpoint: getVideoGenerationEndpoint(),
      }),
      role: "基于已选参考图和镜头 prompt 生成逐镜头片段；默认走 Seedance，也可通过配置切换到 Kling。",
      status: activeVideoRuntime.liveEnabled
        ? `可正常调用（当前 Provider：${activeVideoRuntime.provider}）`
        : "未启用，当前走本地 Mock 静态视频占位",
      statusTone: activeVideoRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "lip-sync",
      group: "视频生成",
      title: "口型同步",
      trigger: "主角镜头配音完成后按需触发",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: klingVideoRuntime.providerLabel,
        modelId: klingVideoRuntime.modelId,
        endpoint: joinApiUrl(klingVideoRuntime.apiBase, "/v1/videos/lip-sync"),
      }),
      role: "把已生成片段和本地音频重新提交为 audio2video 任务，产出带口型的视频变体。",
      status: klingVideoRuntime.liveEnabled
        ? "可正常调用，仅自拍口播 / 出镜口播类型会触发"
        : "未启用，当前走本地 Mock 口型同步占位",
      statusTone: klingVideoRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "composition",
      group: "输出合成",
      title: "片段拼接 / 混音 / 字幕烧录",
      trigger: "最终合成步骤执行时",
      type: "本地服务",
      modelOrService: "FFmpeg 本地服务 · video-composition-runner",
      role: "完成片段规范化、时间线拼接、旁白混音、背景音乐叠加和字幕烧录，输出最终成片。",
      status: ffmpegStatus,
      statusTone: ffmpegStatusTone,
    },
    {
      id: "voice-library",
      group: "音色资产",
      title: "在线音色目录拉取",
      trigger: "音色管理页 / 导演页加载音色选项时",
      type: "调用大模型 API",
      modelOrService: `豆包语音 OpenAPI · https://${voiceRuntime.openApiHost}/?Action=GetSpeechSynthesisSpeakerList`,
      role: "拉取在线音色目录和推荐音色，用于音色选择、搜索与收藏。",
      status: voiceRuntime.timbreApiEnabled ? "可正常调用" : "未配置 OpenAPI AK / SK",
      statusTone: voiceRuntime.timbreApiEnabled ? "success" : "danger",
    },
    {
      id: "voice-clone",
      group: "音色资产",
      title: "声音复刻训练",
      trigger: "音色管理页创建克隆音色时",
      type: "调用大模型 API",
      modelOrService: `豆包语音克隆 · ${voiceRuntime.cloneResourceId} · https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload`,
      role: "上传训练样本、查询复刻状态并生成可供 TTS 使用的专属音色。",
      status: voiceRuntime.cloneEnabled ? "可正常调用" : "未配置 AppId / AccessToken",
      statusTone: voiceRuntime.cloneEnabled ? "success" : "danger",
    },
  ];
}
