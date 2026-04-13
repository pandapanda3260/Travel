import { NextResponse } from "next/server";

import { listVideoMaterials, createVideoMaterial } from "../../../lib/video-material-store";
import { getAsrRuntime } from "../../../lib/asr-provider-config";
import { getTextGenerationRuntime } from "../../../lib/text-provider-config";
import { getVisionRuntime, getGenerationRuntime } from "../../../lib/vision-provider-config";

export async function GET() {
  try {
    const materials = listVideoMaterials();
    const asrRuntime = getAsrRuntime();
    const textRuntime = getTextGenerationRuntime();
    const visionRuntime = getVisionRuntime();
    const generationRuntime = getGenerationRuntime();

    return NextResponse.json({
      materials,
      runtime: {
        asrProviderLabel: asrRuntime.providerLabel,
        asrLiveEnabled: asrRuntime.liveEnabled,
        textProviderLabel: textRuntime.providerLabel,
        textLiveEnabled: textRuntime.liveEnabled,
        visionProviderLabel: visionRuntime.providerLabel,
        visionLiveEnabled: visionRuntime.liveEnabled,
        generationProviderLabel: generationRuntime.providerLabel,
        generationLiveEnabled: generationRuntime.liveEnabled,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频素材列表加载失败" },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const material = createVideoMaterial("");
    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建素材记录失败" },
      { status: 500 },
    );
  }
}
