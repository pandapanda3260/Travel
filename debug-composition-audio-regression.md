[OPEN] composition-audio-regression

# 问题
- 上一轮修复后，视频合成不再截断片段 5 结尾，但最终成片没有声音。
- 目标：在不重新引入“片段尾部被截短”问题的前提下，恢复正确的音频输出，并理清 `audioMode`、原音、解说、背景音乐在合成链路中的真实行为。

# 假设
- 假设 1：片段生成阶段“静音”只代表分镜视频源文件无音轨，而最终合成阶段应把单独生成的 narration 音频重新混入；当前实现把这两个概念混淆了。
- 假设 2：基础拼接阶段在 `keepSourceAudio = false` 时已经显式 `-an` 去掉了片段原音，所以最终成片是否有声，完全取决于 narration / bgm 是否被正确接入。
- 假设 3：`composition-runs` 路由在创建 composition 记录时，把 `audioMode` 设成了 `mute` 或 `bgm_only`，但同时又总是构造 narration track，导致 `audioMode` 与 `audioPlan.tracks` 语义冲突。
- 假设 4：真正正确的业务语义应当是“最终合成默认接入单独生成的 narration；如果有 BGM 再叠加 BGM”，而不是靠 `audioMode = mute` 控制 narration 是否存在。
- 假设 5：除了 `applyAudioPlan`，`concatSegments` / `crossfadeSegments` 阶段也根据错误的 `keepSourceAudio` 逻辑提前去掉了所有音轨，使后续一旦跳过 narration 混音就必然无声。

# 计划
- 先补充最小化日志，记录 `audioMode`、`keepSourceAudio`、基础拼接是否带原音、最终是否进入音频混音。
- 基于日志明确“无声”是在哪一层被去掉，再做最小但完整的修复。

# 证据
- `composition payload audio plan created` 日志显示：
  - `audioMode = "mute"`
  - 但 `audioPlanMode = "multi_track"`
  - 且 `trackKinds = ["narration"]`
- `composeVideoProject audio mode resolved` 日志显示：
  - `audioMode = "mute"`
  - `keepSourceAudio = false`
  - `trackKinds = ["narration"]`
- `concatSegments invoked` 日志显示：
  - `keepSourceAudio = false`
  - 基础拼接阶段明确走无音轨视频输出
- `applyAudioPlan entry` 日志显示：
  - `enabledTrackKinds = ["narration"]`
  - 说明解说音轨其实已经准备好了
- 但紧接着 `applyAudioPlan returned early because audioMode is mute`
  - 说明不是解说不存在，而是被错误的 `audioMode = mute` 条件直接拦掉了

# 结论
- 根因不是“没有解说音频文件”，也不是“片段原视频没声音”。
- 根因是：composition 创建阶段把“只有视频片段静音”错误编码成了最终成片的 `audioMode = mute`。
- 结果导致：
  - 基础拼接阶段先去掉所有源音轨（这是符合当前片段视频无声的事实）
  - 后续 narration 音轨虽然存在，却又在 `applyAudioPlan` 里被 `audioMode = mute` 提前跳过
  - 所以最终成片无声
- 真正正确的逻辑应该是：
  - 当前任务的 composition 默认模式应是 `narration_only`
  - 有背景音乐时应是 `narration_with_bgm`
  - 最终导出时 narration 要按视频总时长补齐静音，而不是再用 `-shortest` 把视频截短
