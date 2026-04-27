import { getAsrRuntime } from "./asr-provider-config";
import { getSpeechSynthesisRuntime } from "./audio-provider-config";
import { getFfmpegBinaryPathOrNull } from "./ffmpeg-runtime";
import { getImageGenerationRuntime } from "./image-provider-config";
import { listNarrationResults } from "./narration-result-store";
import { getProductArchiveVisionProviderMeta } from "./product-archive-vision";
import { listProductArchives } from "./product-archive-store";
import { listTaskClipShots } from "./task-clip-store";
import { listTaskVisualImageShots } from "./task-visual-image-store";
import { getTaskGenerationRuntime } from "./task-generation-runtime";
import { listStoredTimbres } from "./timbre-library-store";
import { listVideoCompositions } from "./video-composition-store";
import { listVideoMaterials } from "./video-material-store";
import { listVideoTasks } from "./video-task-store";
import { getLipSyncProviderRuntime, getProviderRuntime } from "./video-provider-config";
import { getGenerationRuntime, getVisionRuntime } from "./vision-provider-config";
import { getVoiceManagementRuntime } from "./voice-management-config";
import { listClonedVoices } from "./voice-management-store";

type OverviewStatusTone = "success" | "warning" | "danger";

export type OverviewServiceReportEntry = {
  id: string;
  title: string;
  type: "调用大模型 API" | "本地服务";
  modelOrService: string;
  role: string;
  thisWeekCount: string;
  lastWeekCount: string;
  yesterdayCount: string;
  volume: string;
  status: string;
  statusTone: OverviewStatusTone;
};

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

type TimedMetric = {
  timestamp: string | null | undefined;
  callCount?: number;
  volumeCount?: number;
};

function getRangeBoundaries(now = new Date()) {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const currentWeekStart = new Date(todayStart);
  const day = currentWeekStart.getDay();
  const normalizedOffset = day === 0 ? 6 : day - 1;
  currentWeekStart.setDate(currentWeekStart.getDate() - normalizedOffset);

  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);

  return {
    yesterdayStart,
    todayStart,
    tomorrowStart,
    currentWeekStart,
    previousWeekStart,
  };
}

function sumMetricsInRange(metrics: TimedMetric[], start: Date, end: Date) {
  return metrics.reduce(
    (result, metric) => {
      if (!metric.timestamp) {
        return result;
      }

      const time = new Date(metric.timestamp).getTime();
      if (Number.isNaN(time) || time < start.getTime() || time >= end.getTime()) {
        return result;
      }

      return {
        callCount: result.callCount + (metric.callCount ?? 1),
        volumeCount: result.volumeCount + (metric.volumeCount ?? 0),
      };
    },
    { callCount: 0, volumeCount: 0 },
  );
}

function formatCount(value: number, unit: string) {
  return `${value} ${unit}`;
}

function formatVolume(value: number, unit: string) {
  return value > 0 ? `${value} ${unit}` : `0 ${unit}`;
}

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

function pickLatestTimestamp(timestamps: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestTime = -Infinity;

  for (const timestamp of timestamps) {
    if (!timestamp) {
      continue;
    }

    const time = new Date(timestamp).getTime();
    if (Number.isNaN(time) || time <= latestTime) {
      continue;
    }

    latestTime = time;
    latest = timestamp;
  }

  return latest;
}

function buildCounts(metrics: TimedMetric[], unit: string) {
  const ranges = getRangeBoundaries();
  const thisWeek = sumMetricsInRange(metrics, ranges.currentWeekStart, ranges.tomorrowStart).callCount;
  const lastWeek = sumMetricsInRange(metrics, ranges.previousWeekStart, ranges.currentWeekStart).callCount;
  const yesterday = sumMetricsInRange(metrics, ranges.yesterdayStart, ranges.todayStart).callCount;
  const totalVolume = metrics.reduce((sum, metric) => sum + (metric.volumeCount ?? 0), 0);

  return {
    thisWeekCount: formatCount(thisWeek, unit),
    lastWeekCount: formatCount(lastWeek, unit),
    yesterdayCount: formatCount(yesterday, unit),
    totalVolume,
  };
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
      statusTone:
        klingVideoRuntime.liveEnabled ? "success" : "warning",
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

export function buildOverviewServiceReport(): OverviewServiceReportEntry[] {
  const productVisionRuntime = getProductArchiveVisionProviderMeta();
  const asrRuntime = getAsrRuntime();
  const taskGenerationRuntime = getTaskGenerationRuntime();
  const generationRuntime = getGenerationRuntime();
  const visionRuntime = getVisionRuntime();
  const imageRuntime = getImageGenerationRuntime();
  const audioRuntime = getSpeechSynthesisRuntime();
  const activeVideoRuntime = getProviderRuntime();
  const klingVideoRuntime = getLipSyncProviderRuntime();
  const voiceRuntime = getVoiceManagementRuntime();
  const tasks = listVideoTasks();
  const productArchives = listProductArchives();
  const videoMaterials = listVideoMaterials();
  const visualShots = listTaskVisualImageShots().filter((item) => item.generatedAt);
  const narrations = listNarrationResults();
  const clipShots = listTaskClipShots().filter((item) => item.generatedAt);
  const compositions = listVideoCompositions();
  const clonedVoices = listClonedVoices();
  const storedTimbres = listStoredTimbres();
  const ffmpegStatus = getFfmpegStatus();
  const ffmpegStatusTone: OverviewStatusTone = ffmpegStatus === "可正常调用" ? "success" : "danger";

  const productVisionMetrics = productArchives
    .filter((archive) => archive.sourceImageUploadedAt)
    .map((archive) => ({
      timestamp: archive.sourceImageUploadedAt,
      callCount: 1,
      volumeCount:
        archive.parsedText.trim().length +
        archive.parsedData.rawText.trim().length +
        archive.parsedData.sellingPoints.join("").length,
    }));
  const productVisionCounts = buildCounts(productVisionMetrics, "次");

  const referenceAsrMetrics = videoMaterials
    .filter((material) => material.audioConvertedAt)
    .map((material) => ({
      timestamp: material.audioConvertedAt,
      callCount: 1,
      volumeCount: material.rawTranscript.trim().length,
    }));
  const referenceAsrCounts = buildCounts(referenceAsrMetrics, "次");

  const videoAnalysisMetrics = videoMaterials
    .filter((material) => material.videoAnalysisCompletedAt)
    .map((material) => ({
      timestamp: material.videoAnalysisCompletedAt,
      callCount: 1,
      volumeCount: material.framesExtracted,
    }));
  const videoAnalysisCounts = buildCounts(videoAnalysisMetrics, "次");

  const videoTemplateGenerationMetrics = videoMaterials
    .filter(
      (material) =>
        material.contentScript.trim().length > 0 ||
        material.videoTemplatePrompt.trim().length > 0 ||
        material.reversePrompt.trim().length > 0,
    )
    .map((material) => ({
      timestamp: material.updatedAt,
      callCount: 1,
      volumeCount:
        material.contentScript.trim().length +
        material.videoTemplatePrompt.trim().length +
        material.reversePrompt.trim().length +
        material.subtitle.trim().length,
    }));
  const videoTemplateGenerationCounts = buildCounts(videoTemplateGenerationMetrics, "次");

  const contentBuildMetrics = tasks.map((task) => ({
    timestamp: task.createdAt,
    callCount: 1,
    volumeCount:
      task.source.userPrompt.trim().length +
      task.source.videoTemplatePrompt.trim().length +
      task.source.productInfoSnapshot.trim().length +
      task.draftBundle.textToImagePrompt.trim().length +
      task.draftBundle.imageToVideoPrompt.trim().length +
      task.draftBundle.narrationScript.trim().length,
  }));
  const contentBuildCounts = buildCounts(contentBuildMetrics, "次");

  const narrationPlanningMetrics = narrations.map((result) => ({
    timestamp: result.createdAt,
    callCount: 1,
    volumeCount: result.clips.reduce((sum, clip) => sum + clip.narrationText.trim().length, 0),
  }));
  const narrationPlanningCounts = buildCounts(narrationPlanningMetrics, "次");

  const imageGenerationMetrics = visualShots.map((shot) => ({
    timestamp: shot.generatedAt,
    callCount: 1,
    volumeCount: shot.candidates.length,
  }));
  const imageGenerationCounts = buildCounts(imageGenerationMetrics, "次");

  const imageSelfCheckMetrics = visualShots.flatMap((shot) => {
    const checkedCandidates = shot.candidates.filter((candidate) => candidate.qualityCheckedAt);
    if (!checkedCandidates.length) {
      return [];
    }

    return [
      {
        timestamp: pickLatestTimestamp(checkedCandidates.map((candidate) => candidate.qualityCheckedAt)),
        callCount: 1,
        volumeCount: checkedCandidates.length,
      },
    ];
  });
  const imageSelfCheckCounts = buildCounts(imageSelfCheckMetrics, "次");

  const imageScoringMetrics = visualShots.map((shot) => ({
    timestamp: shot.generatedAt,
    callCount: 1,
    volumeCount: shot.candidates.length,
  }));
  const imageScoringCounts = buildCounts(imageScoringMetrics, "次");

  const ttsMetrics = narrations.flatMap((result) =>
    result.clips
      .filter((clip) => clip.audioUrl)
      .map((clip) => ({
        timestamp: result.updatedAt,
        callCount: 1,
        volumeCount: clip.narrationText.trim().length,
      })),
  );
  const ttsCounts = buildCounts(ttsMetrics, "次");

  const subtitleExportMetrics = [
    ...narrations.filter((result) => result.subtitleSrtUrl).map((result) => ({
      timestamp: result.updatedAt,
      callCount: 1,
      volumeCount: result.clips.length,
    })),
    ...compositions.filter((record) => record.subtitleSrtUrl).map((record) => ({
      timestamp: record.updatedAt,
      callCount: 1,
      volumeCount: record.segments.length,
    })),
  ];
  const subtitleExportCounts = buildCounts(subtitleExportMetrics, "次");

  const mergedNarrationMetrics = narrations
    .filter((result) => result.mergedAudioUrl)
    .map((result) => ({
      timestamp: result.updatedAt,
      callCount: 1,
      volumeCount: result.clips.length,
    }));
  const mergedNarrationCounts = buildCounts(mergedNarrationMetrics, "次");

  const clipGenerationMetrics = clipShots.map((shot) => ({
    timestamp: shot.generatedAt,
    callCount: 1,
    volumeCount: shot.durationSeconds,
  }));
  const clipGenerationCounts = buildCounts(clipGenerationMetrics, "次");

  const lipSyncMetrics = clipShots
    .filter((shot) => shot.lipSyncJobId)
    .map((shot) => ({
      timestamp: shot.updatedAt,
      callCount: 1,
      volumeCount: shot.durationSeconds,
    }));
  const lipSyncCounts = buildCounts(lipSyncMetrics, "次");

  const thumbnailMetrics = clipShots
    .filter((shot) => shot.thumbnailUrl)
    .map((shot) => ({
      timestamp: shot.updatedAt,
      callCount: 1,
      volumeCount: 1,
    }));
  const thumbnailCounts = buildCounts(thumbnailMetrics, "次");

  const compositionMetrics = compositions.map((record) => ({
    timestamp: record.createdAt,
    callCount: 1,
    volumeCount: record.segments.length,
  }));
  const compositionCounts = buildCounts(compositionMetrics, "次");

  const voiceCloneMetrics = clonedVoices.map((record) => ({
    timestamp: record.createdAt,
    callCount: 1,
    volumeCount: 1,
  }));
  const voiceCloneCounts = buildCounts(voiceCloneMetrics, "次");

  return [
    {
      id: "product-vision",
      title: "商品图 OCR / 卖点抽取",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: productVisionRuntime.providerLabel,
        modelId: productVisionRuntime.modelId,
        endpoint: joinApiUrl(productVisionRuntime.apiBase, "/api/v3/chat/completions"),
      }),
      role: "解析商品图片中的文字、卖点和标签，写入商品档案结构化字段。",
      thisWeekCount: productVisionCounts.thisWeekCount,
      lastWeekCount: productVisionCounts.lastWeekCount,
      yesterdayCount: productVisionCounts.yesterdayCount,
      volume: formatVolume(productVisionCounts.totalVolume, "字符"),
      status: productVisionRuntime.liveEnabled ? "可正常调用" : "未启用，商品图不会自动解析",
      statusTone: productVisionRuntime.liveEnabled ? "success" : "danger",
    },
    {
      id: "video-asr",
      title: "参考视频语音转写",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: asrRuntime.providerLabel,
        modelId: asrRuntime.resourceId,
        endpoint: joinApiUrl(asrRuntime.apiBase, "/api/v3/auc/bigmodel/recognize/flash"),
      }),
      role: "把参考视频音轨转成文稿，作为参考视频模板提示词生成的语义输入。",
      thisWeekCount: referenceAsrCounts.thisWeekCount,
      lastWeekCount: referenceAsrCounts.lastWeekCount,
      yesterdayCount: referenceAsrCounts.yesterdayCount,
      volume: formatVolume(referenceAsrCounts.totalVolume, "转写字符"),
      status: asrRuntime.liveEnabled ? "可正常调用" : "未启用，参考视频只能依赖画面分析",
      statusTone: asrRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "video-analysis",
      title: "参考视频逐帧视觉分析",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: visionRuntime.providerLabel,
        endpoint: joinApiUrl(visionRuntime.apiBase, visionRuntime.chatEndpoint),
      }),
      role: "对抽帧画面做镜头拆解和视觉总结，补足纯转写不能覆盖的场景信息。",
      thisWeekCount: videoAnalysisCounts.thisWeekCount,
      lastWeekCount: videoAnalysisCounts.lastWeekCount,
      yesterdayCount: videoAnalysisCounts.yesterdayCount,
      volume: formatVolume(videoAnalysisCounts.totalVolume, "采样帧"),
      status: visionRuntime.liveEnabled ? "可正常调用" : "未启用，参考视频不会做逐帧画面分析",
      statusTone: visionRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "video-template-generation",
      title: "参考视频脚本反推 / 模板提示词生成",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: generationRuntime.providerLabel,
        endpoint: joinApiUrl(generationRuntime.apiBase, generationRuntime.chatEndpoint),
      }),
      role: "根据转写与视觉分析生成 content script、template prompt 和 reverse prompt。",
      thisWeekCount: videoTemplateGenerationCounts.thisWeekCount,
      lastWeekCount: videoTemplateGenerationCounts.lastWeekCount,
      yesterdayCount: videoTemplateGenerationCounts.yesterdayCount,
      volume: formatVolume(videoTemplateGenerationCounts.totalVolume, "字符"),
      status: generationRuntime.liveEnabled ? "可正常调用" : "未启用，当前退回本地拼装",
      statusTone: generationRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "content-build",
      title: "导演镜头规划与提示词生成",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: taskGenerationRuntime.providerLabel,
        endpoint: joinApiUrl(taskGenerationRuntime.apiBase, taskGenerationRuntime.chatEndpoint),
      }),
      role: "根据商品信息、参考素材和用户补充提示生成 shot plan、文生图 prompt、图生视频 prompt 与旁白初稿。",
      thisWeekCount: contentBuildCounts.thisWeekCount,
      lastWeekCount: contentBuildCounts.lastWeekCount,
      yesterdayCount: contentBuildCounts.yesterdayCount,
      volume: formatVolume(contentBuildCounts.totalVolume, "字符"),
      status: taskGenerationRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地兜底模板",
      statusTone: taskGenerationRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "narration-llm",
      title: "旁白拆分 / 字幕规划 / 文案修复",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: taskGenerationRuntime.providerLabel,
        endpoint: joinApiUrl(taskGenerationRuntime.apiBase, taskGenerationRuntime.chatEndpoint),
      }),
      role: "把旁白进一步结构化成镜头台词和字幕时间轴，并在超时长时自动改写压缩文案。",
      thisWeekCount: narrationPlanningCounts.thisWeekCount,
      lastWeekCount: narrationPlanningCounts.lastWeekCount,
      yesterdayCount: narrationPlanningCounts.yesterdayCount,
      volume: formatVolume(narrationPlanningCounts.totalVolume, "解说字符"),
      status: taskGenerationRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地兜底拆分",
      statusTone: taskGenerationRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "image-generation",
      title: "视觉图片生成",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: imageRuntime.providerLabel,
        modelId: imageRuntime.modelId,
        endpoint: joinApiUrl(imageRuntime.apiBase, "/api/v3/images/generations"),
      }),
      role: "为每个镜头生成候选视觉图，作为片段生成的主参考素材。",
      thisWeekCount: imageGenerationCounts.thisWeekCount,
      lastWeekCount: imageGenerationCounts.lastWeekCount,
      yesterdayCount: imageGenerationCounts.yesterdayCount,
      volume: formatVolume(imageGenerationCounts.totalVolume, "张候选图"),
      status: imageRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地 Mock 图片",
      statusTone: imageRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "image-self-check",
      title: "视觉候选 AI 自检",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: visionRuntime.providerLabel,
        endpoint: joinApiUrl(visionRuntime.apiBase, visionRuntime.chatEndpoint),
      }),
      role: "逐张审核候选图是否符合人物、场景和结构要求，辅助过滤明显不合格的图片。",
      thisWeekCount: imageSelfCheckCounts.thisWeekCount,
      lastWeekCount: imageSelfCheckCounts.lastWeekCount,
      yesterdayCount: imageSelfCheckCounts.yesterdayCount,
      volume: formatVolume(imageSelfCheckCounts.totalVolume, "张图片"),
      status: visionRuntime.liveEnabled ? "可正常调用" : "未启用，仅保留本地评分与人工确认",
      statusTone: visionRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "image-scoring",
      title: "视觉候选评分与推荐",
      type: "本地服务",
      modelOrService: "本地启发式评分器 · 构图 / 像素 / 写实度 / 叙事匹配规则",
      role: "对视觉候选图进行质量评分与推荐，帮助选出更适合后续片段生成的图片。",
      thisWeekCount: imageScoringCounts.thisWeekCount,
      lastWeekCount: imageScoringCounts.lastWeekCount,
      yesterdayCount: imageScoringCounts.yesterdayCount,
      volume: formatVolume(imageScoringCounts.totalVolume, "张图片"),
      status: "可正常调用",
      statusTone: "success",
    },
    {
      id: "tts",
      title: "字幕音频合成",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: audioRuntime.providerLabel,
        modelId: audioRuntime.resourceId,
        suffix: `默认音色 ${audioRuntime.defaultVoiceId}`,
        endpoint: joinApiUrl(audioRuntime.apiBase, "/api/v3/tts/unidirectional/sse"),
      }),
      role: "把分镜头解说稿合成为音频，并返回逐词时间轴，供字幕和片段对齐。",
      thisWeekCount: ttsCounts.thisWeekCount,
      lastWeekCount: ttsCounts.lastWeekCount,
      yesterdayCount: ttsCounts.yesterdayCount,
      volume: formatVolume(ttsCounts.totalVolume, "解说字符"),
      status: audioRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地 Mock 静音配音",
      statusTone: audioRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "subtitle-export",
      title: "SRT 字幕导出",
      type: "本地服务",
      modelOrService: "本地字幕导出器 · SRT 文件写入 public/generated-subtitles",
      role: "根据逐镜头台词和时间轴生成 SRT 字幕文件，供预览、下载和成片烧录使用。",
      thisWeekCount: subtitleExportCounts.thisWeekCount,
      lastWeekCount: subtitleExportCounts.lastWeekCount,
      yesterdayCount: subtitleExportCounts.yesterdayCount,
      volume: formatVolume(subtitleExportCounts.totalVolume, "条字幕片段"),
      status: "可正常调用",
      statusTone: "success",
    },
    {
      id: "merged-narration",
      title: "解说音频合并",
      type: "本地服务",
      modelOrService: "FFmpeg 本地服务 · narration-audio-bundle",
      role: "把多个分镜头音频合并成整段解说音频，便于统一预览和后续复用。",
      thisWeekCount: mergedNarrationCounts.thisWeekCount,
      lastWeekCount: mergedNarrationCounts.lastWeekCount,
      yesterdayCount: mergedNarrationCounts.yesterdayCount,
      volume: formatVolume(mergedNarrationCounts.totalVolume, "段音频片段"),
      status: ffmpegStatus,
      statusTone: ffmpegStatusTone,
    },
    {
      id: "clip-generation",
      title: "视频片段生成",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: activeVideoRuntime.providerLabel,
        modelId: activeVideoRuntime.modelId,
        endpoint: getVideoGenerationEndpoint(),
      }),
      role: "依据视觉图、图生视频提示词、字幕和时间轴生成逐镜头视频片段；默认走 Seedance，也支持切换 Kling。",
      thisWeekCount: clipGenerationCounts.thisWeekCount,
      lastWeekCount: clipGenerationCounts.lastWeekCount,
      yesterdayCount: clipGenerationCounts.yesterdayCount,
      volume: formatVolume(clipGenerationCounts.totalVolume, "秒视频"),
      status: activeVideoRuntime.liveEnabled
        ? `可正常调用（当前 Provider：${activeVideoRuntime.provider}）`
        : "未启用，当前走本地 Mock 静态视频占位",
      statusTone: activeVideoRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "lip-sync",
      title: "口型同步",
      type: "调用大模型 API",
      modelOrService: buildRuntimeDescriptor({
        providerLabel: klingVideoRuntime.providerLabel,
        modelId: klingVideoRuntime.modelId,
        endpoint: joinApiUrl(klingVideoRuntime.apiBase, "/v1/videos/lip-sync"),
      }),
      role: "把已生成片段和配音音频重新提交为 audio2video 任务，产出带口型版本。",
      thisWeekCount: lipSyncCounts.thisWeekCount,
      lastWeekCount: lipSyncCounts.lastWeekCount,
      yesterdayCount: lipSyncCounts.yesterdayCount,
      volume: formatVolume(lipSyncCounts.totalVolume, "秒视频"),
      status: klingVideoRuntime.liveEnabled
        ? "可正常调用，仅自拍口播 / 出镜口播类型会触发"
        : "未启用，当前走本地 Mock 口型同步占位",
      statusTone: klingVideoRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "clip-thumbnail",
      title: "片段首帧提取",
      type: "本地服务",
      modelOrService: "FFmpeg 本地服务 · task-clip thumbnail extractor",
      role: "从已生成片段中抽取首帧缩略图，用于片段列表和详情页预览。",
      thisWeekCount: thumbnailCounts.thisWeekCount,
      lastWeekCount: thumbnailCounts.lastWeekCount,
      yesterdayCount: thumbnailCounts.yesterdayCount,
      volume: formatVolume(thumbnailCounts.totalVolume, "张缩略图"),
      status: ffmpegStatus,
      statusTone: ffmpegStatusTone,
    },
    {
      id: "voice-library-openapi",
      title: "在线音色目录拉取",
      type: "调用大模型 API",
      modelOrService: `豆包语音 OpenAPI · https://${voiceRuntime.openApiHost}/?Action=GetSpeechSynthesisSpeakerList`,
      role: "获取在线推荐音色和搜索音色目录，为配音与导演模式选择音色提供基础数据。",
      thisWeekCount: "暂未记录",
      lastWeekCount: "暂未记录",
      yesterdayCount: "暂未记录",
      volume: `${storedTimbres.length} 条在线音色缓存`,
      status: voiceRuntime.timbreApiEnabled ? "可正常调用" : "未配置 OpenAPI AK / SK",
      statusTone: voiceRuntime.timbreApiEnabled ? "success" : "danger",
    },
    {
      id: "voice-clone",
      title: "声音复刻训练",
      type: "调用大模型 API",
      modelOrService: `豆包语音克隆 · ${voiceRuntime.cloneResourceId} · https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload`,
      role: "提交训练音频并查询复刻状态，为配音环节提供专属克隆音色。",
      thisWeekCount: voiceCloneCounts.thisWeekCount,
      lastWeekCount: voiceCloneCounts.lastWeekCount,
      yesterdayCount: voiceCloneCounts.yesterdayCount,
      volume: formatVolume(voiceCloneCounts.totalVolume, "个克隆任务"),
      status: voiceRuntime.cloneEnabled ? "可正常调用" : "未配置 AppId / AccessToken",
      statusTone: voiceRuntime.cloneEnabled ? "success" : "danger",
    },
    {
      id: "composition",
      title: "视频合成与字幕烧录",
      type: "本地服务",
      modelOrService: "FFmpeg 本地服务 · video-composition-runner",
      role: "完成片段拼接、转场处理、音频混音、背景音乐叠加和字幕烧录，输出最终成片。",
      thisWeekCount: compositionCounts.thisWeekCount,
      lastWeekCount: compositionCounts.lastWeekCount,
      yesterdayCount: compositionCounts.yesterdayCount,
      volume: formatVolume(compositionCounts.totalVolume, "段时间线片段"),
      status: ffmpegStatus,
      statusTone: ffmpegStatusTone,
    },
  ];
}
