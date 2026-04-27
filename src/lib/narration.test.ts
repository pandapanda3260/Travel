import test from "node:test";
import assert from "node:assert/strict";

import { normalizeNarrationSpokenText, sanitizeNarrationText } from "./narration";

test("normalizeNarrationSpokenText 会保留适合 TTS 的句末语气", () => {
  assert.equal(normalizeNarrationSpokenText(" 北京玩五天，有接送住得也舒服！ "), "北京玩五天，有接送住得也舒服！");
  assert.equal(
    normalizeNarrationSpokenText("Day2：落地就能安心入住。", { stripLeadingDayPrefix: true }),
    "落地就能安心入住。",
  );
});

test("sanitizeNarrationText 仍输出干净字幕文本", () => {
  assert.equal(
    sanitizeNarrationText(" 北京玩五天，有接送住得也舒服！ ", {
      stripLeadingDayPrefix: true,
    }),
    "北京玩五天，有接送住得也舒服",
  );
});
