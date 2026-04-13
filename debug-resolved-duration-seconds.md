[OPEN] resolved-duration-seconds

# Debug Session

- Session ID: resolved-duration-seconds
- Started At: 2026-04-04
- Scope: 为视频任务补充 `resolvedDurationSeconds`，并让预览区优先显示真实时长

## Symptoms

- 老任务缺少 `generationSettings`
- 预览区时长回退到默认 `15s`
- 实际视频只有 `5.04s`

## Hypotheses

1. 预览区当前只读 `generationSettings.durationSeconds`，没有真实媒体时长字段。
2. 任务存储层缺少 `resolvedDurationSeconds`，导致老任务无法显示真实时长。
3. 已完成任务的本地缓存链路已经有视频文件，但没有顺手探测并回填真实时长。
4. 任务列表接口和单任务接口都没有统一做“缓存 + 探测 + 持久化”。
5. 只修前端显示不够，必须同时更新老任务数据，否则刷新后仍会回到错误值。

## Evidence

- 任务存储定义原先只有 `generationSettings`，没有真实媒体时长字段；见 [video-job-store.ts](file:///Users/bytedance/Documents/trae_projects/Travel/src/lib/video-job-store.ts#L15-L37)。
- 预览区时长原先直接读取 `effectiveSettings.durationSeconds`；见 [page.tsx](file:///Users/bytedance/Documents/trae_projects/Travel/src/app/page.tsx#L444-L475)。
- 老任务 `019d46a8-e511-7fa3-b481-ab0353937fd8` 在 `video-jobs.json` 中原本 `generationSettings = null`，因此 UI 会回退默认 `15s`。
- 该任务本地视频真实时长经 FFmpeg 探测为 `5.04s`。
- 修复后，`/api/videos` 返回和 `data/video-jobs.json` 持久化中都已写入：
  - `resolvedDurationSeconds: 5.04`
  - `videoUrl: /generated-videos/019d46a8-e511-7fa3-b481-ab0353937fd8.mp4`

## Findings

1. 假设 1 成立：预览区原先只读参数时长。
2. 假设 2 成立：没有 `resolvedDurationSeconds` 是老任务显示错误的直接原因。
3. 假设 3 成立：已完成任务本地缓存链路缺少真实时长探测。
4. 假设 4 成立：两个视频接口都需要统一做“缓存 + 时长探测 + 回填”。
5. 假设 5 成立：只有把老任务数据写回 store，刷新后才能稳定显示真实时长。

## Fix Progress

- 已为任务记录新增 `resolvedDurationSeconds` 字段。
- 已在已完成视频任务读取链路中加入真实媒体时长探测和持久化。
- 已让 `/api/videos` 和 `/api/videos/[jobId]` 在返回前自动补齐老任务的 `resolvedDurationSeconds`。
- 已将预览区“时长”显示改为优先使用真实时长，缺失时再回退参数时长。
