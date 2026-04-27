import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../lib/auth-session";
import { getUnifiedTimbreCatalog, fetchOnlineTimbres } from "../../../lib/doubao-timbre-service";
import { getSpeakerDisplayNameOverride } from "../../../lib/speaker-display-overrides";
import { getVoiceManagementRuntime } from "../../../lib/voice-management-config";
import {
  addSpeakerToSearchDisplay,
  countOwnedClonedVoices,
  listClonedVoices,
  listFavoriteSpeakerIds,
  patchClonedVoice,
  upsertClonedVoice,
} from "../../../lib/voice-management-store";
import { queryVoiceCloneStatusesWithFallback } from "../../../lib/voice-clone-service";

function isGenericCloneName(value: string | null | undefined, speakerId: string) {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized === speakerId || normalized === `导入音色 ${speakerId}`;
}

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const runtime = getVoiceManagementRuntime();
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
    const includeTimbres = request.nextUrl.searchParams.get("includeTimbres") !== "0";
    const timbres = await getUnifiedTimbreCatalog({ forceRefresh });

    const cloneRecords = listClonedVoices(session.userId);
    const clonesNeedingRefresh = runtime.cloneEnabled
      ? cloneRecords.filter((record) => {
          const genericName =
            isGenericCloneName(record.alias, record.speakerId) || isGenericCloneName(record.title, record.speakerId);
          const canRepairGenericName = genericName && Boolean(getSpeakerDisplayNameOverride(record.speakerId));
          return (
            record.speakerId.startsWith("S_") &&
            record.status !== "FAILED" &&
            ((record.status !== "SUCCESS" && record.status !== "ACTIVE") ||
              canRepairGenericName ||
              !record.demoAudioUrl ||
              !record.trainingVersion ||
              forceRefresh)
          );
        })
      : [];
    if (clonesNeedingRefresh.length > 0) {
      const statusMap = await queryVoiceCloneStatusesWithFallback(
        clonesNeedingRefresh.map((record) => record.speakerId),
      );
      for (const record of clonesNeedingRefresh) {
        const status = statusMap.get(record.speakerId);
        if (!status) {
          continue;
        }
        const displayName = status.alias || getSpeakerDisplayNameOverride(record.speakerId) || null;
        patchClonedVoice(
          record.cloneId,
          {
            title: displayName && isGenericCloneName(record.title, record.speakerId) ? displayName : record.title,
            alias: displayName && isGenericCloneName(record.alias, record.speakerId) ? displayName : record.alias,
            status: status.status,
            trainingVersion: status.version ?? record.trainingVersion,
            demoAudioUrl: status.demoAudioUrl ?? record.demoAudioUrl,
            availableTrainingTimes: status.availableTrainingTimes ?? record.availableTrainingTimes,
            error: status.status === "FAILED" ? "训练失败，请更换音频样本后重试。" : null,
          },
          session.userId,
        );
      }
    }

    const timbreMap = new Map(timbres.map((item) => [item.speakerId, item]));
    for (const record of listClonedVoices(session.userId)) {
      const matchedTimbre = timbreMap.get(record.speakerId);
      if (!matchedTimbre || matchedTimbre.speakerName === record.speakerId) {
        continue;
      }
      if (isGenericCloneName(record.alias, record.speakerId) || isGenericCloneName(record.title, record.speakerId)) {
        patchClonedVoice(
          record.cloneId,
          {
            title: isGenericCloneName(record.title, record.speakerId) ? matchedTimbre.speakerName : record.title,
            alias: isGenericCloneName(record.alias, record.speakerId) ? matchedTimbre.speakerName : record.alias,
          },
          session.userId,
        );
      }
    }

    const favoriteIds = listFavoriteSpeakerIds(session.userId);
    const favoriteTimbres = favoriteIds
      .map((speakerId) => timbreMap.get(speakerId))
      .filter((item): item is NonNullable<(typeof timbres)[number]> => Boolean(item));
    const usedVoiceClones = countOwnedClonedVoices(session.userId);

    return NextResponse.json({
      ...(includeTimbres ? { timbres } : {}),
      favoriteTimbres,
      clonedVoices: listClonedVoices(session.userId),
      favoriteIds,
      membership: {
        usedVoiceClones,
      },
      runtime: {
        timbreApiEnabled: runtime.timbreApiEnabled,
        cloneEnabled: runtime.cloneEnabled,
        cloneResourceId: runtime.cloneResourceId,
        defaultCloneSpeakerId: runtime.defaultCloneSpeakerId,
        configFileName: runtime.configFileName,
        cloneRules: {
          supportedFormats: ["wav", "mp3", "m4a"],
          maxFileSizeMb: 8,
          recommendedDuration: "10~30 秒",
          supportedLanguages: ["cn", "en"],
          supportedModelTypes: [4, 5],
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载音色管理数据失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      speakerId?: string;
      alias?: string;
    };
    const speakerId = body.speakerId?.trim();
    const manualAlias = body.alias?.trim() || null;
    if (!speakerId) {
      return NextResponse.json({ error: "缺少音色 ID" }, { status: 400 });
    }

    const catalog = await fetchOnlineTimbres();
    const matched = catalog.find((item) => item.speakerId === speakerId) ?? null;
    if (!matched && !speakerId.startsWith("S_")) {
      return NextResponse.json({ error: "未找到对应音色" }, { status: 404 });
    }

    if (!matched && speakerId.startsWith("S_")) {
      const existingClone = listClonedVoices(session.userId).find((item) => item.speakerId === speakerId) ?? null;
      const cloneStatus =
        (await queryVoiceCloneStatusesWithFallback([speakerId])
          .then((items) => items.get(speakerId))
          .catch(() => null)) ?? null;
      const now = new Date().toISOString();
      const displayName = manualAlias || cloneStatus?.alias || getSpeakerDisplayNameOverride(speakerId);
      upsertClonedVoice({
        cloneId: existingClone?.cloneId ?? `imported-${speakerId}`,
        ownerUserId: existingClone?.ownerUserId ?? session.userId,
        title: displayName || existingClone?.title || speakerId,
        speakerId,
        alias: displayName || existingClone?.alias || speakerId,
        status: cloneStatus?.status ?? existingClone?.status ?? "ACTIVE",
        language: existingClone?.language ?? "cn",
        modelType: existingClone?.modelType ?? 4,
        sourceFileName: existingClone?.sourceFileName ?? `imported-${speakerId}.wav`,
        sourceFormat: existingClone?.sourceFormat ?? "wav",
        transcript: existingClone?.transcript ?? "从豆包语音控制台导入的已复刻音色。",
        demoAudioUrl: cloneStatus?.demoAudioUrl ?? existingClone?.demoAudioUrl ?? null,
        trainingVersion: cloneStatus?.version ?? existingClone?.trainingVersion ?? null,
        availableTrainingTimes: cloneStatus?.availableTrainingTimes ?? existingClone?.availableTrainingTimes ?? null,
        error: null,
        createdAt: existingClone?.createdAt ?? now,
        updatedAt: now,
      });
    }

    addSpeakerToSearchDisplay(speakerId, session.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "添加音色失败" }, { status: 500 });
  }
}
