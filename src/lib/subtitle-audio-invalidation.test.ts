import test from "node:test";
import assert from "node:assert/strict";

import { resolveSubtitleAudioEditInvalidationScope } from "./subtitle-audio-invalidation";

test("resolveSubtitleAudioEditInvalidationScope 只改上屏分行时只让合成失效", () => {
  assert.equal(
    resolveSubtitleAudioEditInvalidationScope({
      textChanged: false,
      displayCuesChanged: true,
      visualStructureChanged: false,
    }),
    "composition_only",
  );
});

test("resolveSubtitleAudioEditInvalidationScope 改台词或视觉结构时让片段和合成都失效", () => {
  assert.equal(
    resolveSubtitleAudioEditInvalidationScope({
      textChanged: true,
      displayCuesChanged: false,
      visualStructureChanged: false,
    }),
    "clip_and_composition",
  );
  assert.equal(
    resolveSubtitleAudioEditInvalidationScope({
      textChanged: false,
      displayCuesChanged: true,
      visualStructureChanged: true,
    }),
    "clip_and_composition",
  );
});
