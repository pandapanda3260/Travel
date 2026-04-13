# 解说字幕部署说明

## 文本生成

- 服务：火山方舟
- 模型：Doubao-Seed-2.0-pro
- 配置文件：`text.env.local`

```env
VOLCENGINE_TEXT_LIVE_ENABLED=true
VOLCENGINE_TEXT_API_BASE=https://ark.cn-beijing.volces.com
VOLCENGINE_TEXT_API_KEY=your_ark_api_key
VOLCENGINE_TEXT_MODEL=your_ark_endpoint_id_for_doubao_seed_2_0_pro
```

- 当前代码通过 OpenAI 兼容接口调用：
  - `POST /api/v3/chat/completions`
- 请求头：
  - `Authorization: Bearer ${VOLCENGINE_TEXT_API_KEY}`
- 注意：
  - `VOLCENGINE_TEXT_MODEL` 需要填写方舟控制台里为 `Doubao-Seed-2.0-pro` 创建并开通后的推理接入点 ID，而不是模型展示名本身。

## 语音合成

- 服务：火山引擎 OpenSpeech V3
- 模型资源：Doubao 语音合成 2.0
- ResourceId：`seed-tts-2.0`
- 配置文件：`audio.env.local`

```env
VOLCENGINE_AUDIO_LIVE_ENABLED=true
VOLCENGINE_AUDIO_API_BASE=https://openspeech.bytedance.com
VOLCENGINE_AUDIO_APP_ID=your_audio_app_id
VOLCENGINE_AUDIO_ACCESS_TOKEN=your_audio_access_token
VOLCENGINE_AUDIO_RESOURCE_ID=seed-tts-2.0
VOLCENGINE_AUDIO_VOICE_ID=zh_female_vv_uranus_bigtts
VOLCENGINE_AUDIO_SAMPLE_RATE=24000
```

- 当前代码通过 SSE 接口调用：
  - `POST /api/v3/tts/unidirectional/sse`
- 关键请求头：
  - `X-Api-App-Id`
  - `X-Api-Access-Key`
  - `X-Api-Resource-Id`

## 当前实现

- 解说词页面优先按拼接镜头输出一镜一段解说
- 每段解说保留：
  - `bindToSegmentId`
  - `characterFocus`
  - `subtitleText`
- TTS 返回词级时间戳后，会落盘到：
  - `public/generated-audio/narration`

## 推荐验收顺序

- 先验证 `/api/narration` 返回运行时状态
- 再验证 `/api/narration/generate` 能产出草案
- 然后配置音频凭证，验证 `/api/narration/speech`
- 最后把生成的 narration track 导入拼接项目
