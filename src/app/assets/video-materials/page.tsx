import "./video-materials.css";

import { getAsrRuntime } from "../../../lib/asr-provider-config";
import { requireUserPageSession } from "../../../lib/auth-session";
import { getTextGenerationRuntime } from "../../../lib/text-provider-config";
import { listAccessibleVideoMaterialSummaries } from "../../../lib/video-material-store";
import { getVisionRuntime } from "../../../lib/vision-provider-config";
import VideoMaterialsPageClient, { type VideoMaterialsPayload } from "./video-materials-page-client";

function buildEmptyPayload(): VideoMaterialsPayload {
  const asrRuntime = getAsrRuntime();
  const textRuntime = getTextGenerationRuntime();
  const visionRuntime = getVisionRuntime();
  return {
    materials: [],
    runtime: {
      asrProviderLabel: asrRuntime.providerLabel,
      asrLiveEnabled: asrRuntime.liveEnabled,
      textProviderLabel: textRuntime.providerLabel,
      textLiveEnabled: textRuntime.liveEnabled,
      visionProviderLabel: visionRuntime.providerLabel,
      visionLiveEnabled: visionRuntime.liveEnabled,
    },
  };
}

export default async function VideoMaterialsPage() {
  const session = await requireUserPageSession();
  let initialData = buildEmptyPayload();
  let initialError: string | null = null;

  try {
    const asrRuntime = getAsrRuntime();
    const textRuntime = getTextGenerationRuntime();
    const visionRuntime = getVisionRuntime();

    initialData = {
      materials: listAccessibleVideoMaterialSummaries(session.userId),
      runtime: {
        asrProviderLabel: asrRuntime.providerLabel,
        asrLiveEnabled: asrRuntime.liveEnabled,
        textProviderLabel: textRuntime.providerLabel,
        textLiveEnabled: textRuntime.liveEnabled,
        visionProviderLabel: visionRuntime.providerLabel,
        visionLiveEnabled: visionRuntime.liveEnabled,
      },
    };
  } catch (error) {
    initialError = error instanceof Error ? error.message : "视频拆解页面加载失败";
  }

  return <VideoMaterialsPageClient initialData={initialData} initialError={initialError} />;
}
