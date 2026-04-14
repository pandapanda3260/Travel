import { loadOptionalEnvFile } from "./env-file";

export type VoiceManagementRuntime = {
  timbreApiEnabled: boolean;
  cloneEnabled: boolean;
  timbreLibraryRefreshIntervalMs: number;
  openApiHost: string;
  openApiRegion: string;
  openApiService: string;
  openApiAccessKey: string;
  openApiSecretKey: string;
  openApiProjectName: string;
  appId: string;
  accessToken: string;
  cloneResourceId: string;
  defaultCloneSpeakerId: string;
  configFileName: string;
};

export function getVoiceManagementRuntime(): VoiceManagementRuntime {
  const configFileName = "voice.env.local";
  const localConfig = loadOptionalEnvFile(configFileName);
  const openApiAccessKey =
    process.env.VOLCENGINE_SPEECH_OPENAPI_ACCESS_KEY ??
    localConfig.VOLCENGINE_SPEECH_OPENAPI_ACCESS_KEY ??
    "";
  const openApiSecretKey =
    process.env.VOLCENGINE_SPEECH_OPENAPI_SECRET_KEY ??
    localConfig.VOLCENGINE_SPEECH_OPENAPI_SECRET_KEY ??
    "";
  const openApiProjectName =
    process.env.VOLCENGINE_SPEECH_OPENAPI_PROJECT_NAME ??
    localConfig.VOLCENGINE_SPEECH_OPENAPI_PROJECT_NAME ??
    "";
  const appId = process.env.VOLCENGINE_AUDIO_APP_ID ?? localConfig.VOLCENGINE_AUDIO_APP_ID ?? "";
  const accessToken =
    process.env.VOLCENGINE_AUDIO_ACCESS_TOKEN ?? localConfig.VOLCENGINE_AUDIO_ACCESS_TOKEN ?? "";
  const cloneResourceId =
    process.env.VOLCENGINE_VOICECLONE_RESOURCE_ID ??
    localConfig.VOLCENGINE_VOICECLONE_RESOURCE_ID ??
    "seed-icl-2.0";
  const defaultCloneSpeakerId =
    process.env.VOLCENGINE_VOICECLONE_DEFAULT_SPEAKER_ID ??
    localConfig.VOLCENGINE_VOICECLONE_DEFAULT_SPEAKER_ID ??
    "";
  const timbreLibraryRefreshIntervalHours = Number(
    process.env.VOLCENGINE_TIMBRE_LIBRARY_REFRESH_INTERVAL_HOURS ??
      localConfig.VOLCENGINE_TIMBRE_LIBRARY_REFRESH_INTERVAL_HOURS ??
      "6",
  );
  const normalizedRefreshIntervalHours =
    Number.isFinite(timbreLibraryRefreshIntervalHours) && timbreLibraryRefreshIntervalHours > 0
      ? timbreLibraryRefreshIntervalHours
      : 6;

  return {
    timbreApiEnabled: Boolean(openApiAccessKey && openApiSecretKey),
    cloneEnabled: Boolean(appId && accessToken),
    timbreLibraryRefreshIntervalMs: normalizedRefreshIntervalHours * 60 * 60 * 1000,
    openApiHost:
      process.env.VOLCENGINE_SPEECH_OPENAPI_HOST ??
      localConfig.VOLCENGINE_SPEECH_OPENAPI_HOST ??
      "open.volcengineapi.com",
    openApiRegion:
      process.env.VOLCENGINE_SPEECH_OPENAPI_REGION ??
      localConfig.VOLCENGINE_SPEECH_OPENAPI_REGION ??
      "cn-beijing",
    openApiService:
      process.env.VOLCENGINE_SPEECH_OPENAPI_SERVICE ??
      localConfig.VOLCENGINE_SPEECH_OPENAPI_SERVICE ??
      "speech_saas_prod",
    openApiAccessKey,
    openApiSecretKey,
    openApiProjectName,
    appId,
    accessToken,
    cloneResourceId,
    defaultCloneSpeakerId,
    configFileName,
  };
}
