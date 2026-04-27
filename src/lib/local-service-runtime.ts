import { getFfmpegBinaryPathOrNull } from "./ffmpeg-runtime";

export type LocalServiceRuntime = {
  serviceLabel: string;
  available: boolean;
  statusLabel: string;
};

export function getFfmpegLocalRuntime(serviceLabel: string): LocalServiceRuntime {
  try {
    const available = Boolean(getFfmpegBinaryPathOrNull());
    return {
      serviceLabel,
      available,
      statusLabel: available ? "可正常调用" : "缺少 FFmpeg",
    };
  } catch {
    return {
      serviceLabel,
      available: false,
      statusLabel: "缺少 FFmpeg",
    };
  }
}
