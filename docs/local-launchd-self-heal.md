# 本地 launchd 常驻守护

如果你希望本地开发环境也具备“服务挂掉后自动拉起”和“HTTP 不健康时自动自愈”，可以使用仓库里这套 `launchd` 规则。

## 能力

这套本地方案分两层：

1. 主服务守护  
   `com.travel.dev-web`
   - 由 `launchd` 常驻托管
   - 登录后自动启动
   - 进程退出后自动重新拉起

2. 健康巡检  
   `com.travel.dev-web-healthcheck`
   - 每 30 秒执行一次
   - 检查 `http://127.0.0.1:3000/api/health`
   - 连续失败达到阈值后，才执行：

   ```bash
   launchctl kickstart -k gui/$(id -u)/com.travel.dev-web
   ```

   - 默认允许短暂启动抖动，不会因为单次超时就把正在启动中的服务反复重启

## 安装

在项目根目录执行：

```bash
npm run launchd:install
```

它会自动：

- 生成并安装 `~/Library/LaunchAgents/com.travel.dev-web.plist`
- 生成并安装 `~/Library/LaunchAgents/com.travel.dev-web-healthcheck.plist`
- 立即加载并启动两个 Agent

## 查看状态

```bash
npm run launchd:status
```

## 卸载

```bash
npm run launchd:uninstall
```

## 日志位置

日志会写到：

```text
~/Library/Logs/Travel/dev-web.out.log
~/Library/Logs/Travel/dev-web.err.log
~/Library/Logs/Travel/dev-watchdog.out.log
~/Library/Logs/Travel/dev-watchdog.err.log
```

## 说明

- 这套方案适合本地 macOS 开发环境
- 它不是服务器部署方案；服务器仍建议使用 `systemd`
- 本地守护默认监听：

```text
http://127.0.0.1:3000
```

如果需要改端口，可以在安装前传环境变量，例如：

```bash
DEV_PORT=3001 npm run launchd:install
```
