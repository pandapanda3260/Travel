# 服务自查与自启动

这套项目内置了两层保护：

1. 进程级自动拉起  
   `ops/systemd/travel-web.service` 使用 `Restart=always`。只要 `next start` 进程退出，systemd 会自动重启它。

2. HTTP 级健康巡检  
   `ops/systemd/travel-web-watchdog.timer` 每 30 秒执行一次 `scripts/server-healthcheck.mjs`。  
   如果 `http://127.0.0.1:3000/api/health` 返回失败，巡检脚本会自动执行：

   ```bash
   systemctl restart travel-web.service
   ```

## 健康检查接口

项目提供了：

```text
GET /api/health
HEAD /api/health
```

返回内容会检查：

- SQLite 连接是否正常
- `data` 目录是否可读写
- `public` 运行时存储目录是否可读写
- 当前进程 PID、启动时间、存储根目录信息

只要其中任一检查失败，接口会返回 `503`。

## 部署方式

以下示例假设项目部署目录是 `/srv/travel`，运行用户是 `www-data`。

### 1. 安装项目

```bash
cd /srv/travel
npm ci
npm run build
```

### 2. 准备环境变量

可选地创建：

```bash
sudo mkdir -p /etc/travel
sudo nano /etc/travel/travel-web.env
```

示例内容：

```bash
HOST=127.0.0.1
PORT=3000
TRAVEL_STORAGE_ROOT=/srv/travel-runtime
```

### 3. 安装 systemd 单元

```bash
sudo cp ops/systemd/travel-web.service /etc/systemd/system/
sudo cp ops/systemd/travel-web-watchdog.service /etc/systemd/system/
sudo cp ops/systemd/travel-web-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

### 4. 启动并设置开机后保持托管

```bash
sudo systemctl enable --now travel-web.service
sudo systemctl enable --now travel-web-watchdog.timer
```

## 日常检查

查看主服务：

```bash
sudo systemctl status travel-web.service
```

查看巡检定时器：

```bash
sudo systemctl status travel-web-watchdog.timer
```

查看最近日志：

```bash
sudo journalctl -u travel-web.service -u travel-web-watchdog.service -n 200 --no-pager
```

实时看日志：

```bash
sudo journalctl -u travel-web.service -u travel-web-watchdog.service -f
```

手动跑一次巡检：

```bash
npm run healthcheck:local
```

## 建议规则

线上建议把“自动重启”分两层理解：

- 第一层：进程退出就自动拉起
- 第二层：进程虽然还活着，但 HTTP 已经不健康，也要自动重启

这也是为什么这里同时用了：

- `Restart=always`
- `/api/health`
- `travel-web-watchdog.timer`

## 备注

如果你未来改成 Docker / Kubernetes，同样保留 `/api/health`，然后把巡检逻辑交给容器编排层即可：

- Docker: `HEALTHCHECK` + `restart: unless-stopped`
- Kubernetes: `livenessProbe` + `readinessProbe`
