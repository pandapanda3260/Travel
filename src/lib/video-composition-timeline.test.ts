import test from "node:test";
import assert from "node:assert/strict";

import { buildSubtitleAssPosition, findNarrationClipsForSegment } from "./video-composition-timeline";
import { buildSubtitleCuesFromNarrationClips } from "./subtitle-export";
import type { NarrationDraftClip } from "./narration";

function buildNarrationClip(
  input: Partial<NarrationDraftClip> & Pick<NarrationDraftClip, "id" | "shotIndex">,
): NarrationDraftClip {
  return {
    id: input.id,
    cueId: input.cueId ?? input.id,
    shotIndex: input.shotIndex,
    segmentId: input.segmentId ?? null,
    segmentIndex: input.segmentIndex ?? input.shotIndex,
    bindToSegmentId: input.bindToSegmentId ?? null,
    startAtSeconds: input.startAtSeconds ?? 0,
    durationSeconds: input.durationSeconds ?? 5,
    audioDurationSeconds: input.audioDurationSeconds ?? 4,
    characterFocus: input.characterFocus ?? "旁白",
    visualFocus: input.visualFocus ?? "",
    fullSemanticSentence: input.fullSemanticSentence ?? null,
    narrationText: input.narrationText ?? input.id,
    spokenText: input.spokenText ?? input.narrationText ?? input.id,
    subtitleText: input.subtitleText ?? input.narrationText ?? input.id,
    note: input.note ?? input.id,
    hasVoice: input.hasVoice ?? true,
    hasSubtitle: input.hasSubtitle ?? true,
    requiresLipSync: input.requiresLipSync ?? false,
    voiceId: input.voiceId ?? null,
    audioUrl: input.audioUrl ?? `/audio/${input.id}.mp3`,
    words: input.words ?? [],
  };
}

test("findNarrationClipsForSegment 不会把上一段同 shotIndex 的口播错误挂到下一段", () => {
  const clips = [
    buildNarrationClip({
      id: "segment-2",
      shotIndex: 3,
      segmentId: "segment-2",
      segmentIndex: 2,
      narrationText: "片段二",
    }),
    buildNarrationClip({
      id: "segment-3",
      shotIndex: 5,
      segmentId: "segment-3",
      segmentIndex: 3,
      narrationText: "片段三",
    }),
  ];

  const matched = findNarrationClipsForSegment(clips, {
    segmentId: "segment-3",
    segmentIndex: 3,
    shotIndex: 3,
  });

  assert.deepEqual(
    matched.map((clip) => clip.id),
    ["segment-3"],
  );
});

test("findNarrationClipsForSegment 会兼容只有 shotIndex 的极旧口播记录", () => {
  const clips = [
    buildNarrationClip({
      id: "legacy-only-shot",
      shotIndex: 4,
      segmentId: null,
      segmentIndex: null,
      bindToSegmentId: null,
    }),
  ];

  const matched = findNarrationClipsForSegment(clips, {
    segmentId: "segment-4",
    segmentIndex: 4,
    shotIndex: 4,
  });

  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.id, "legacy-only-shot");
});

test("buildSubtitleAssPosition 会把预览比例稳定换成 ASS 像素坐标", () => {
  assert.deepEqual(
    buildSubtitleAssPosition({
      frameWidth: 720,
      frameHeight: 1280,
      positionOffsetRatio: 0.3,
      horizontalPositionRatio: 0.5,
    }),
    {
      x: 360,
      y: 896,
    },
  );

  assert.deepEqual(
    buildSubtitleAssPosition({
      frameWidth: 720,
      frameHeight: 1280,
      positionOffsetRatio: 0.22,
      horizontalPositionRatio: 0.68,
    }),
    {
      x: 490,
      y: 998,
    },
  );
});

test("buildSubtitleCuesFromNarrationClips 会把片段内相对起点展开成连续时间轴", () => {
  const clips = [
    buildNarrationClip({
      id: "segment-1",
      shotIndex: 1,
      segmentId: "segment-1",
      segmentIndex: 1,
      startAtSeconds: 0,
      durationSeconds: 5,
      audioDurationSeconds: 4,
      narrationText: "第一句完整台词",
    }),
    buildNarrationClip({
      id: "segment-2",
      shotIndex: 2,
      segmentId: "segment-2",
      segmentIndex: 2,
      startAtSeconds: 0,
      durationSeconds: 6,
      audioDurationSeconds: 5,
      narrationText: "第二句完整台词",
    }),
  ];

  const cues = buildSubtitleCuesFromNarrationClips(clips);

  assert.equal(cues[0]?.startAtSeconds, 0);
  assert.equal(cues[0]?.endAtSeconds, 4);
  assert.equal(cues[1]?.startAtSeconds, 5);
  assert.equal(cues[1]?.endAtSeconds, 10);
});

test("buildSubtitleCuesFromNarrationClips 保留已展开的绝对时间轴", () => {
  const clips = [
    buildNarrationClip({
      id: "segment-1",
      shotIndex: 1,
      segmentId: "segment-1",
      segmentIndex: 1,
      startAtSeconds: 0,
      durationSeconds: 5,
      audioDurationSeconds: 4,
    }),
    buildNarrationClip({
      id: "segment-2",
      shotIndex: 2,
      segmentId: "segment-2",
      segmentIndex: 2,
      startAtSeconds: 5.2,
      durationSeconds: 6,
      audioDurationSeconds: 5,
    }),
  ];

  const cues = buildSubtitleCuesFromNarrationClips(clips);

  assert.equal(cues[0]?.startAtSeconds, 0);
  assert.equal(cues[1]?.startAtSeconds, 5.2);
});

test("buildSubtitleCuesFromNarrationClips 优先使用完整语义句而不是旧字幕摘要", () => {
  const cues = buildSubtitleCuesFromNarrationClips([
    buildNarrationClip({
      id: "unified-text",
      shotIndex: 1,
      fullSemanticSentence: "杭州这家全新开业亲子度假村真的太适合遛娃了",
      narrationText: "杭州这家全新开业亲子度假村真的太适合遛娃了",
      spokenText: "杭州这家全新开业亲子度假村真的太适合遛娃了",
      subtitleText: "亲子度假首选",
    }),
  ]);

  assert.equal(cues[0]?.text, "杭州这家全新开业亲子度假村真的太适合遛娃了");
  assert.equal(cues[0]?.text.includes("亲子度假首选"), false);
});
