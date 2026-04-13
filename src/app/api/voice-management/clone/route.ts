import { NextRequest, NextResponse } from "next/server";

import { getVoiceManagementRuntime } from "../../../../lib/voice-management-config";
import { deleteClonedVoice, upsertClonedVoice } from "../../../../lib/voice-management-store";
import { queryVoiceCloneStatus, supportedCloneFormats, uploadVoiceClone } from "../../../../lib/voice-clone-service";

const maxFileSizeBytes = 8 * 1024 * 1024;

function getFileExtension(name: string) {
  const segments = name.toLowerCase().split(".");
  return segments.length > 1 ? segments.pop() ?? "" : "";
}

export async function POST(request: NextRequest) {
  try {
    const runtime = getVoiceManagementRuntime();
    const formData = await request.formData();
    const title = String(formData.get("title") ?? "").trim();
    const transcript = String(formData.get("transcript") ?? "").trim();
    const speakerId =
      String(formData.get("speakerId") ?? "").trim() || runtime.defaultCloneSpeakerId;
    const language = (String(formData.get("language") ?? "cn").trim() || "cn") as "cn" | "en";
    const modelType = Number(formData.get("modelType") ?? 4) as 4 | 5;
    const enableDenoise = String(formData.get("enableDenoise") ?? "0") === "1";
    const file = formData.get("file");

    if (!speakerId) {
      return NextResponse.json(
        {
          error:
            "缺少音色槽位 ID。请在火山引擎控制台「语音技术 → 声音复刻」中购买槽位，获取 S_xxxxxxx 格式的 ID 后，" +
            "填入声音复刻页面的「音色槽位 ID」字段，或在 voice.env.local 中配置 VOLCENGINE_VOICECLONE_DEFAULT_SPEAKER_ID。",
        },
        { status: 400 },
      );
    }

    if (!title || !transcript || !(file instanceof File)) {
      return NextResponse.json({ error: "请完整填写标题、试听文本并上传音频文件" }, { status: 400 });
    }

    if (file.size > maxFileSizeBytes) {
      return NextResponse.json({ error: "上传音频不能超过 8MB" }, { status: 400 });
    }

    const format = getFileExtension(file.name);
    if (!supportedCloneFormats.includes(format as (typeof supportedCloneFormats)[number])) {
      return NextResponse.json(
        { error: "仅支持 wav、mp3、ogg、m4a、aac、pcm 格式" },
        { status: 400 },
      );
    }

    const cloneId = crypto.randomUUID();
    const now = new Date().toISOString();
    upsertClonedVoice({
      cloneId,
      title,
      speakerId,
      alias: title,
      status: "PENDING",
      language,
      modelType,
      sourceFileName: file.name,
      sourceFormat: format,
      transcript,
      demoAudioUrl: null,
      trainingVersion: null,
      availableTrainingTimes: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });

    let uploadResult;
    try {
      uploadResult = await uploadVoiceClone({
        speakerId,
        title,
        audioBuffer: Buffer.from(await file.arrayBuffer()),
        fileFormat: format as (typeof supportedCloneFormats)[number],
        transcript,
        language,
        modelType,
        enableDenoise,
      });
    } catch (uploadError) {
      deleteClonedVoice(cloneId);
      throw uploadError;
    }

    const status = await queryVoiceCloneStatus(uploadResult.speakerId).catch(() => null);
    const saved = upsertClonedVoice({
      cloneId,
      title,
      speakerId: uploadResult.speakerId,
      alias: title,
      status: status?.status ?? "TRAINING",
      language,
      modelType,
      sourceFileName: file.name,
      sourceFormat: format,
      transcript,
      demoAudioUrl: status?.demoAudioUrl ?? null,
      trainingVersion: status?.version ?? null,
      availableTrainingTimes: null,
      error: null,
      createdAt: now,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      clonedVoice: saved,
      runtime: {
        cloneEnabled: runtime.cloneEnabled,
        cloneResourceId: runtime.cloneResourceId,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "声音复刻提交失败" },
      { status: 500 },
    );
  }
}
