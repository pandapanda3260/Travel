[OPEN] composition-duration-mismatch

# Debug Session

- Session ID: composition-duration-mismatch
- Started At: 2026-04-04
- Scope: 拼接结果文案调整 + 拼接成片总时长明显短于输入视频总时长

## Symptoms

- “拼接输出结果”文案需要改成“拼接结果”
- 拼接结果列表中“3 段”后面需要补充总秒数
- 用户选了 3 个视频，总时长约 40s，但拼接后成片只有 14s

## Hypotheses

1. 拼接时用于 FFmpeg 的输入文件被规范化时裁成了固定 4-5 秒片段，导致总时长显著缩短。
2. 拼接 UI 显示的片段时长来自生成参数或历史记录，不是真实视频文件时长，所以列表总秒数与最终成片不一致。
3. 淡入淡出交叉拼接时重复使用了错误的 offset / duration 参数，导致后续片段被大量覆盖。
4. 某些本地或远程视频源在下载/归一化时丢失了尾部内容，实际进入拼接链路的时长就只有 14s。
5. 当前 store 中 segments 的 `durationSeconds` 多为 `null`，页面和拼接逻辑都没有统一以真实媒体元数据为准。

## Evidence

- 当前问题拼接项目 [video-compositions.json](file:///Users/bytedance/Documents/trae_projects/Travel/data/video-compositions.json#L124-L175) 为 `dae854df-871b-436d-b630-071acd9fc9f5`，3 段、`fade`、记录中仅第一段有 `durationSeconds = 10`，后两段为 `null`。
- 对应 3 个源视频真实时长：
  - `019d492a-ac7c-74c3-a6c9-8ee485faee7d` → `00:00:10.04`
  - `019d4746-b159-7141-9de9-69d7cef1e02d` → `00:00:05.04`
  - `019d46a8-e511-7fa3-b481-ab0353937fd8` → `00:00:05.04`
- 当前成片真实时长：
  - `dae854df-871b-436d-b630-071acd9fc9f5.mp4` → `00:00:14.44`
- [crossfadeSegments](file:///Users/bytedance/Documents/trae_projects/Travel/src/lib/video-composition-runner.ts#L152-L203) 用 `segments[index]?.durationSeconds ?? 15` 计算累计时长；在本案例中会把后两段错误当成 15s，导致第二次 `xfade offset` 明显超出第一轮结果时长。

## Findings

1. 假设 2 成立：UI / job 里的总秒数来自记录值，不是真实时长。
2. 假设 3 成立：淡入淡出拼接使用了错误的时长基准，第二次 `offset` 被算大。
3. 假设 5 成立：`durationSeconds` 缺失时退回 15s 是当前总时长错误和成片过短的共同根因。
4. 最小修复方向：
   - 在拼接前探测每段真实媒体时长并写回 `segments.durationSeconds`
   - `crossfadeSegments` 用真实时长计算 offset
   - 列表中展示“段数 + 总秒数”时也使用真实值或归一化后的记录值

## Fix Progress

- 已将列表标题从“拼接输出结果”调整为“拼接结果”。
- 已在拼接结果卡片与详情元信息中补充“段数 + 秒数”显示。
- 已在拼接前对归一化后的每段视频做真实时长探测，并把结果写回 `segments.durationSeconds`。
- 已修复 `crossfadeSegments` 使用默认 `15s` 估算导致的错误 offset 计算。
- 复测新任务 `15b2bc11-8477-4c1a-9f9a-20f2715473e1`：
  - 片段时长：`10.04s + 5.04s + 5.04s`
  - 输出时长：`18.92s`
  - 与 `fade` 两次 0.6s 过渡后的预期结果一致。
