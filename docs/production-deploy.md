# 生产部署脚本

当前生产服务器：

```text
服务器：101.47.18.47
域名：douyinshengfu.com.cn / www.douyinshengfu.com.cn
代码目录：/srv/travel
运行时数据：/srv/travel-runtime
密钥配置：/etc/travel
```

## 常规更新

在本机项目根目录执行：

```bash
npm run deploy:prod
```

脚本会：

- 检查 Git 工作区是否干净
- 把当前 Git `HEAD` 打包上传到 `/srv/travel`
- 排除本地运行时数据和历史媒体目录
- 在服务器执行 `npm ci`
- 在服务器执行 `npm run build`
- 安装/刷新 `systemd` 单元
- 重启 `travel-web.service`
- 调用 `http://127.0.0.1:3000/api/health` 验证服务

脚本不会覆盖：

```text
/srv/travel-runtime
/etc/travel
```

所以数据库、上传素材、生成图片/视频、API key 不会被常规更新覆盖。

## 历史媒体同步

历史媒体同步很慢，默认不跑。需要迁移本机旧图片/视频时，再显式执行：

```bash
npm run deploy:prod -- --sync-media
```

这会把以下目录追加同步到服务器 `/srv/travel-runtime/public`：

```text
public/generated-audio
public/generated-compositions
public/generated-final-videos
public/generated-images
public/generated-subtitles
public/generated-videos
public/product-archives
public/video-materials
public/video-tasks
```

## 配置覆盖

默认 SSH key：

```text
/Users/bytedance/Desktop/Travel 相关文件/key/travel.pem
```

如需换服务器或 key：

```bash
TRAVEL_DEPLOY_HOST=1.2.3.4 \
TRAVEL_DEPLOY_USER=root \
TRAVEL_DEPLOY_KEY="$HOME/.ssh/travel.pem" \
npm run deploy:prod
```

如果工作区有未提交修改，但你确认只部署当前 Git `HEAD`：

```bash
npm run deploy:prod -- --allow-dirty
```

## 仍需人工确认

- DNSPod 解析是否指向正确服务器 IP
- 火山安全组是否放行 `80` / `443` / `22`
- 火山、Kling、OpenAI、腾讯短信的账号额度、模型权限、模板审核是否可用
- 业务账号登录和关键生成流程是否符合预期
