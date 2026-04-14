import { getVoiceManagementRuntime } from "./voice-management-config";
import { mapTimbreCatalogDisplayOverrides } from "./speaker-display-overrides";
import { getStoredTimbreLibraryMeta, listStoredTimbres, replaceStoredTimbres } from "./timbre-library-store";
import { callSpeechOpenApi } from "./volc-speech-openapi";

export type TimbreCategory = {
  category: string;
  nextCategory?: string | null;
};

export type TimbreEmotion = {
  emotion: string;
  emotionType: string;
  demoText?: string;
  demoUrl?: string;
};

export type TimbreItem = {
  speakerId: string;
  speakerName: string;
  gender: string;
  age: string;
  categories: TimbreCategory[];
  emotions: TimbreEmotion[];
  tags: string[];
  description: string;
  previewText: string;
  previewUrl: string | null;
  avatarText: string;
};

export function resolveTimbreResourceId(speakerId: string): string | undefined {
  if (speakerId.includes("_mars_bigtts") || speakerId.includes("_moon_bigtts")) {
    return "seed-tts-1.0";
  }

  if (
    speakerId.includes("_uranus_bigtts") ||
    speakerId.includes("_jupiter_bigtts") ||
    speakerId.includes("_saturn_bigtts")
  ) {
    return "seed-tts-2.0";
  }

  if (speakerId.startsWith("ICL_") || speakerId.includes("_tob")) {
    return "seed-icl-1.0";
  }

  if (speakerId.startsWith("S_")) {
    return "seed-icl-2.0";
  }

  return undefined;
}

type OpenApiTimbreResult = {
  Timbres?: Array<{
    SpeakerID: string;
    TimbreInfos?: Array<{
      SpeakerName?: string;
      Gender?: string;
      Age?: string;
      Categories?: Array<{
        Category?: string;
        NextCategory?: {
          Category?: string;
        };
      }>;
      Emotions?: Array<{
        Emotion?: string;
        EmotionType?: string;
        DemoText?: string;
        DemoURL?: string;
      }>;
    }>;
  }>;
};

const recommendedSpeakerIds = [
  "zh_male_beijingxiaoye_emo_v2_mars_bigtts",
  "zh_female_cancan_mars_bigtts",
  "zh_female_qingxinnvsheng_mars_bigtts",
  "zh_male_wennuanahu_moon_bigtts",
  "zh_female_peiqi_mars_bigtts",
  "zh_female_tianmeixiaoyuan_moon_bigtts",
  "zh_male_shaonianzixin_uranus_bigtts",
  "zh_male_liufei_uranus_bigtts",
  "zh_male_yangguangqingnian_mars_bigtts",
] as const;

const searchableSpeakerIds = [
  "zh_male_sunwukong_uranus_bigtts",
  "zh_male_zhubajie_mars_bigtts",
  "zh_male_tangseng_mars_bigtts",
  "zh_male_lubanqihao_mars_bigtts",
  "ICL_zh_male_menyoupingxiaoge_ffed9fc2fee7_tob",
  "zh_male_jingqiangkanye_moon_bigtts",
  "zh_male_silang_mars_bigtts",
  "zh_male_xionger_mars_bigtts",
  "ICL_zh_male_BV144_paoxiaoge_v1_tob",
] as const;

const fallbackCatalog: TimbreItem[] = [
  {
    speakerId: "zh_male_beijingxiaoye_emo_v2_mars_bigtts",
    speakerName: "北京小爷",
    gender: "男",
    age: "青年",
    categories: [{ category: "趣味口音", nextCategory: "北京口音" }],
    emotions: [{ emotion: "中性", emotionType: "neutral" }],
    tags: ["北京口音", "情感音色", "角色感"],
    description: "京腔利落，适合地域化短视频、人物对白和轻剧情解说。",
    previewText: "今儿这事儿要办得漂亮，咱得拿出点北京小爷的气场。",
    previewUrl: null,
    avatarText: "京",
  },
  {
    speakerId: "zh_female_cancan_mars_bigtts",
    speakerName: "灿灿",
    gender: "女",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["通用", "自然", "高可用"],
    description: "清晰自然、适配面广，适合品牌介绍、酒店服务和稳定旁白。",
    previewText: "欢迎来到酒店度假体验中心，我们将从入住到离店为您提供流畅服务。",
    previewUrl: null,
    avatarText: "灿",
  },
  {
    speakerId: "zh_female_qingxinnvsheng_mars_bigtts",
    speakerName: "清新女声",
    gender: "女",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["轻快", "生活方式", "品牌"],
    description: "声线轻盈明亮，适合酒店种草、活动推广和温柔讲述。",
    previewText: "清晨的第一缕阳光落在窗边，今天也适合慢下来，享受一段轻松旅程。",
    previewUrl: null,
    avatarText: "清",
  },
  {
    speakerId: "zh_male_wennuanahu_moon_bigtts",
    speakerName: "温暖阿虎",
    gender: "男",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["温暖", "有声阅读", "沉稳"],
    description: "温和沉稳的男声，更适合故事化旁白和情绪平缓的品牌内容。",
    previewText: "旅途的意义，从来不只是抵达，更是在每一次停留里找到新的感受。",
    previewUrl: null,
    avatarText: "虎",
  },
  {
    speakerId: "zh_female_peiqi_mars_bigtts",
    speakerName: "佩奇猪",
    gender: "女",
    age: "儿童",
    categories: [{ category: "视频配音" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["角色", "童趣", "视频配音"],
    description: "辨识度高，适合儿童向内容、趣味化广告和人格化角色解说。",
    previewText: "今天我们一起出发去看大海吧，路上还有好多惊喜等着你呢。",
    previewUrl: null,
    avatarText: "佩",
  },
  {
    speakerId: "zh_female_tianmeixiaoyuan_moon_bigtts",
    speakerName: "甜美小源",
    gender: "女",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["甜美", "轻松", "种草"],
    description: "语气轻柔，适合美食、酒店、生活方式推荐类内容。",
    previewText: "这家度假酒店真的很适合周末放松，从房间景观到下午茶都很加分。",
    previewUrl: null,
    avatarText: "源",
  },
  {
    speakerId: "zh_male_shaonianzixin_uranus_bigtts",
    speakerName: "少年梓辛",
    gender: "男",
    age: "少年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["少年感", "自然", "短视频"],
    description: "年轻感强，适合青春向、轻纪录片和轻情绪视频旁白。",
    previewText: "夏天最舒服的事，大概就是和朋友一起出发，去海边住上两天。",
    previewUrl: null,
    avatarText: "梓",
  },
  {
    speakerId: "zh_male_liufei_uranus_bigtts",
    speakerName: "刘飞",
    gender: "男",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["沉稳", "纪录片", "品牌"],
    description: "清晰厚实，适合商务介绍、城市宣传和纪录片解说。",
    previewText: "在山海之间，一座真正懂服务的酒店，往往能重新定义一段旅程。",
    previewUrl: null,
    avatarText: "飞",
  },
  {
    speakerId: "zh_male_yangguangqingnian_mars_bigtts",
    speakerName: "阳光青年",
    gender: "男",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["活力", "明快", "宣传片"],
    description: "轻松明快，适合活动预告、短视频节奏型内容和城市玩法介绍。",
    previewText: "把周末交给山野和微风，这次出发，我们去体验更轻盈的度假方式。",
    previewUrl: null,
    avatarText: "阳",
  },
  {
    speakerId: "zh_female_vv_uranus_bigtts",
    speakerName: "Vivi 2.0",
    gender: "女",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["2.0", "通用", "表现力"],
    description: "表现力强，适合品牌片、酒店推荐和生活方式视频。",
    previewText: "每一次入住，都是一次新的生活方式体验，这里想把舒适感做得更完整。",
    previewUrl: null,
    avatarText: "V",
  },
  {
    speakerId: "zh_female_xiaohe_uranus_bigtts",
    speakerName: "小何 2.0",
    gender: "女",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["2.0", "自然", "轻快"],
    description: "语气轻快，适合日常 vlog、推荐视频和轻生活内容。",
    previewText: "如果你想在城市边缘找个安静地方住两天，这里真的值得放进清单里。",
    previewUrl: null,
    avatarText: "何",
  },
  {
    speakerId: "zh_male_m191_uranus_bigtts",
    speakerName: "云舟 2.0",
    gender: "男",
    age: "青年",
    categories: [{ category: "通用场景" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["2.0", "沉稳", "旁白"],
    description: "成熟稳重，适合品牌叙事、城市酒店和高端服务介绍。",
    previewText: "好的服务，不是打扰，而是在你需要的时候，刚好出现。",
    previewUrl: null,
    avatarText: "舟",
  },
  {
    speakerId: "zh_male_sunwukong_uranus_bigtts",
    speakerName: "孙悟空",
    gender: "男",
    age: "青年",
    categories: [{ category: "角色扮演" }],
    emotions: [{ emotion: "热血", emotionType: "character" }],
    tags: ["神话角色", "热血", "高辨识"],
    description: "角色感强，适合剧情短视频、趣味配音和强人设旁白。",
    previewText: "俺老孙来也，这趟行程既要热闹，也要把看点讲得明明白白。",
    previewUrl: null,
    avatarText: "悟",
  },
  {
    speakerId: "zh_male_zhubajie_mars_bigtts",
    speakerName: "猪八戒",
    gender: "男",
    age: "成年",
    categories: [{ category: "角色扮演" }],
    emotions: [{ emotion: "诙谐", emotionType: "character" }],
    tags: ["神话角色", "诙谐", "生活感"],
    description: "带幽默感，适合轻松段子、角色对白和趣味化内容。",
    previewText: "俺也去看看这好吃好玩的地方，顺便给大家唠唠这一路的热闹劲儿。",
    previewUrl: null,
    avatarText: "戒",
  },
  {
    speakerId: "zh_male_tangseng_mars_bigtts",
    speakerName: "唐僧",
    gender: "男",
    age: "成年",
    categories: [{ category: "角色扮演" }],
    emotions: [{ emotion: "平和", emotionType: "character" }],
    tags: ["神话角色", "平和", "叙述感"],
    description: "语气平和克制，适合文化讲述、故事化解说和温和旁白。",
    previewText: "一路风景自有缘法，慢慢看、细细听，方知此行妙处。",
    previewUrl: null,
    avatarText: "僧",
  },
  {
    speakerId: "zh_male_lubanqihao_mars_bigtts",
    speakerName: "鲁班七号",
    gender: "男",
    age: "少年",
    categories: [{ category: "游戏角色" }],
    emotions: [{ emotion: "活泼", emotionType: "character" }],
    tags: ["游戏角色", "活泼", "高能"],
    description: "活泼跳脱，适合游戏向视频、二创内容和节奏感较强的介绍。",
    previewText: "检测到前方有新鲜玩法，准备出发，目标是把有趣的内容全部捕捉。",
    previewUrl: null,
    avatarText: "鲁",
  },
  {
    speakerId: "ICL_zh_male_menyoupingxiaoge_ffed9fc2fee7_tob",
    speakerName: "闷油瓶小哥",
    gender: "男",
    age: "青年",
    categories: [{ category: "角色扮演" }],
    emotions: [{ emotion: "冷静", emotionType: "character" }],
    tags: ["低沉", "冷静", "角色感"],
    description: "清冷克制，适合悬疑剧情、角色向混剪和沉浸式旁白。",
    previewText: "别急，先把线索看清，再决定下一步怎么走。",
    previewUrl: null,
    avatarText: "瓶",
  },
  {
    speakerId: "zh_male_jingqiangkanye_moon_bigtts",
    speakerName: "京腔侃爷",
    gender: "男",
    age: "青年",
    categories: [{ category: "趣味口音", nextCategory: "京腔" }],
    emotions: [{ emotion: "通用", emotionType: "general" }],
    tags: ["京腔", "侃聊", "松弛"],
    description: "京味十足，适合生活化吐槽、城市玩法和接地气解说。",
    previewText: "这地方您来一趟就知道，吃喝玩乐都得给您安排明白了。",
    previewUrl: null,
    avatarText: "京",
  },
  {
    speakerId: "zh_male_silang_mars_bigtts",
    speakerName: "四郎",
    gender: "男",
    age: "青年",
    categories: [{ category: "角色扮演" }],
    emotions: [{ emotion: "沉稳", emotionType: "character" }],
    tags: ["古风", "沉稳", "剧情"],
    description: "古风感明显，适合剧情解说、人物独白和情绪化旁白。",
    previewText: "此处风物极佳，若能驻足片刻，自会生出别样心绪。",
    previewUrl: null,
    avatarText: "郎",
  },
  {
    speakerId: "zh_male_xionger_mars_bigtts",
    speakerName: "熊二",
    gender: "男",
    age: "成年",
    categories: [{ category: "角色扮演" }],
    emotions: [{ emotion: "憨厚", emotionType: "character" }],
    tags: ["动画角色", "憨厚", "趣味"],
    description: "辨识度高，适合儿童向内容、轻喜剧短视频和趣味配音。",
    previewText: "俺也去瞅瞅，这地方看着就热闹，说不定还有好多好吃的嘞。",
    previewUrl: null,
    avatarText: "熊",
  },
  {
    speakerId: "ICL_zh_male_BV144_paoxiaoge_v1_tob",
    speakerName: "泡小哥",
    gender: "男",
    age: "青年",
    categories: [{ category: "角色扮演" }],
    emotions: [{ emotion: "轻快", emotionType: "character" }],
    tags: ["年轻感", "轻快", "互动"],
    description: "语气轻快，适合推荐向视频、互动口播和年轻化表达。",
    previewText: "这次给大家挑的几个点位都挺能打，直接跟着走就行。",
    previewUrl: null,
    avatarText: "泡",
  },
];

function buildAvatarText(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "声";
}

const searchableAliasMap: Array<[string, string]> = [
  ["男", "nan"],
  ["女", "nv"],
  ["青年", "qingnian"],
  ["少年", "shaonian"],
  ["成年", "chengnian"],
  ["儿童", "ertong"],
  ["通用", "tongyong"],
  ["通用场景", "tongyongchangjing"],
  ["角色扮演", "jiaosebanyan"],
  ["视频配音", "shipeipeiyin"],
  ["有声阅读", "youshengyuedu"],
  ["纪录片", "jilupian"],
  ["生活方式", "shenghuofangshi"],
  ["短视频", "duanshipin"],
  ["趣味口音", "quweikouyin"],
  ["北京口音", "beijingkouyin"],
  ["京腔", "jingqiang"],
  ["温暖", "wennuan"],
  ["沉稳", "chenwen"],
  ["自然", "ziran"],
  ["轻快", "qingkuai"],
  ["高能", "gaoneng"],
  ["古风", "gufeng"],
  ["热血", "rexue"],
  ["诙谐", "huixie"],
  ["平和", "pinghe"],
  ["冷静", "lengjing"],
  ["动画角色", "donghuajiaose"],
  ["神话角色", "shenhuajiaose"],
  ["游戏角色", "youxijiaose"],
  ["轻喜剧", "qingxiju"],
  ["趣味", "quwei"],
  ["品牌", "pinpai"],
  ["旁白", "pangbai"],
  ["推荐", "tuijian"],
  ["互动", "hudong"],
  ["剧情", "juqing"],
];

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function isSubsequenceMatch(keyword: string, target: string) {
  if (!keyword) {
    return true;
  }

  let keywordIndex = 0;
  for (const character of target) {
    if (character === keyword[keywordIndex]) {
      keywordIndex += 1;
      if (keywordIndex === keyword.length) {
        return true;
      }
    }
  }

  return false;
}

function getFuzzySearchScore(keyword: string, haystack: string) {
  if (!keyword || !haystack) {
    return 0;
  }

  if (haystack.includes(keyword)) {
    return 1000 - (haystack.indexOf(keyword) * 0.1 + haystack.length * 0.001);
  }

  const compactKeyword = keyword.replace(/\s+/g, "");
  const compactHaystack = haystack.replace(/\s+/g, "");
  if (compactKeyword && compactHaystack.includes(compactKeyword)) {
    return 800 - (compactHaystack.indexOf(compactKeyword) * 0.1 + compactHaystack.length * 0.001);
  }

  const keywordTokens = keyword.split(/\s+/).filter(Boolean);
  if (keywordTokens.length > 1) {
    const tokenMatches = keywordTokens.filter((token) => haystack.includes(token)).length;
    if (tokenMatches > 0) {
      return tokenMatches * 120;
    }
  }

  if (compactKeyword.length >= 2 && isSubsequenceMatch(compactKeyword, compactHaystack)) {
    return 60 - compactHaystack.length * 0.001;
  }

  return 0;
}

function getFieldPriorityScore(item: TimbreItem, keyword: string) {
  const normalizedKeyword = normalizeSearchText(keyword);
  const compactKeyword = compactSearchText(keyword);
  const fields = [
    item.speakerName,
    item.speakerId,
    item.speakerId.replaceAll("_", " "),
    item.avatarText,
    ...item.tags,
    ...item.categories.flatMap((category) => [category.category, category.nextCategory ?? ""]),
    ...item.emotions.map((emotion) => emotion.emotion),
    item.description,
  ];

  const nameScore = Math.max(
    getFuzzySearchScore(normalizedKeyword, normalizeSearchText(item.speakerName)),
    getFuzzySearchScore(compactKeyword, compactSearchText(item.speakerName)),
    getFuzzySearchScore(normalizedKeyword, normalizeSearchText(item.speakerId)),
    getFuzzySearchScore(compactKeyword, compactSearchText(item.speakerId)),
  );

  const tagScore = Math.max(
    0,
    ...[
      ...item.tags,
      ...item.categories.flatMap((category) => [category.category, category.nextCategory ?? ""]),
      ...item.emotions.map((emotion) => emotion.emotion),
    ].map((field) =>
      Math.max(
        getFuzzySearchScore(normalizedKeyword, normalizeSearchText(field)),
        getFuzzySearchScore(compactKeyword, compactSearchText(field)),
      ),
    ),
  );

  const descriptionScore = Math.max(
    getFuzzySearchScore(normalizedKeyword, normalizeSearchText(item.description)),
    getFuzzySearchScore(compactKeyword, compactSearchText(item.description)),
  );

  const broadScore = Math.max(
    0,
    ...fields.map((field) =>
      Math.max(
        getFuzzySearchScore(normalizedKeyword, normalizeSearchText(field)),
        getFuzzySearchScore(compactKeyword, compactSearchText(field)),
      ),
    ),
  );

  return {
    nameScore,
    tagScore,
    descriptionScore,
    broadScore,
  };
}

function buildSearchIndex(item: TimbreItem) {
  const baseParts = [
    item.speakerId,
    item.speakerId.replaceAll("_", " "),
    item.speakerName,
    item.description,
    item.gender,
    item.age,
    item.avatarText,
    ...item.tags,
    ...item.categories.flatMap((category) => [category.category, category.nextCategory ?? ""]),
    ...item.emotions.flatMap((emotion) => [emotion.emotion, emotion.emotionType, emotion.demoText ?? ""]),
  ];

  const aliasParts = searchableAliasMap
    .filter(([text]) => baseParts.some((part) => part.includes(text)))
    .map(([, alias]) => alias);

  const segmentParts = item.speakerId
    .split(/[_-]+/)
    .filter(Boolean)
    .flatMap((segment) => [segment, segment.replace(/\d+/g, "")]);

  return normalizeSearchText([...baseParts, ...aliasParts, ...segmentParts].join(" "));
}

function normalizeLiveTimbres(result: OpenApiTimbreResult | null) {
  const timbres = result?.Timbres ?? [];
  return timbres.map((item) => {
    const firstInfo = item.TimbreInfos?.[0];
    const categories =
      firstInfo?.Categories?.map((category) => ({
        category: category.Category ?? "未分类",
        nextCategory: category.NextCategory?.Category ?? null,
      })) ?? [];
    const emotions =
      firstInfo?.Emotions?.map((emotion) => ({
        emotion: emotion.Emotion ?? "通用",
        emotionType: emotion.EmotionType ?? "general",
        demoText: emotion.DemoText,
        demoUrl: emotion.DemoURL,
      })) ?? [];

    const tags = [
      ...categories.flatMap((item) => [item.category, item.nextCategory].filter(Boolean) as string[]),
      ...emotions.slice(0, 2).map((item) => item.emotion),
    ].slice(0, 4);

    return {
      speakerId: item.SpeakerID,
      speakerName: firstInfo?.SpeakerName ?? item.SpeakerID,
      gender: firstInfo?.Gender ?? "未知",
      age: firstInfo?.Age ?? "未知",
      categories,
      emotions,
      tags,
      description:
        firstInfo?.SpeakerName && tags.length
          ? `${firstInfo.SpeakerName}，适合${tags.join(" / ")}等场景。`
          : "在线拉取的豆包语音音色。",
      previewText: emotions[0]?.demoText ?? "欢迎使用豆包语音音色管理功能。",
      previewUrl: emotions[0]?.demoUrl ?? null,
      avatarText: buildAvatarText(firstInfo?.SpeakerName ?? item.SpeakerID),
    } satisfies TimbreItem;
  });
}

export async function fetchOnlineTimbres() {
  const runtime = getVoiceManagementRuntime();
  try {
    return normalizeLiveTimbres(
      await callSpeechOpenApi<OpenApiTimbreResult>(
        "ListBigModelTTSTimbres",
        "2025-05-20",
        runtime.openApiProjectName ? { ProjectName: runtime.openApiProjectName } : {},
      ),
    );
  } catch {
    return [];
  }
}

function mergeCatalog(liveTimbres: TimbreItem[]) {
  const liveMap = new Map(liveTimbres.map((item) => [item.speakerId, item]));
  const merged = new Map<string, TimbreItem>();

  for (const fallback of fallbackCatalog) {
    merged.set(fallback.speakerId, {
      ...fallback,
      ...(liveMap.get(fallback.speakerId) ?? {}),
      speakerId: fallback.speakerId,
      previewUrl: liveMap.get(fallback.speakerId)?.previewUrl ?? fallback.previewUrl,
      previewText: liveMap.get(fallback.speakerId)?.previewText ?? fallback.previewText,
      description: liveMap.get(fallback.speakerId)?.description ?? fallback.description,
      avatarText: liveMap.get(fallback.speakerId)?.avatarText ?? fallback.avatarText,
      tags: liveMap.get(fallback.speakerId)?.tags?.length ? liveMap.get(fallback.speakerId)!.tags : fallback.tags,
    });
  }

  for (const live of liveTimbres) {
    if (!merged.has(live.speakerId)) {
      merged.set(live.speakerId, live);
    }
  }

  return Array.from(merged.values());
}

function persistTimbreLibrary(items: TimbreItem[]) {
  replaceStoredTimbres(
    items.map((item) => ({
      ...item,
      searchText: buildSearchIndex(item),
      updatedAt: new Date().toISOString(),
    })),
  );
}

export async function getUnifiedTimbreCatalog(options?: { forceRefresh?: boolean }) {
  const runtime = getVoiceManagementRuntime();
  const cachedItems = listStoredTimbres();
  const cacheMeta = getStoredTimbreLibraryMeta();
  const cacheAge = cacheMeta.syncedAt ? Date.now() - new Date(cacheMeta.syncedAt).getTime() : Number.POSITIVE_INFINITY;
  const shouldRefresh =
    options?.forceRefresh ||
    (runtime.timbreApiEnabled &&
      (cachedItems.length === 0 || cacheAge > runtime.timbreLibraryRefreshIntervalMs));

  if (shouldRefresh) {
    const liveTimbres = await fetchOnlineTimbres();
    if (liveTimbres.length === 0 && cachedItems.length > 0) {
      return mapTimbreCatalogDisplayOverrides(
        cachedItems.map(({ searchText: _searchText, updatedAt: _updatedAt, ...item }) => item),
      );
    }

    const mergedCatalog = mergeCatalog(liveTimbres);
    persistTimbreLibrary(mergedCatalog);
    return mapTimbreCatalogDisplayOverrides(mergedCatalog);
  }

  if (cachedItems.length > 0) {
    return mapTimbreCatalogDisplayOverrides(
      cachedItems.map(({ searchText: _searchText, updatedAt: _updatedAt, ...item }) => item),
    );
  }

  const fallbackMergedCatalog = mergeCatalog([]);
  persistTimbreLibrary(fallbackMergedCatalog);
  return mapTimbreCatalogDisplayOverrides(fallbackMergedCatalog);
}

export async function getRecommendedTimbres() {
  const catalog = await getUnifiedTimbreCatalog();
  const map = new Map(catalog.map((item) => [item.speakerId, item]));
  return recommendedSpeakerIds.map((speakerId) => map.get(speakerId)).filter((item): item is TimbreItem => Boolean(item));
}

export async function searchTimbres(keyword: string) {
  const catalog = await getUnifiedTimbreCatalog();
  const storedItems = listStoredTimbres();
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    const map = new Map(catalog.map((item) => [item.speakerId, item]));
    return searchableSpeakerIds.map((speakerId) => map.get(speakerId)).filter((item): item is TimbreItem => Boolean(item));
  }

  const normalizedKeyword = normalizeSearchText(normalized);
  const storedMap = new Map(storedItems.map((item) => [item.speakerId, item]));
  const compactKeyword = compactSearchText(normalized);

  return catalog
    .map((item) => {
      const storedItem = storedMap.get(item.speakerId);
      const haystack = storedItem?.searchText ?? buildSearchIndex(item);
      const compactHaystack = compactSearchText(haystack);
      const broadStoredScore = Math.max(
        getFuzzySearchScore(normalizedKeyword, haystack),
        getFuzzySearchScore(compactKeyword, compactHaystack),
      );
      const { nameScore, tagScore, descriptionScore, broadScore } = getFieldPriorityScore(item, normalized);
      const score = Math.max(broadStoredScore, broadScore);

      return {
        item,
        nameScore,
        tagScore,
        descriptionScore,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.nameScore !== left.nameScore) {
        return right.nameScore - left.nameScore;
      }

      if (right.tagScore !== left.tagScore) {
        return right.tagScore - left.tagScore;
      }

      if (right.descriptionScore !== left.descriptionScore) {
        return right.descriptionScore - left.descriptionScore;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.item.speakerName.localeCompare(right.item.speakerName, "zh-CN");
    })
    .map((entry) => entry.item);
}
