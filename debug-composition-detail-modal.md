[OPEN] composition-detail-modal

# Debug Session

- Session ID: composition-detail-modal
- Started At: 2026-04-04
- Scope: 点击拼接输出结果“查看详情”时发生运行时异常

## Symptoms

- 在 `/studio/composition` 页面点击“查看详情”后报错
- 浏览器异常：`Cannot read properties of undefined (reading 'tracks')`
- 报错位置指向 `src/app/page.tsx` 中 `activeComposition.audioPlan.tracks`

## Hypotheses

1. 部分历史拼接项目数据没有 `audioPlan` 字段，详情弹层直接读取 `audioPlan.tracks` 导致崩溃。
2. `activeComposition` 详情数据来自旧版存储结构，当前页面代码默认按新版结构渲染，缺少兼容层。
3. 只有列表页卡片展示做了宽松处理，而弹层里没有做同样的空值兜底。
4. 某些拼接项目记录被手动修改过，字段结构不完整，导致详情页访问失败。

## Evidence

- 运行时错误定位在 [page.tsx](file:///Users/bytedance/Documents/trae_projects/Travel/src/app/page.tsx#L2106-L2164)，详情弹层直接读取 `activeComposition.audioPlan.tracks`。
- `data/video-compositions.json` 当前所有拼接记录都没有 `audioPlan` 字段，因此 `activeComposition.audioPlan` 可能为 `undefined`。
- 列表页卡片使用的 [getCompositionAudioState](file:///Users/bytedance/Documents/trae_projects/Travel/src/lib/video-composition-presenter.ts#L28-L38) 已经对 `audioPlan` 做了兜底，但详情弹层没有同样的兼容处理。

## Findings

1. 假设 1 成立：历史拼接数据缺少 `audioPlan` 字段。
2. 假设 2 成立：详情弹层按新版结构读取旧数据时崩溃。
3. 假设 3 成立：列表卡片和弹层的兼容策略不一致。
4. 最小修复应是：详情弹层把 `activeComposition.audioPlan?.tracks ?? []` 作为统一轨道来源，而不是直接访问 `audioPlan.tracks`。
