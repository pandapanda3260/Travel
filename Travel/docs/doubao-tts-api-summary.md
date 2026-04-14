# 豆包语音 API 整理

## 1. 当前项目实际使用的接口

- 语音合成服务：`豆包语音合成模型 2.0`
- 资源 ID：`seed-tts-2.0`
- 当前接入方式：OpenSpeech V3 SSE
- 请求地址：
  - `https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`

## 2. 鉴权方式

当前项目用于 TTS 合成的鉴权字段：

- `X-Api-App-Id`
- `X-Api-Access-Key`
- `X-Api-Resource-Id`
- `X-Api-Request-Id`

说明：

- 这是 **语音合成调用** 的鉴权方式
- 与 **拉取音色列表 API** 的 OpenAPI 签名方式不同

## 3. 请求参数与作用

### 3.1 必填核心参数

- `req_params.text`
  - 要合成的文本
- `req_params.speaker`
  - 音色 ID
- `req_params.audio_params.format`
  - 输出格式，可选 `mp3` / `ogg_opus` / `pcm`
- `req_params.audio_params.sample_rate`
  - 采样率，如 `24000`

### 3.2 常用效果参数

- `req_params.audio_params.speech_rate`
  - 语速，范围 `[-50,100]`
  - 适合做快节奏宣传片、慢节奏讲述
- `req_params.audio_params.loudness_rate`
  - 音量，范围 `[-50,100]`
- `req_params.audio_params.emotion`
  - 情绪控制
  - 仅部分音色支持
- `req_params.audio_params.emotion_scale`
  - 情绪强度，范围 `1~5`
- `req_params.audio_params.enable_subtitle`
  - 对 TTS 2.0 生效
  - 返回字幕词级时间戳，适合做字幕打轴

### 3.3 additions 扩展参数

- `disable_markdown_filter`
  - 过滤 markdown 读法
- `disable_emoji_filter`
  - 是否保留 emoji
- `silence_duration`
  - 在末尾补静音
- `cache_config`
  - 相同文本走缓存，减少重复合成开销
- `post_process.pitch`
  - 音调调整，范围 `[-12,12]`
- `context_texts`
  - 辅助控制语气、节奏、情绪
  - 对 TTS 2.0 很有价值
- `explicit_language`
  - 指定语种
- `explicit_dialect`
  - 指定方言，只有个别音色支持

## 4. 哪些能力建议引入

### 4.1 建议优先引入

- `enable_subtitle`
  - 直接拿词级时间戳，最适合你现在的字幕系统
- `context_texts`
  - 适合做“品牌旁白”“纪录片口吻”“酒店接待口吻”等风格控制
- `speech_rate`
  - 适合控制短视频节奏
- `emotion` + `emotion_scale`
  - 适合做情绪更强的视频配音
- `cache_config`
  - 避免同一段文案重复扣费

### 4.2 谨慎引入

- `explicit_dialect`
  - 可玩性高，但音色支持范围窄
- `post_process.pitch`
  - 调多了容易不自然
- `use_tag_parser`
  - 更偏实验能力，适合复刻/高级玩法

## 5. 能不能从 API 拉取各种音色

可以。

官方提供了 **拉取大模型音色列表** 的接口：

- Action：`ListBigModelTTSTimbres`
- Version：`2025-05-20`
- Host：
  - `https://open.volcengineapi.com`

返回内容包含：

- `SpeakerID`
  - 调用 TTS 时真正传入的音色 ID
- `SpeakerName`
  - 展示名称
- `Gender`
- `Age`
- `Categories`
  - 分类，如通用、多语种、角色扮演、客服等
- `Emotions`
  - 支持情绪列表
- `DemoText`
- `DemoURL`

这意味着：

- 页面里不必永远写死音色列表
- 后续可以改成“服务端动态拉取音色列表，再给前端展示”

## 6. 拉取音色列表和合成接口的区别

这个很重要：

- **合成接口**
  - 用 `AppId + AccessToken + ResourceId`
- **音色列表接口**
  - 用火山 OpenAPI 标准签名
  - 通常需要 `AK/SK` + HMAC-SHA256

所以如果你要把“在线音色列表”真正接进系统，建议新增一层服务端代理：

- 服务端调用 `ListBigModelTTSTimbres`
- 前端只请求你自己的 `/api/tts/timbres`

不要把 AK/SK 暴露到前端。

## 7. 是免费还是每次都会花钱

不是永久免费。

### 7.1 免费试用

官方当前说明：

- `豆包语音合成模型 2.0`
  - 免费额度：`20000 字符`
  - 有效期：`半年`

前提：

- 要在控制台手动点击试用 / 开启

### 7.2 正式计费

豆包语音合成模型 2.0 按 **合成字符数** 计费。

#### 后付费

- `3 元 / 万字符`

#### 资源包预付费

- `10 万字`：`28 元`
- `2000 万字`：`5400 元`
- `20000 万字`：`48000 元`
- `200000 万字`：`420000 元`

折算下来大约：

- `2.8 ~ 2.1 元 / 万字符`

### 7.3 并发费用

正式版默认支持一定并发，超出后可增购：

- `豆包语音合成模型 2.0`
  - 默认正式版 `10 并发`
  - 增购价格：`100 元 / 并发 / 月`

## 8. 音色是否都能直接用

不一定。

需要区分：

- 试用阶段
  - 文档说明可调用全部音色进行测试
- 正式开通后
  - 某些音色需要在控制台具备授权或下单
  - 没授权时会报：
    - `speaker permission denied`

所以产品上要预留：

- 音色拉取
- 音色授权失败提示
- 默认回退音色

## 9. 对当前项目的建议

### 9.1 现在就适合做的

- 把音色列表从硬编码改成服务端动态拉取
- 给音色卡片展示：
  - 名称
  - 分类
  - 性别
  - 支持情绪
  - demo 音频
- 合成时默认携带：
  - `enable_subtitle`
  - `cache_config`
  - `speech_rate`
  - `context_texts`

### 9.2 费用控制建议

- 相同解说稿优先走缓存
- 合成前先做字数估算
- 页面上展示本次预计字符数
- 频繁试稿时优先短文本试听

## 10. 你当前最关心的结论

- 可以从 API 拉取音色列表
- 但拉音色列表和做 TTS 合成不是同一套鉴权
- 豆包语音合成 2.0 有免费试用额度，但不是永久免费
- 正式调用通常会按字符数计费
- 当前项目最值得优先引入的能力是：
  - `enable_subtitle`
  - `context_texts`
  - `speech_rate`
  - `emotion`
  - `cache_config`
