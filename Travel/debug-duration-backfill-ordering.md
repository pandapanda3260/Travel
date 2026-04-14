[OPEN] duration-backfill-ordering

# Debug Session

- Session ID: duration-backfill-ordering
- Started At: 2026-04-04
- Scope: 回填真实时长不应改动任务排序；Timeline 素材池仍显示旧错误时长

## Symptoms

- 回填真实时长后，不希望 `updatedAt` 被改动，避免影响任务排序
- Timeline 素材池中部分视频仍显示旧的 `10s / 15s` 参数时长，而不是真实时长

## Hypotheses

1. `patchVideoJob` 默认总会刷新 `updatedAt`，导致任何元数据回填都会影响列表排序。
2. Timeline 素材池读取的视频时长仍然来自 `generationSettings.durationSeconds`，没有关联到 `resolvedDurationSeconds`。
3. 任务列表右侧预览区已经切到真实时长，但 Timeline 可选视频卡片仍走另一套展示逻辑。
4. 老任务数据虽已写入 `resolvedDurationSeconds`，但 Timeline 所用的列表数据没有刷新到该字段。
5. 若只修前端展示、不控制 `updatedAt` 更新策略，后续任意元数据补齐仍会继续打乱排序。

## Evidence

- `patchVideoJob` 默认会把 `updatedAt` 设为当前时间；见 [video-job-store.ts](file:///Users/bytedance/Documents/trae_projects/Travel/src/lib/video-job-store.ts#L180-L197)。
- Timeline 素材池卡片的秒数原先直接显示 [page.tsx](file:///Users/bytedance/Documents/trae_projects/Travel/src/app/page.tsx#L1614-L1617) 中的 `row.generationSettings?.durationSeconds ?? 15`。
- 当前任务列表接口已经能返回 `resolvedDurationSeconds`，但 Timeline 卡片没有用这个字段。
- 修复后再次调用 `/api/videos`，同一条已完成任务 `019d4746-b159-7141-9de9-69d7cef1e02d` 的 `updatedAt` 保持不变，同时 `resolvedDurationSeconds` 正常为 `5.04`。

## Findings

1. 假设 1 成立：默认 patch 行为确实会改 `updatedAt`。
2. 假设 2 和 3 成立：Timeline 素材池仍使用旧的参数时长展示逻辑。
3. 假设 4 成立：接口已有 `resolvedDurationSeconds`，但前端卡片未关联。
4. 修复方向应为：
   - 元数据回填时显式保留原 `updatedAt`
   - Timeline 素材池优先展示 `resolvedDurationSeconds`

## Fix Progress

- 已让本地缓存和真实时长回填在 patch 时显式保留原 `updatedAt`。
- 已修复 Timeline 素材池秒数展示逻辑，优先显示真实时长。
- 已验证重复调用 `/api/videos` 后，老任务 `updatedAt` 不再变化，`resolvedDurationSeconds` 与接口返回一致。
