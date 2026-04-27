import { parseIndexedTextBlocks } from "./indexed-text-blocks";
import type { ShotPlan, ShotPlanItem } from "./video-task-schema";

export type NarrationScriptLine = {
  label: string;
  index: number;
  scope: "segment" | "shot";
  shotIndex: number;
  segmentIndex: number;
  text: string;
};

export function getShotsForNarrationSegment(shotPlan?: ShotPlan | null, segmentIndex?: number | null) {
  if (!shotPlan?.shots?.length || !segmentIndex) {
    return [] as ShotPlanItem[];
  }

  return shotPlan.shots
    .filter((shot) => (shot.segmentIndex ?? shot.shotIndex) === segmentIndex)
    .sort((left, right) => left.shotIndex - right.shotIndex);
}

export function parseNarrationScriptLines(script: string, shotPlan?: ShotPlan | null): NarrationScriptLine[] {
  return parseIndexedTextBlocks(script, Math.max(1, shotPlan?.shots?.length ?? 1), "镜头").map((block) => {
    if (block.label === "片段") {
      const segmentIndex = block.rawIndex || block.index;
      const segmentShots = getShotsForNarrationSegment(shotPlan, segmentIndex);
      const anchorShot = segmentShots[0] ?? null;
      return {
        label: block.label,
        index: segmentIndex,
        scope: "segment" as const,
        shotIndex: anchorShot?.shotIndex ?? segmentIndex,
        segmentIndex,
        text: block.text,
      };
    }

    const shotIndex = block.index;
    const anchorShot = shotPlan?.shots.find((shot) => shot.shotIndex === shotIndex) ?? null;
    return {
      label: block.label,
      index: block.rawIndex || block.index,
      scope: "shot" as const,
      shotIndex,
      segmentIndex: anchorShot?.segmentIndex ?? shotIndex,
      text: block.text,
    };
  });
}

export function formatNarrationScriptLines(lines: NarrationScriptLine[]) {
  return lines.map((line) => `${line.label}${line.index}：${line.text}`).join("\n");
}
