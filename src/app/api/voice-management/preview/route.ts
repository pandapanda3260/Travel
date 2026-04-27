import { NextRequest, NextResponse } from "next/server";

import { withAdminProviderCallTracking } from "../../../../lib/admin-data-flow-tracking";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import {
  getTimbreResourceFallbacks,
  getUnifiedTimbreCatalog,
  resolveTimbreResourceId,
} from "../../../../lib/doubao-timbre-service";
import { runWithModelUsageContext } from "../../../../lib/model-usage-context";
import { queryVoiceCloneStatus } from "../../../../lib/voice-clone-service";
import { getSpeechSynthesisRuntime } from "../../../../lib/audio-provider-config";
import { getVoiceManagementRuntime } from "../../../../lib/voice-management-config";
import { listClonedVoices, patchClonedVoice } from "../../../../lib/voice-management-store";
import { synthesizeSpeechWithResourceFallbacks } from "../../../../lib/audio-provider";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const runtime = getVoiceManagementRuntime();
    const speechRuntime = getSpeechSynthesisRuntime();
    const body = (await request.json()) as {
      speakerId?: string;
    };
    const speakerId = body.speakerId?.trim();

    if (!speakerId) {
      return NextResponse.json({ error: "缺少音色 ID" }, { status: 400 });
    }

    const withUsageContext = <T>(objectId: string, work: () => Promise<T>) =>
      runWithModelUsageContext(
        {
          userId: session.userId,
          routePath: "/api/voice-management/preview",
          objectType: "voice_preview",
          objectId,
        },
        work,
      );

    const timbre = (await getUnifiedTimbreCatalog()).find((item) => item.speakerId === speakerId);

    if (timbre) {
      if (timbre.previewUrl) {
        return NextResponse.json({
          previewUrl: timbre.previewUrl,
          previewText: timbre.previewText,
        });
      }

      const resourceId = resolveTimbreResourceId(timbre.speakerId);
      if (!resourceId) {
        return NextResponse.json({ error: "该音色暂不支持在线试听" }, { status: 400 });
      }

      const preview = await withUsageContext(timbre.speakerId, () =>
        withAdminProviderCallTracking(
          {
            enabled: speechRuntime.liveEnabled,
            serviceName: "audio.voice_preview",
            provider: speechRuntime.providerLabel,
            modelId: resourceId,
            objectType: "voice_preview",
            objectId: timbre.speakerId,
          },
          () =>
            synthesizeSpeechWithResourceFallbacks({
              text: timbre.previewText,
              voiceId: timbre.speakerId,
              resourceId,
              fallbackResourceIds: getTimbreResourceFallbacks(timbre.speakerId),
              enableSubtitle: false,
            }),
        ),
      );

      return NextResponse.json({
        previewUrl: preview.audioUrl,
        previewText: timbre.previewText,
      });
    }

    const clonedVoice = listClonedVoices(session.userId).find((voice) => voice.speakerId === speakerId);
    if (clonedVoice) {
      let latestDemoAudioUrl = clonedVoice.demoAudioUrl;

      if (runtime.cloneEnabled) {
        const latestStatus = await queryVoiceCloneStatus(speakerId).catch(() => null);
        if (latestStatus) {
          latestDemoAudioUrl = latestStatus.demoAudioUrl ?? latestDemoAudioUrl;
          patchClonedVoice(
            clonedVoice.cloneId,
            {
              status: latestStatus.status,
              trainingVersion: latestStatus.version,
              demoAudioUrl: latestStatus.demoAudioUrl ?? clonedVoice.demoAudioUrl,
              error: latestStatus.status === "FAILED" ? "训练失败，请更换音频样本后重试。" : null,
            },
            session.userId,
          );
        }
      }

      if (latestDemoAudioUrl) {
        return NextResponse.json({
          previewUrl: latestDemoAudioUrl,
          previewText: clonedVoice.transcript,
        });
      }

      const resourceId = resolveTimbreResourceId(speakerId);
      if (!resourceId) {
        return NextResponse.json({ error: "该复刻音色暂不支持在线试听" }, { status: 400 });
      }

      const preview = await withUsageContext(speakerId, () =>
        withAdminProviderCallTracking(
          {
            enabled: speechRuntime.liveEnabled,
            serviceName: "audio.voice_preview",
            provider: speechRuntime.providerLabel,
            modelId: resourceId,
            objectType: "voice_preview",
            objectId: speakerId,
          },
          () =>
            synthesizeSpeechWithResourceFallbacks({
              text: clonedVoice.transcript || "欢迎使用复刻音色试听功能。",
              voiceId: speakerId,
              resourceId,
              fallbackResourceIds: getTimbreResourceFallbacks(speakerId),
              enableSubtitle: false,
            }),
        ),
      );

      return NextResponse.json({
        previewUrl: preview.audioUrl,
        previewText: clonedVoice.transcript,
      });
    }

    return NextResponse.json({ error: "未找到对应音色" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "试听音频生成失败" }, { status: 500 });
  }
}
