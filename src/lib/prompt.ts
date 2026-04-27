const visualAngles = [
  "清晨第一缕阳光照在酒店外立面",
  "旅客第一视角进入酒店大堂",
  "露台视角俯瞰城市或山海景观",
  "餐饮与度假设施的动态切换",
  "情侣或家庭轻松入住的真实片段",
  "夜景灯光与休闲氛围的沉浸式镜头",
];

const conversionHooks = [
  "强调值得立即预订的理由",
  "突出限时感和稀缺感",
  "自然带出适合周末度假或短途出行",
  "强化真实体验感与性价比",
  "用轻决策表达降低用户下单门槛",
];

const platformStyles = [
  "抖音爆款同款节奏，3 秒内给出核心卖点",
  "小红书旅行种草质感，镜头克制且真实",
  "本地生活团购转化风格，突出场景和权益",
  "酒店探店纪实风格，减少悬浮夸张表达",
];

export const defaultVideoNegativePrompt =
  "watermark, text overlay, text in image, letters, numbers, words, signage text, collage, split screen, multi-panel, deformed face, distorted hands, extra fingers, low resolution, blurry, overacted expression, static pose, empty scene, single adult, two adults one child, strong AI motion, unrealistic proportions, physically impossible scene";

export const klingGenerationProfile = {
  defaultDurationSeconds: 15,
  minDurationSeconds: 3,
  maxDurationSeconds: 15,
  durationOptionsSeconds: [3, 5, 8, 10, 12, 15],
  defaultMode: "std",
  modeOptions: ["std", "pro"] as const,
  aspectRatio: "9:16",
  aspectRatioOptions: ["16:9", "9:16", "1:1"] as const,
  shotType: "customize",
  shotTypeOptions: ["customize", "intelligence"] as const,
  generateAudio: false,
  defaultCfgScale: 0.5,
  cfgScaleOptions: [0.3, 0.5, 0.7, 0.9],
  cameraControlOptions: ["auto", "down_back", "forward_up", "right_turn_forward", "left_turn_forward"] as const,
  watermark: false,
  negativePrompt: defaultVideoNegativePrompt,
} as const;

export type KlingStoryboardPrompt = {
  index: number;
  prompt: string;
  duration: number;
};

export type KlingGenerationSettings = {
  durationSeconds: number;
  mode: (typeof klingGenerationProfile.modeOptions)[number];
  aspectRatio: (typeof klingGenerationProfile.aspectRatioOptions)[number];
  shotType: (typeof klingGenerationProfile.shotTypeOptions)[number];
  multiShot: boolean;
  multiPrompt: KlingStoryboardPrompt[];
  generateAudio: boolean;
  cfgScale: number;
  cameraControl: (typeof klingGenerationProfile.cameraControlOptions)[number];
  watermark: boolean;
  negativePrompt: string;
  sourceImageUrl?: string;
  tailImageUrl?: string;
};

export function getDefaultKlingGenerationSettings(): KlingGenerationSettings {
  return {
    durationSeconds: klingGenerationProfile.defaultDurationSeconds,
    mode: klingGenerationProfile.defaultMode,
    aspectRatio: klingGenerationProfile.aspectRatio,
    shotType: klingGenerationProfile.shotType,
    multiShot: false,
    multiPrompt: [],
    generateAudio: klingGenerationProfile.generateAudio,
    cfgScale: klingGenerationProfile.defaultCfgScale,
    cameraControl: "auto",
    watermark: klingGenerationProfile.watermark,
    negativePrompt: defaultVideoNegativePrompt,
  };
}

function pick<T>(list: T[], indexSeed: number) {
  return list[indexSeed % list.length];
}

function hashPrompt(prompt: string) {
  return Array.from(prompt).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

function hasFamilyTravelContext(prompt: string) {
  return /(亲子|家庭|爸爸|妈妈|小孩|儿童|一家四口|2大2小|度假氛围)/.test(prompt);
}

function hasStoryboardContext(prompt: string) {
  return /(镜头|Day1|Day2|Day3|Day4|白天|傍晚|夜晚|次日|时间推进)/.test(prompt);
}

export function buildTravelVideoPrompt(rawPrompt: string) {
  const normalizedPrompt = rawPrompt.trim().replace(/\s+/g, " ");
  const seed = hashPrompt(`${normalizedPrompt}-${Date.now()}`);

  const angle = pick(visualAngles, seed);
  const hook = pick(conversionHooks, seed + 3);
  const style = pick(platformStyles, seed + 7);

  const globalConstraints = [
    "全局生成约束（必须放最前并优先满足）：视频类型为真实旅行记录风，偏抖音原生内容表达，不要广告摆拍感。",
    "视觉基调：高细节、真实光影、真实建筑结构、真实旅行动线，避免廉价 AI 质感。",
    "镜头语言：运镜自然，以轻微跟拍和平滑移动为主，不剧烈晃动；节奏自然，不快剪，不拖沓。",
  ];

  const narrativeConstraints = hasFamilyTravelContext(normalizedPrompt)
    ? [
        "人物一致性（强约束）：固定家庭角色为爸爸、妈妈和两个约 2-8 岁的小孩，所有镜头必须出现人物，服装、发型、年龄和体态保持稳定一致。",
        "出镜组合约束：只允许 2大2小、1大2小、2小，禁止 2大1小、仅大人、单人镜头。",
        "行为约束：每个镜头都必须有人物动作和家庭互动，如走、看、吃、玩、拍照，禁止静止摆拍和空镜。",
      ]
    : [];

  const continuityConstraints = hasStoryboardContext(normalizedPrompt)
    ? [
        "时间推进（强约束）：必须明确体现白天、下午、傍晚、夜晚到次日的时间变化。",
        "动作衔接（强约束）：镜头之间要按走、进入、看、玩、吃、离开的连续行为逻辑衔接，不能彼此割裂。",
      ]
    : [];

  const optimizedPrompt = [
    ...globalConstraints,
    ...narrativeConstraints,
    ...continuityConstraints,
    "生成一条适合酒旅商家投放和自然种草的短视频。",
    "视频要求真实、具备商业转化感，不要出现科幻、低质、变形、抽象的画面。",
    `用户提供的核心信息：${normalizedPrompt}。`,
    `镜头重点：${angle}。`,
    `内容目标：${hook}。`,
    `成片风格：${style}。`,
    "画面要求：真实人物比例、真实建筑结构、真实旅行动线、自然光影、电影级构图、细节清晰。",
    "节奏要求：前 3 秒快速建立目的地吸引力，中段展示核心体验，结尾形成明确但不过度强推的行动冲动。",
    "避免重复模板感，镜头语言和卖点组织要自然，像真实商家拍摄升级版。",
    "禁止项：水印、畸形人物、脸崩、低清晰度、夸张表情、强 AI 感动作、无人物空镜。",
  ].join(" ");

  return {
    optimizedPrompt,
    strategy: {
      angle,
      hook,
      style,
    },
  };
}
