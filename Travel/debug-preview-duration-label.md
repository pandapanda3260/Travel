[OPEN] preview-duration-label

# Debug Session

- Session ID: preview-duration-label
- Started At: 2026-04-04
- Scope: 预览与参数区显示 15s，但当前视频实际只有 5s

## Symptoms

- 任务列表选中某条视频后，右侧预览区“时长”显示 `15s`
- 用户确认该视频实际只有 `5s`

## Hypotheses

1. 预览区“时长”使用的是生成参数 `generationSettings.durationSeconds`，不是视频真实媒体时长。
2. 这条任务创建时沿用了默认生成参数 `15s`，即使最终产出只有 5s，前端仍显示默认值。
3. 任务状态刷新接口没有回填真实媒体时长，所以 UI 一直拿旧参数展示。
4. 本地缓存远程视频后，真实时长并没有同步探测并写回 job store。

## Evidence

- 预览参数区的“时长”直接读取 [page.tsx](file:///Users/bytedance/Documents/trae_projects/Travel/src/app/page.tsx#L437-L446) 中的 `effectiveSettings.durationSeconds`，不是媒体真实时长。
- `effectiveSettings` 优先取 `job.generationSettings`，否则回退到页面本地默认值；见 [page.tsx](file:///Users/bytedance/Documents/trae_projects/Travel/src/app/page.tsx#L407-L416)。
- 当前这条任务 `019d46a8-e511-7fa3-b481-ab0353937fd8` 在 `video-jobs.json` 里 `generationSettings = null`，因此 UI 会落回默认值。
- 同一文件对应本地视频真实时长经 FFmpeg 检测为 `00:00:05.04`。

## Findings

1. 假设 1 成立：UI 显示的是“参数时长”，不是“真实视频时长”。
2. 假设 2 成立：这条任务没有 `generationSettings`，所以页面回退到默认 `15s`。
3. 假设 3 成立：任务刷新链路没有把真实媒体时长同步回 job 记录。
4. 最小修复方向：
   - 为 job 增加 `resolvedDurationSeconds`
   - 已完成任务读取本地/远程视频时探测真实时长并写回
   - 预览区优先展示 `resolvedDurationSeconds`，没有时再退回参数时长
