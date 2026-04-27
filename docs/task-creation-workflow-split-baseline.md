# 任务创建工作流拆分基线

记录日期：2026-04-27

本基线用于拆分“AI 素材成片”和“实拍素材成片”前后的自检对照。改造原则是保留现有任务数据结构、接口链路、任务列表交互和生成能力，只在页面入口、工作流归类、文案和安全自检层做低风险增量。

## 现有工作流事实

- 任务创建主页面：`src/app/studio/task-creation/page.tsx`
- 页面级初始数据：`src/app/studio/task-creation/layout.tsx` -> `getTaskCreationIndexPayload()`
- 当前显式可见视频类型：`hotel_explore_roaming_voiceover`、`agency_guide_voiceover`、`retail_explore_presenter_narration`
- 任务类型配置：`src/lib/video-task-schema.ts`
- 当前底层工作流枚举：`visual_reference_first`、`captured_material_first`
- 默认工作流：未显式声明 `workflowKind` 的视频类型走 `visual_reference_first`
- 当前显式素材优先类型：`hotel_explore_roaming_voiceover`、`hotel_explore_roaming_silent`
- 酒店素材上传组件：`src/app/studio/task-creation/_components/hotel-asset-panel.tsx`
- 酒店素材上传前会通过 `ensure_input_task` 创建输入草稿，再上传到 `/api/video-tasks/[taskId]/hotel-assets`
- 酒店/素材类任务的素材真正进入镜头规划发生在 `/api/video-tasks/[taskId]/shot-plan-run`，该接口会读取 `listTaskHotelAssets(taskId)`
- 新建任务接口 `/api/video-tasks` 不读取 `task-hotel-assets`，因此实拍素材流程天然依赖“先草稿、后上传、再重建规划”

## AI 素材成片链路

目标用户心智：输入商品/线路信息和提示词，由 AI 规划镜头、生成参考图，再图生视频。

当前主要链路：

1. 页面输入商品信息、用户提示词、优化提示词、视频参数。
2. `POST /api/video-tasks` 或 `POST /api/video-tasks/[taskId]/shot-plan-run` 生成镜头规划。
3. `POST /api/video-tasks/[taskId]/key-materials` 串联字幕音频和视觉图片。
4. `POST /api/video-tasks/[taskId]/visual-images` 生成参考图、手动补图、选图。
5. `POST /api/video-tasks/[taskId]/clip-runs` 使用选中图片生成视频片段。
6. `POST /api/video-tasks/[taskId]/video-generation` 管理片段生成到合成的总流程。
7. `POST /api/video-tasks/[taskId]/composition-runs` 合成成片。

保留要求：

- 保留商品信息、提示词、提示词优化、镜头规划、字幕音频、参考图生成/选图、手动上传图片、片段生成、合成、重跑和删除。
- 不把酒店实拍图上传模块暴露为主路径。
- 不改变现有后端接口名称和任务状态枚举。

## 实拍素材成片链路

目标用户心智：先提供实拍图片或实拍视频素材，系统基于真实素材规划镜头、绑定素材，再生成/裁切视频。

当前主要链路：

1. 页面选择素材优先类型后，`HotelAssetPanel` 可见。
2. 上传实拍图时，如果还没有任务，先调用 `POST /api/video-tasks` + `action: ensure_input_task` 创建草稿任务。
3. 实拍图上传到 `POST /api/video-tasks/[taskId]/hotel-assets`，并异步分析图片场景、质量、商业分。
4. 用户生成/更新镜头规划时，`POST /api/video-tasks/[taskId]/shot-plan-run` 读取酒店素材，并通过 `applyHotelAssetPlanning()` 绑定素材。
5. 视觉阶段对 `captured_material_first` 类型会先同步素材镜头；如果素材足够，可走 `photo_direct_i2v` 或 `photo_enhanced_i2v`，不足时可回落到 `ai_generated_broll`。
6. 片段阶段如果来源镜头都来自同一个视频素材，可用 `resolveDirectMaterialClipPlan()` 做实拍视频直出裁切；否则继续走图生视频。

保留要求：

- 保留酒店实拍图上传、替换、删除、排序、场景类型、备注、自动分析、重分析。
- 保留参考视频素材选择、视频拆解、抽帧、清洗图和视频素材直出能力。
- 保留素材不足时的 AI 兜底，不做硬删除或硬失败。
- 页面文案应从“参考图生成”逐步调整为“素材镜头同步/确认”，但底层 `visual-images` 接口暂不改名。

## 任务列表和路由要求

- 不新增独立任务工作台。
- 任务列表继续放在对应工作流页面内。
- 任务列表样式、任务选中、URL `taskId` 恢复、草稿恢复、继续生成、删除任务逻辑沿用现有交互。
- 新入口建议：
  - `/studio/task-creation/ai-image-video`：AI 素材成片
  - `/studio/task-creation/real-photo-video`：实拍素材成片
- `/studio/task-creation` 保持兼容，初期可继续展示原页面或跳转默认模式，避免旧链接失效。

## 自检与安全修复策略

只读自检可以自动执行，破坏性修复必须用户确认。

自动安全自检：

- 根据 `videoType`、`workflowKind`、是否存在酒店素材、是否存在参考视频素材推断任务所属工作流。
- 页面加载时检查当前任务是否属于当前工作流页面。
- 检查运行中 stage progress 是否与 workflow 记录一致。
- 检查视觉阶段已完成但仍有陈旧错误时，优先隐藏或提示刷新，不自动删除产物。
- 检查已有素材候选但选图状态缺失时，允许同步候选状态。

需要用户确认的修复：

- 重建镜头规划。
- 清空或重置下游关键素材、片段、合成产物。
- 删除任务、删除素材、删除生成文件。
- 重新调用模型生成图片、视频、字幕或分析素材。

## 当前本地数据快照

基于 `data/app.db` 的只读查询：

- `video-tasks`：3 条
- `agency_guide_voiceover`：1 条
- `hotel_explore_roaming_voiceover`：2 条
- `task-hotel-assets`：30 条
- `task-visual-image-shots`：35 条
- `task-stage-progress`：7 条
- `key-material-workflows`：2 条
- `video-generation-workflows`：1 条
- `video-materials`：11 条

## 每步验证清单

每完成一个增量后至少检查：

1. `npm run typecheck`
2. 与本次 touched 文件相关的测试，优先运行：
   - `npm test`
   - 或定向 `tsx --test src/lib/task-creation-parameters.test.ts ...`
3. 后端链路静态检查：
   - `/api/video-tasks`
   - `/api/video-tasks/[taskId]/shot-plan-run`
   - `/api/video-tasks/[taskId]/key-materials`
   - `/api/video-tasks/[taskId]/visual-images`
   - `/api/video-tasks/[taskId]/clip-runs`
   - `/api/video-tasks/[taskId]/video-generation`
4. 页面路由检查：
   - `/studio/task-creation`
   - `/studio/task-creation/ai-image-video`
   - `/studio/task-creation/real-photo-video`
