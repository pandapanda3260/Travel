import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const packageRequire = createRequire(process.cwd() + "/package.json");

export type LocalServiceRuntime = {
  serviceLabel: string;
  available: boolean;
  statusLabel: string;
};

export function getFfmpegLocalRuntime(serviceLabel: string): LocalServiceRuntime {
  try {
    const runtimePath = packageRequire("ffmpeg-static") as string | null;
    const available = Boolean(runtimePath && existsSync(runtimePath));
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
