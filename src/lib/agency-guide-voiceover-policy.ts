import type { ShotPlan, ShotSubject } from "./video-task-schema";

type AgencyGuideVoiceoverShotLike = {
  shotIndex: number;
  purpose?: string | null;
  location?: string | null;
  action?: string | null;
  sceneDescription?: string | null;
  narrationHint?: string | null;
  functionTag?: string | null;
  sellingPointType?: string | null;
  hasCharacters?: boolean | null;
  characters?: string[] | null;
  subject?: Pick<ShotSubject, "mainCharacterCount" | "relationship" | "position"> | null;
};

const strongCharacterPattern =
  /(入住|前台|接待|办理|服务|讲解|导览|乘船|骑行|漂流|滑雪|温泉|泡汤|用餐|品尝|试吃|购物|互动|亲子|孩子|小朋友|拍照|打卡|体验|乘坐|玩乐|喂食|演出|表演|换装|旅拍|食客|住客|游客近景|人物近景)/u;
const explicitCharacterPattern =
  /(人物|游客|家庭|亲子|孩子|小朋友|爸爸|妈妈|情侣|服务员|前台|讲解员|体验者|乘客|食客|住客|旅客)/u;
const sceneryPriorityPattern =
  /(全景|远景|航拍|夜景|街景|建筑|地标|景色|景点|城墙|故宫|寺庙|博物馆|园林|海景|山景|湖景|酒店外观|房间空镜|走廊|大堂|环境|设施|摆盘|菜品特写|建筑细节|风光)/u;

function normalizePromptText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .trim();
}

function joinUniqueClauses(clauses: Array<string | null | undefined>, separator = "，") {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const clause of clauses) {
    const normalized = String(clause ?? "")
      .replace(/[，。；\s]+/g, "")
      .trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(String(clause).trim());
  }

  return normalizePromptText(result.join(separator));
}

function collectShotSourceText(shot: AgencyGuideVoiceoverShotLike) {
  return [
    shot.location,
    shot.action,
    shot.sceneDescription,
    shot.narrationHint,
    shot.functionTag,
    shot.sellingPointType,
    shot.subject?.relationship,
    shot.subject?.position,
  ]
    .filter(Boolean)
    .join("，");
}

function clearSubject(subject?: ShotSubject) {
  if (!subject) {
    return subject;
  }

  return {
    ...subject,
    mainCharacterCount: 0,
    mainCharacterGender: "",
    relationship: "",
    clothing: "",
    ageRange: "",
    features: "",
    appearance: "",
    style: "",
    position: "",
    extraCount: 0,
    extraDistribution: "",
    extraScale: "",
  } satisfies ShotSubject;
}

function normalizeSparseCharacterSubject(subject?: ShotSubject) {
  const current = subject ?? {
    mainCharacterCount: 1,
    mainCharacterGender: "",
    relationship: "",
    clothing: "",
    ageRange: "",
    features: "",
    appearance: "",
    style: "",
    position: "",
    extraCount: 0,
    extraDistribution: "",
    extraScale: "",
  };

  return {
    ...current,
    mainCharacterCount: Math.min(Math.max(current.mainCharacterCount || 1, 1), 2),
    position:
      current.position || "人物只作场景体验点缀，不抢景点主体，不占据画面中央大面积",
    extraCount: Math.min(Math.max(current.extraCount || 0, 0), 2),
    extraDistribution: current.extraDistribution || "自然分散在背景或边缘",
    extraScale: current.extraScale || "远景微小点缀",
  } satisfies ShotSubject;
}

export function getAgencyGuideVoiceoverMaxCharacterShots(totalShots: number) {
  return Math.max(0, Math.floor(totalShots * 0.2));
}

export function scoreAgencyGuideVoiceoverCharacterNeed(shot: AgencyGuideVoiceoverShotLike) {
  const sourceText = collectShotSourceText(shot);
  let score = 0;

  if (shot.hasCharacters) score += 2;
  if ((shot.subject?.mainCharacterCount ?? 0) > 0) score += 2;
  if (strongCharacterPattern.test(sourceText)) score += 4;
  if (explicitCharacterPattern.test(sourceText)) score += 2;
  if (shot.purpose === "experience" || shot.purpose === "climax") score += 1;
  if (shot.purpose === "detail" || shot.purpose === "transition") score -= 2;
  if (sceneryPriorityPattern.test(sourceText)) score -= 3;

  return score;
}

export function resolveAgencyGuideVoiceoverAllowedCharacterShotIndexes(shots: AgencyGuideVoiceoverShotLike[]) {
  const maxCharacterShots = getAgencyGuideVoiceoverMaxCharacterShots(shots.length);
  if (maxCharacterShots <= 0) {
    return new Set<number>();
  }

  return new Set(
    shots
      .map((shot) => ({
        shotIndex: shot.shotIndex,
        score: scoreAgencyGuideVoiceoverCharacterNeed(shot),
      }))
      .filter((item) => item.score >= 3)
      .sort((left, right) => right.score - left.score || left.shotIndex - right.shotIndex)
      .slice(0, maxCharacterShots)
      .map((item) => item.shotIndex),
  );
}

export function applyAgencyGuideVoiceoverSparseCharacters(plan: ShotPlan) {
  if (!plan.shots.length) {
    return plan;
  }

  const allowedShotIndexes = resolveAgencyGuideVoiceoverAllowedCharacterShotIndexes(plan.shots);
  const forbiddenRule =
    "空镜旁白类型：除强相关体验镜头外，禁止可识别主角/主体人物频繁出镜；全片有人物主体的镜头数量不得超过总镜头数的20%，普通镜头优先纯景色景点展示。";

  return {
    ...plan,
    styleConstraints: {
      ...plan.styleConstraints,
      forbidden: joinUniqueClauses([plan.styleConstraints?.forbidden, forbiddenRule], "；"),
    },
    reusableModules: {
      ...plan.reusableModules,
      characterSetting: "",
    },
    shots: plan.shots.map((shot) => {
      const shouldKeepCharacters =
        allowedShotIndexes.has(shot.shotIndex) &&
        (shot.hasCharacters || shot.characters.length > 0 || (shot.subject?.mainCharacterCount ?? 0) > 0);

      if (!shouldKeepCharacters) {
        return {
          ...shot,
          hasCharacters: false,
          hasTalent: false,
          characters: [],
          subject: clearSubject(shot.subject),
        };
      }

      return {
        ...shot,
        hasCharacters: true,
        hasTalent: false,
        characters: shot.characters.length > 0 ? shot.characters : ["游客"],
        subject: normalizeSparseCharacterSubject(shot.subject),
      };
    }),
  };
}

export function buildAgencyGuideVoiceoverVisualPrompt(input: {
  basePrompt: string;
  allowCharacter: boolean;
  totalShots: number;
}) {
  const maxCharacterShots = getAgencyGuideVoiceoverMaxCharacterShots(input.totalShots);
  const coverageRule =
    maxCharacterShots > 0
      ? `这是空镜旁白的旅行攻略图像，全片 ${input.totalShots} 个镜头里最多 ${maxCharacterShots} 个镜头允许出现可识别主体人物`
      : "这是空镜旁白的旅行攻略图像，本次镜头总数较少，因此本组图片全部不要可识别主体人物";

  if (input.allowCharacter && maxCharacterShots > 0) {
    return joinUniqueClauses([
      input.basePrompt,
      coverageRule,
      "本镜头属于少量允许人物点缀的强相关体验场景，人物只作真实体验参照",
      "人物不要成为画面主角，不要居中大特写，不要拍成人像写真感",
      "景点、环境、设施或玩法内容才是主体，若有其他人也只作自然远景点缀",
      "不要形成统一主角连续出镜的观感",
    ]);
  }

  return joinUniqueClauses([
    input.basePrompt,
    coverageRule,
    "本镜头属于普通景点、景色、地标或环境展示，严格不要主角人物或可识别主体人物出镜",
    "不要游客摆拍，不要正面人像，不要人物居中占画面",
    "主体必须是景点、建筑、环境、设施或菜品本身，若必须出现路人，也只能是远景微小且不可识别的自然点缀",
  ]);
}
