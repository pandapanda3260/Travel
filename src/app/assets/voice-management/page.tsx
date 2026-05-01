import { getVoiceManagementRuntime } from "../../../lib/voice-management-config";
import type { VoiceManagementInitialData } from "./voice-management-page-client";
import { VoiceManagementPageLoader } from "./voice-management-page-loader";

function buildVoiceRuntimePayload() {
  const runtime = getVoiceManagementRuntime();
  return {
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
  };
}

function buildEmptyPayload(): VoiceManagementInitialData {
  return {
    squarePage: {
      items: [],
      keyword: "",
      pagination: {
        page: 1,
        pageSize: 0,
        totalCount: 0,
        totalPages: 1,
      },
    },
    favoriteTimbres: [],
    clonedVoices: [],
    favoriteIds: [],
    membership: null,
    runtime: buildVoiceRuntimePayload(),
  };
}

export default function VoiceManagementPage() {
  let initialData = buildEmptyPayload();
  let initialError: string | null = null;

  try {
    initialData = buildEmptyPayload();
  } catch (error) {
    initialError = error instanceof Error ? error.message : "音色管理页面加载失败";
  }

  return <VoiceManagementPageLoader initialData={initialData} initialError={initialError} />;
}
