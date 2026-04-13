[OPEN] baseline-preview-500

# Debug Session

- Session ID: baseline-preview-500
- Started At: 2026-04-04
- Scope: 用户恢复代码后，首页与概览页仍然 500，目标是恢复最小可运行基线

## Symptoms

- `/` 页面 500
- `/overview` 页面 500
- `/api/videos` 页面 500
- 侧边栏仍存在一批工作流链接，但对应页面缺失

## Hypotheses

1. 首页引用的若干 `video-composition-*` 辅助模块未恢复，导致主工作台编译失败。
2. 概览页和侧边栏仍保留旧工作流依赖，但对应 `workflow-*` 文件已被移除，导致路由编译失败。
3. 视频 API 链路仍引用已删除的 provider 配置模块，导致 `/api/videos` 和依赖它的页面一起失败。
4. 当前代码实际上已经回到“更早期的视频工作台版本”，但遗留了少量后期工作流入口，形成混合态。

## Evidence

- 待补充编译错误与修复结果。
