# 开发提效工具清单

这个项目当前采用 `Next.js 16 + React 19 + TypeScript + npm + SQLite`，下面这组工具是按“低侵入、可立即落地、和当前仓库兼容”筛出来的。

## 已接入

### 1. Next.js 官方 MCP

- 配置文件：`/.vscode/mcp.json`
- 入口：`nextDevtools`
- 作用：
  - 让 Codex / VS Code Agent / 支持 MCP 的本地代理直接读取运行中的 Next.js 16 开发态信息
  - 可拿到当前路由、错误、日志和页面元数据
- 使用方式：
  1. 运行 `npm run dev`
  2. 在支持 MCP 的代理里直接问“当前页面有哪些运行时错误”或“这个路由的 metadata 是什么”

### 2. Playwright E2E 基座

- 配置文件：`/playwright.config.ts`
- 测试目录：`/tests/e2e`
- npm scripts：
  - `npm run test:e2e`
  - `npm run test:e2e:headed`
  - `npm run test:e2e:ui`
- 当前内置了两个 smoke case：
  - `/api/health` 健康检查
  - `/login` 登录页基础渲染

### 3. TypeScript 循环依赖扫描

- 工具：`dpdm`
- npm script：
  - `npm run analyze:circular`
  - `npm run analyze:circular:strict`
- 作用：
  - 快速发现大页面和核心 store / route 之间的依赖环
  - 对当前这种状态流复杂、模块很多的项目很实用

## 已推荐到工作区的 IDE 扩展

- `openai.chatgpt`
- `ms-playwright.playwright`
- `tamasfe.even-better-toml`
- `dbaeumer.vscode-eslint`
- `esbenp.prettier-vscode`
- `usernamehw.errorlens`
- `eamodio.gitlens`
- `humao.rest-client`
- `qwtel.sqlite-viewer`

## 日常推荐工作流

### 需求开发

1. `npm run dev`
2. 让 Codex / MCP 先读运行态错误和路由信息
3. 修改完成后跑：
   - `npm run typecheck`
   - `npm test`
   - `npm run test:e2e`

### 排查大页面或状态错乱

1. 先跑 `npm run analyze:circular`
2. 再结合 `npm run analyze:unused`
3. 用 Playwright 复现 UI 问题

### 查本地数据

1. 打开 SQLite Viewer 查看本地库
2. 用 REST Client 或浏览器直接请求 `/api/health`、`/api/video-tasks/*`
