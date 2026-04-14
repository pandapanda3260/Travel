import type { VideoJobStatus } from "./video-job-store";

const demoVideoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

export function createMockJobId() {
  return `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isMockJob(jobId: string) {
  return jobId.startsWith("mock_");
}

function getMockCreatedAt(jobId: string) {
  const [, timestamp] = jobId.split("_");
  const createdAt = Number(timestamp);

  if (!Number.isFinite(createdAt)) {
    return Date.now();
  }

  return createdAt;
}

export function getMockJobState(jobId: string) {
  const createdAt = getMockCreatedAt(jobId);
  const elapsedMs = Date.now() - createdAt;

  if (elapsedMs < 2_500) {
    return {
      status: "QUEUED" as VideoJobStatus,
      logs: ["Mock 模式已接收任务，未调用真实生成通道。"],
      videoUrl: null,
    };
  }

  if (elapsedMs < 7_000) {
    return {
      status: "IN_PROGRESS" as VideoJobStatus,
      logs: [
        "Mock 模式模拟任务排队完成。",
        "正在模拟生成视频分镜与画面节奏。",
      ],
      videoUrl: null,
    };
  }

  return {
    status: "COMPLETED" as VideoJobStatus,
    logs: [
      "Mock 模式生成完成。",
      "当前结果为演示视频，可用于验证页面交互与下载流程。",
    ],
    videoUrl: demoVideoUrl,
  };
}
