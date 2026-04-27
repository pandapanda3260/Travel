import {
  getDefaultTaskCreationParameterState,
  hydrateTaskCreationParameterState,
  imageGuidanceOptions,
  type TaskCreationParameterState,
  videoCameraControlOptions,
  videoCfgScaleOptions,
  videoModeOptions,
} from "./task-creation-parameters";

export const parameterSettingsStorageKey = "system-parameter-settings";

export type ParameterSettingsState = Pick<
  TaskCreationParameterState,
  | "imageGuidanceScale"
  | "imageSeedMode"
  | "imageSeedValue"
  | "videoMode"
  | "videoCfgScale"
  | "videoCameraControl"
  | "videoNegativePrompt"
>;

export function getDefaultParameterSettingsState(): ParameterSettingsState {
  const defaults = getDefaultTaskCreationParameterState();
  return {
    imageGuidanceScale: defaults.imageGuidanceScale,
    imageSeedMode: defaults.imageSeedMode,
    imageSeedValue: defaults.imageSeedValue,
    videoMode: defaults.videoMode,
    videoCfgScale: defaults.videoCfgScale,
    videoCameraControl: defaults.videoCameraControl,
    videoNegativePrompt: defaults.videoNegativePrompt,
  };
}

export function hydrateParameterSettingsState(rawDraft: unknown): ParameterSettingsState {
  const defaults = getDefaultParameterSettingsState();
  const draft = typeof rawDraft === "object" && rawDraft ? (rawDraft as Partial<ParameterSettingsState>) : {};

  return {
    imageGuidanceScale: imageGuidanceOptions.some((item) => item.value === draft.imageGuidanceScale)
      ? (draft.imageGuidanceScale as ParameterSettingsState["imageGuidanceScale"])
      : defaults.imageGuidanceScale,
    imageSeedMode: draft.imageSeedMode === "fixed" ? "fixed" : defaults.imageSeedMode,
    imageSeedValue: draft.imageSeedValue ?? defaults.imageSeedValue,
    videoMode: videoModeOptions.some((item) => item.value === draft.videoMode)
      ? (draft.videoMode as ParameterSettingsState["videoMode"])
      : defaults.videoMode,
    videoCfgScale: videoCfgScaleOptions.includes(draft.videoCfgScale as ParameterSettingsState["videoCfgScale"])
      ? (draft.videoCfgScale as ParameterSettingsState["videoCfgScale"])
      : defaults.videoCfgScale,
    videoCameraControl: videoCameraControlOptions.some((item) => item.value === draft.videoCameraControl)
      ? (draft.videoCameraControl as ParameterSettingsState["videoCameraControl"])
      : defaults.videoCameraControl,
    videoNegativePrompt: draft.videoNegativePrompt ?? defaults.videoNegativePrompt,
  };
}

export function serializeParameterSettingsState(state: ParameterSettingsState) {
  return JSON.stringify(state);
}

export function readParameterSettingsState(storage: Pick<Storage, "getItem">): ParameterSettingsState {
  try {
    const rawValue = storage.getItem(parameterSettingsStorageKey);
    if (!rawValue) {
      return getDefaultParameterSettingsState();
    }

    return hydrateParameterSettingsState(JSON.parse(rawValue));
  } catch {
    return getDefaultParameterSettingsState();
  }
}

export function applyParameterSettingsToTaskCreationState(
  state: TaskCreationParameterState,
  settings: ParameterSettingsState,
) {
  return hydrateTaskCreationParameterState({
    ...state,
    ...settings,
  });
}
