export type SubtitleAudioEditInvalidationScope = "none" | "composition_only" | "clip_and_composition";

export function resolveSubtitleAudioEditInvalidationScope(input: {
  textChanged: boolean;
  displayCuesChanged: boolean;
  visualStructureChanged: boolean;
}): SubtitleAudioEditInvalidationScope {
  if (input.textChanged || input.visualStructureChanged) {
    return "clip_and_composition";
  }
  if (input.displayCuesChanged) {
    return "composition_only";
  }
  return "none";
}
