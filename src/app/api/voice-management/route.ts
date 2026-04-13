import { NextRequest, NextResponse } from "next/server";

import { getUnifiedTimbreCatalog, fetchOnlineTimbres } from "../../../lib/doubao-timbre-service";
import { getVoiceManagementRuntime } from "../../../lib/voice-management-config";
import {
  addSpeakerToSearchDisplay,
  listClonedVoices,
  listFavoriteSpeakerIds,
  patchClonedVoice,
  upsertClonedVoice,
} from "../../../lib/voice-management-store";
import { queryVoiceCloneStatus } from "../../../lib/voice-clone-service";

function isGenericCloneName(value: string | null | undefined, speakerId: string) {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized === speakerId || normalized === `导入音色 ${speakerId}`;
}

export async function GET(request: NextRequest) {
  try {
    const runtime = getVoiceManagementRuntime();
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
    const timbres = await getUnifiedTimbreCatalog({ forceRefresh });

    const cloneRecords = listClonedVoices();
    const pendingClones = runtime.cloneEnabled
      ? cloneRecords.filter((r) => r.status !== "FAILED" && r.status !== "SUCCESS" && r.status !== "ACTIVE")
      : [];
    await Promise.allSettled(
      pendingClones.map(async (record) => {
        const status = await queryVoiceCloneStatus(record.speakerId);
        patchClonedVoice(record.cloneId, {
          status: status.status,
          trainingVersion: status.version,
          demoAudioUrl: status.demoAudioUrl,
          error: status.status === "FAILED" ? "训练失败，请更换音频样本后重试。" : null,
        });
      }),
    );

    const timbreMap = new Map(timbres.map((item) => [item.speakerId, item]));
    for (const record of listClonedVoices()) {
      const matchedTimbre = timbreMap.get(record.speakerId);
      if (!matchedTimbre || matchedTimbre.speakerName === record.speakerId) {
        continue;
      }
      if (isGenericCloneName(record.alias, record.speakerId) || isGenericCloneName(record.title, record.speakerId)) {
        patchClonedVoice(record.cloneId, {
          title: isGenericCloneName(record.title, record.speakerId) ? matchedTimbre.speakerName : record.title,
          alias: isGenericCloneName(record.alias, record.speakerId) ? matchedTimbre.speakerName : record.alias,
        });
      }
    }

    const favoriteIds = listFavoriteSpeakerIds();

    return NextResponse.json({
      timbres,
      clonedVoices: listClonedVoices(),
      favoriteIds,
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
      const existingClone = listClonedVoices().find((item) => item.speakerId === speakerId) ?? null;
      const cloneStatus = await queryVoiceCloneStatus(speakerId).catch(() => null);
      const now = new Date().toISOString();
      upsertClonedVoice({
        cloneId: existingClone?.cloneId ?? `imported-${speakerId}`,
        title: manualAlias || existingClone?.title || speakerId,
        speakerId,
        alias: manualAlias || existingClone?.alias || speakerId,
        status: cloneStatus?.status ?? existingClone?.status ?? "ACTIVE",
        language: existingClone?.language ?? "cn",
        modelType: existingClone?.modelType ?? 4,
        sourceFileName: existingClone?.sourceFileName ?? `imported-${speakerId}.wav`,
        sourceFormat: existingClone?.sourceFormat ?? "wav",
        transcript: existingClone?.transcript ?? "从豆包语音控制台导入的已复刻音色。",
        demoAudioUrl: cloneStatus?.demoAudioUrl ?? existingClone?.demoAudioUrl ?? null,
        trainingVersion: cloneStatus?.version ?? existingClone?.trainingVersion ?? null,
        availableTrainingTimes: existingClone?.availableTrainingTimes ?? null,
        error: null,
        createdAt: existingClone?.createdAt ?? now,
        updatedAt: now,
      });
    }

    addSpeakerToSearchDisplay(speakerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "添加音色失败" }, { status: 500 });
  }
}
