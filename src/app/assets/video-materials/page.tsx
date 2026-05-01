import "./video-materials.css";

import { getAsrRuntime } from "../../../lib/asr-provider-config";
import { getTextGenerationRuntime } from "../../../lib/text-provider-config";
import { getVisionRuntime } from "../../../lib/vision-provider-config";
import type { VideoMaterialsPayload } from "./video-materials-page-client";
import { VideoMaterialsPageLoader } from "./video-materials-page-loader";

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

export default function VideoMaterialsPage() {
  return <VideoMaterialsPageLoader initialData={buildEmptyPayload()} />;
}
