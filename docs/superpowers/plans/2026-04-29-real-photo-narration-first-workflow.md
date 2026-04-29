# Real Photo Narration-First Workflow Plan

## Goal

Upgrade the real-photo-to-video backend flow so spoken expression drives the video, instead of fixed shot durations forcing the narration to sound compressed or AI-like.

The new backend order is:

1. collect user information, prompt, template, product data, parameters, and uploaded/analyzed images;
2. build a material brief from the images and optional拆解视频素材;
3. create a narration blueprint first: audience hook, story beats, spoken lines, subtitle lines, and material intent;
4. derive shot plan and image-to-shot binding from that blueprint;
5. synthesize audio/subtitles from the blueprint text;
6. let final video segment durations follow narration/audio duration with provider-safe limits.

Frontend changes stay minimal: keep the current step layout and only surface backend-provided clarity where required.

## Constraints

- Keep the existing AI-image-to-video path stable.
- Apply the new orchestration only to `captured_material_first` workflows.
- Preserve current task records, draft bundle shape, and director plan compatibility.
- Do not remove existing fallback behavior.
- Existing dirty worktree changes are treated as user-owned and must not be reverted.

## Task 1: Add Pure Real-Photo Narration Workflow Logic

Files:

- `src/lib/real-photo-narration-workflow.ts`
- `src/lib/real-photo-narration-workflow.test.ts`
- `src/lib/video-task-schema.ts`

Steps:

1. Add schema types for material brief, narration beats, narration blueprint, and optional workflow metadata.
2. Write failing tests for:
   - narration beats using hook, context, evidence, offer/value, and action phases;
   - shot count staying no greater than usable material count when enough material exists;
   - shot durations derived from estimated narration reading duration;
   - image/material ids staying attached to the matching story beat.
3. Implement pure helpers and fallback logic.
4. Run the focused test file.

## Task 2: Connect Planner For Captured-Material Workflow

Files:

- `src/lib/video-task-planner.ts`
- focused planner tests, if existing coverage allows direct extension

Steps:

1. Detect `usesCapturedMaterialFirstWorkflow(...)` and route only that path through narration-first planning.
2. Build material brief and narration blueprint before shot-plan construction.
3. Enrich the shot plan with beat ids, source spoken text, subtitle text, and material binding.
4. Keep current hotel material planning as a compatibility enrichment, not the source of truth.
5. Run focused planner tests.

## Task 3: Make Subtitle/Audio Honor Narration Blueprint

Files:

- `src/app/api/video-tasks/[taskId]/subtitle-audio-run/route.ts`
- `src/lib/narration.ts` if helper extraction is needed

Steps:

1. When a director plan carries narration-first shot metadata, build narration draft clips from that metadata first.
2. Keep `spokenText` as the TTS source and `subtitleText` as the display source.
3. Avoid duration-only rewrites unless the audio is clearly impossible for provider limits.
4. Run focused subtitle/audio tests or type-level verification if no route test exists.

## Task 4: Let Video Segment Duration Follow Narration

Files:

- `src/lib/task-clip-store.ts`
- `src/app/api/video-tasks/[taskId]/clip-runs/route.ts`

Steps:

1. Prefer actual `audioDurationSeconds` for captured-material segment duration.
2. Fall back to planned narration duration and then shot duration.
3. Clamp only at video-provider capability boundaries.
4. Run focused clip/timeline tests.

## Task 5: Minimal Frontend Fit Check

Files:

- current real-photo page components only if backend fields need display support

Steps:

1. Avoid layout redesign.
2. Only adjust labels or field reads needed to display the new backend structure safely.
3. Run browser smoke on `/studio/task-creation/real-photo-video`.

## Final Verification

Run:

- focused new tests first;
- relevant existing workflow tests;
- `npm run typecheck`;
- targeted lint for touched files if practical;
- browser smoke if frontend was touched.
