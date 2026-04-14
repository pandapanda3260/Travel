import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean, parseNumber } from "./env-file";

export type SpeechSynthesisRuntime = {
  liveEnabled: boolean;
  hasCredential: boolean;
  providerLabel: string;
  apiBase: string;
  appId: string;
  accessToken: string;
  resourceId: string;
  defaultVoiceId: string;
  defaultSampleRate: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  configFileName: string;
};

export function getSpeechSynthesisRuntime(): SpeechSynthesisRuntime {
  const localConfigFileName = "audio.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const appId = process.env.VOLCENGINE_AUDIO_APP_ID ?? localConfig.VOLCENGINE_AUDIO_APP_ID ?? "";
  const accessToken = process.env.VOLCENGINE_AUDIO_ACCESS_TOKEN ?? localConfig.VOLCENGINE_AUDIO_ACCESS_TOKEN ?? "";
  const apiBase =
    process.env.VOLCENGINE_AUDIO_API_BASE ??
    localConfig.VOLCENGINE_AUDIO_API_BASE ??
    "https://openspeech.bytedance.com";
  const resourceId =
    process.env.VOLCENGINE_AUDIO_RESOURCE_ID ?? localConfig.VOLCENGINE_AUDIO_RESOURCE_ID ?? "seed-tts-2.0";
  const defaultVoiceId =
    process.env.VOLCENGINE_AUDIO_VOICE_ID ?? localConfig.VOLCENGINE_AUDIO_VOICE_ID ?? "zh_female_vv_uranus_bigtts";
  const defaultSampleRate = parseNumber(
    process.env.VOLCENGINE_AUDIO_SAMPLE_RATE ?? localConfig.VOLCENGINE_AUDIO_SAMPLE_RATE,
    24000,
  ) as 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  const liveEnabled = parseBoolean(
    process.env.VOLCENGINE_AUDIO_LIVE_ENABLED ?? localConfig.VOLCENGINE_AUDIO_LIVE_ENABLED,
    false,
  );

  return {
    liveEnabled: liveEnabled && Boolean(appId) && Boolean(accessToken),
    hasCredential: Boolean(appId) && Boolean(accessToken),
    providerLabel: "火山引擎 · 豆包语音合成 2.0",
    apiBase,
    appId,
    accessToken,
    resourceId,
    defaultVoiceId,
    defaultSampleRate,
    configFileName,
  };
}
