import { createRequire } from "node:module";
import { existsSync } from "node:fs";

import { getSpeechSynthesisRuntime } from "./audio-provider-config";
import { getImageGenerationRuntime } from "./image-provider-config";
import { listNarrationResults } from "./narration-result-store";
import { listTaskClipShots } from "./task-clip-store";
import { listTaskVisualImageShots } from "./task-visual-image-store";
import { getTextGenerationRuntime } from "./text-provider-config";
import { listStoredTimbres } from "./timbre-library-store";
import { listVideoCompositions } from "./video-composition-store";
import { listVideoTasks } from "./video-task-store";
import { getProviderRuntime } from "./video-provider-config";
import { getVoiceManagementRuntime } from "./voice-management-config";
import { listClonedVoices } from "./voice-management-store";

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
  statusTone: "success" | "warning" | "danger";
};

type TimedMetric = {
  timestamp: string | null | undefined;
  callCount?: number;
  volumeCount?: number;
};

const packageRequire = createRequire(process.cwd() + "/package.json");

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
    const ffmpegPath = packageRequire("ffmpeg-static") as string | null;
    return ffmpegPath && existsSync(ffmpegPath) ? "可正常调用" : "缺少 FFmpeg";
  } catch {
    return "缺少 FFmpeg";
  }
}

export function buildOverviewServiceReport(): OverviewServiceReportEntry[] {
  const textRuntime = getTextGenerationRuntime();
  const imageRuntime = getImageGenerationRuntime();
  const audioRuntime = getSpeechSynthesisRuntime();
  const videoRuntime = getProviderRuntime();
  const voiceRuntime = getVoiceManagementRuntime();
  const tasks = listVideoTasks();
  const visualShots = listTaskVisualImageShots().filter((item) => item.generatedAt);
  const narrations = listNarrationResults();
  const clipShots = listTaskClipShots().filter((item) => item.generatedAt);
  const compositions = listVideoCompositions();
  const clonedVoices = listClonedVoices();
  const storedTimbres = listStoredTimbres();
  const ranges = getRangeBoundaries();

  const buildCounts = (metrics: TimedMetric[], unit: string) => {
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
  };

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
      id: "content-build",
      title: "内容构建提示词生成",
      type: "调用大模型 API",
      modelOrService: `${textRuntime.providerLabel} · ${textRuntime.modelId} · ${textRuntime.apiBase.replace(/\/$/, "")}/api/v3/chat/completions`,
      role: "根据商品信息和用户补充提示生成文生图提示词、图生视频提示词与解说稿初稿。",
      thisWeekCount: contentBuildCounts.thisWeekCount,
      lastWeekCount: contentBuildCounts.lastWeekCount,
      yesterdayCount: contentBuildCounts.yesterdayCount,
      volume: formatVolume(contentBuildCounts.totalVolume, "字符"),
      status: textRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地兜底模板",
      statusTone: textRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "narration-llm",
      title: "解说拆分与字幕规划",
      type: "调用大模型 API",
      modelOrService: `${textRuntime.providerLabel} · ${textRuntime.modelId} · ${textRuntime.apiBase.replace(/\/$/, "")}/api/v3/chat/completions`,
      role: "把解说稿进一步结构化成分镜头台词、字幕和时间轴规划，作为音频与字幕制作输入。",
      thisWeekCount: narrationPlanningCounts.thisWeekCount,
      lastWeekCount: narrationPlanningCounts.lastWeekCount,
      yesterdayCount: narrationPlanningCounts.yesterdayCount,
      volume: formatVolume(narrationPlanningCounts.totalVolume, "解说字符"),
      status: textRuntime.liveEnabled ? "可正常调用" : "未启用，当前走本地兜底拆分",
      statusTone: textRuntime.liveEnabled ? "success" : "warning",
    },
    {
      id: "image-generation",
      title: "视觉图片生成",
      type: "调用大模型 API",
      modelOrService: `${imageRuntime.providerLabel} · ${imageRuntime.modelId} · ${imageRuntime.apiBase.replace(/\/$/, "")}/api/v3/images/generations`,
      role: "为每个镜头生成候选视觉图，作为片段生成的主参考素材。",
      thisWeekCount: imageGenerationCounts.thisWeekCount,
      lastWeekCount: imageGenerationCounts.lastWeekCount,
      yesterdayCount: imageGenerationCounts.yesterdayCount,
      volume: formatVolume(imageGenerationCounts.totalVolume, "张候选图"),
      status: imageRuntime.liveEnabled ? "可正常调用" : "未配置图片生成凭证",
      statusTone: imageRuntime.liveEnabled ? "success" : "danger",
    },
    {
      id: "image-scoring",
      title: "视觉候选评分与推荐",
      type: "本地服务",
      modelOrService: "本地启发式评分器 · 构图/像素/写实度/叙事匹配规则",
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
      modelOrService: `${audioRuntime.providerLabel} · 默认音色 ${audioRuntime.defaultVoiceId} · ${audioRuntime.apiBase.replace(/\/$/, "")}/api/v3/tts/unidirectional/sse`,
      role: "把分镜头解说稿合成为音频，并返回逐词时间轴，供字幕和片段对齐。",
      thisWeekCount: ttsCounts.thisWeekCount,
      lastWeekCount: ttsCounts.lastWeekCount,
      yesterdayCount: ttsCounts.yesterdayCount,
      volume: formatVolume(ttsCounts.totalVolume, "解说字符"),
      status: audioRuntime.liveEnabled ? "可正常调用" : "未配置音频服务凭证",
      statusTone: audioRuntime.liveEnabled ? "success" : "danger",
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
      status: getFfmpegStatus(),
      statusTone: getFfmpegStatus() === "可正常调用" ? "success" : "danger",
    },
    {
      id: "clip-generation",
      title: "视频片段生成",
      type: "调用大模型 API",
      modelOrService: `${videoRuntime.providerLabel} · ${videoRuntime.modelId} · ${videoRuntime.apiBase.replace(/\/$/, "")}/api/v3/videos/generations`,
      role: "依据视觉图、图生视频提示词、字幕和时间轴生成逐镜头视频片段。",
      thisWeekCount: clipGenerationCounts.thisWeekCount,
      lastWeekCount: clipGenerationCounts.lastWeekCount,
      yesterdayCount: clipGenerationCounts.yesterdayCount,
      volume: formatVolume(clipGenerationCounts.totalVolume, "秒视频"),
      status: videoRuntime.liveEnabled ? "可正常调用" : "未配置视频生成凭证",
      statusTone: videoRuntime.liveEnabled ? "success" : "danger",
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
      status: getFfmpegStatus(),
      statusTone: getFfmpegStatus() === "可正常调用" ? "success" : "danger",
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
      status: voiceRuntime.timbreApiEnabled ? "可正常调用" : "未配置 OpenAPI AK/SK",
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
      status: getFfmpegStatus(),
      statusTone: getFfmpegStatus() === "可正常调用" ? "success" : "danger",
    },
  ];
}
