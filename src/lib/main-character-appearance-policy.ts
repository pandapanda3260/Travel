import type { ShotPlan, ShotSubject, VideoTaskSource } from "./video-task-schema";

const foreignKeywordPattern =
  /(外国人|老外|欧美|欧洲|美国|英国|法国|德国|俄罗斯|白人|黑人|拉美|混血|西方|异域|日本人|韩国人|日系|韩系|金发碧眼|高鼻深目|欧美脸|欧美长相|欧美面孔|西方面孔)/iu;
const foreignDescriptorPattern =
  /(外国人|老外|欧美(?:脸|长相|面孔|气质|风)?|欧洲(?:脸|人)?|美国(?:人)?|英国(?:人)?|法国(?:人)?|德国(?:人)?|俄罗斯(?:人)?|白人|黑人|拉美(?:人)?|混血|西方(?:脸|面孔|长相)?|异域(?:脸|面孔|长相|风情)?|日本人|韩国人|日系|韩系|金发碧眼|高鼻深目|欧美模特感|西方面孔)/giu;
const personContextPattern =
  /(人物|主角|模特|游客|旅客|家庭|夫妻|亲子|女生|男生|女人|男人|小孩|孩子|面孔|脸|长相|外貌|形象|演员|主持人|博主|导游|讲解员|爸爸|妈妈)/iu;
const explicitForeignAllowPattern =
  /((外国人|老外|欧美|欧洲|美国|英国|法国|德国|俄罗斯|白人|黑人|拉美|混血|西方|异域|日本人|韩国人|日系|韩系).{0,8}(人物|主角|模特|游客|旅客|家庭|夫妻|亲子|女生|男生|面孔|脸|长相|外貌|形象|演员|主持人|博主|导游|讲解员))|((人物|主角|模特|游客|旅客|家庭|夫妻|亲子|女生|男生|面孔|脸|长相|外貌|形象|演员|主持人|博主|导游|讲解员).{0,8}(外国人|老外|欧美|欧洲|美国|英国|法国|德国|俄罗斯|白人|黑人|拉美|混血|西方|异域|日本人|韩国人|日系|韩系))/iu;
const explicitForeignDenyPattern =
  /(不要|不能|禁止|避免).{0,6}(外国人|老外|欧美|欧洲|美国|英国|法国|德国|俄罗斯|白人|黑人|拉美|混血|西方|异域|日本人|韩国人|日系|韩系)|(?:外国人|老外|欧美|欧洲|美国|英国|法国|德国|俄罗斯|白人|黑人|拉美|混血|西方|异域|日本人|韩国人|日系|韩系).{0,6}(不要|不能|禁止|避免)/iu;
const olderPersonRequestPattern =
  /(老人|老年人|老年|长辈|爷爷|奶奶|外公|外婆|姥姥|姥爷|老两口|老夫妻|叔叔阿姨|爸妈辈|中老年)/iu;
const highAgeDescriptorPattern =
  /(高龄|60岁以上|6\d岁|7\d岁|8\d岁|9\d岁|六十多岁|七十多岁|八十多岁|九十多岁|花甲|古稀|耄耋|白发苍苍|满头白发|头发全白|花白头发|银发|白发|拄拐|拐杖|手杖|驼背|满脸皱纹|深皱纹|老态龙钟|老爷爷|老奶奶|老太太|老大爷|高龄感|老年感|老人感)/giu;
const weakOlderDescriptorPattern =
  /^(老人|老年人|老年|长辈|爷爷|奶奶|外公|外婆|姥姥|姥爷|中老年)$/u;
const seniorAgeRangePattern =
  /((?:6\d|7\d|8\d|9\d)\s*(?:岁)?(?:\s*[-~到至]\s*(?:6\d|7\d|8\d|9\d)\s*(?:岁)?)?)|(六十[\u4e00-\u9fa5]{0,3}|七十[\u4e00-\u9fa5]{0,3}|八十[\u4e00-\u9fa5]{0,3}|九十[\u4e00-\u9fa5]{0,3}|老人|老年人|老年|高龄|花甲|古稀|耄耋)/iu;
const olderReferenceSofteningPattern =
  /(老人家|老人|老年人|老年|长辈|老两口|老夫妻|爷爷奶奶|外公外婆|姥姥姥爷)/giu;
const pickupDriverPattern =
  /(接机|接站|机场接送|高铁站接送|火车站接送|站点接送|专车司机|出租车司机|网约车司机|接送司机|机场司机|车站司机|举牌接机|司机接待|司机迎接|专车接送|出租车接送)/iu;
const driverRolePattern =
  /(司机|专车|出租车|网约车|接机|接站|礼宾接送|机场接送|车站接送)/iu;
const driverUniformPattern =
  /(制服|工装|制式|礼宾制服|司机制服|帽檐|帽子|白手套|肩章|领结|领花|徽章|统一着装|迎宾制服|职业制服)/giu;
const taxiVehiclePattern =
  /(出租车|打车|的士|计程车|网约车|专车)/iu;
const pickupVehicleScenePattern =
  /(接机|接站|机场接送|高铁站接送|火车站接送|站点接送|司机迎接|举牌接机|专车接送|出租车接送|接送场景|接人上车|下车迎接)/iu;
const greatWallScenePattern =
  /(长城|八达岭|慕田峪|居庸关|司马台|金山岭)/iu;
const parkingLotScenePattern =
  /(停车场|停车区|停车位|上客区|下客区|落客区|候客区|临停区|临时停车区|接客区|网约车上客点|出租车上客点)/iu;
const nonParkingLotScenePattern =
  /(不是停车场|并非停车场|非停车场|不是停车位|并非停车位|不是上客区|并非上客区|不是下客区|并非下客区)/iu;

const chinaTaxiVehicleRule =
  "如出现出租车，车辆外观统一使用中国大陆常见城市出租车或网约车样式，例如大众朗逸/桑塔纳、丰田卡罗拉、比亚迪秦PLUS、红旗E-QM5等常见三厢轿车或新能源出租车；不要日本 Crown Comfort、JPN Taxi 或其他海外出租车样式。";
const chinaTaxiTrafficRule =
  "如出现出租车或专车接送场景，必须遵循中国大陆道路规则：车辆靠道路右侧通行，驾驶员位于车辆左侧驾驶位（左舵），不要右舵，不要把司机画在车内右侧。";
const chinaTaxiParkingRule =
  "如出现出租车或专车接人的场景，车辆必须沿道路右侧路边规整停靠或在合法上客区整齐停放，不要斜停、横停、逆向停靠或乱停在马路边。";
const greatWallHistoricSceneRule =
  "如画面主体是长城城墙、敌楼或墙顶步道，不要在长城上出现出租车、观光车、固定座椅、停车位白线、停车格或现代停车场设施，保持古迹空间真实状态。";
const nonParkingLotRoadsideRule =
  "如出租车或专车只是停靠在普通道路路边，且场景未明确是停车场、停车位或上客区，不要在车旁地面画停车位白线、停车格或停车场线框。";

function normalizeText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[，]{2,}/g, "，")
    .replace(/[。]{2,}/g, "。")
    .trim();
}

function buildSourceText(source: VideoTaskSource) {
  return [
    source.productInfoTitle,
    source.productInfoSnapshot,
    source.userPrompt,
    source.videoTemplatePrompt,
  ]
    .filter(Boolean)
    .join("，");
}

function appendUniqueClause(baseText: string, clause: string) {
  const normalizedBase = normalizeText(baseText);
  if (!clause.trim()) {
    return normalizedBase;
  }

  const clauseKey = clause.replace(/[，。；\s]+/g, "").trim();
  if (!clauseKey) {
    return normalizedBase;
  }

  const compactBase = normalizedBase.replace(/[，。；\s]+/g, "");
  if (compactBase.includes(clauseKey)) {
    return normalizedBase;
  }

  const hasClause = normalizedBase
    .split(/(?<=[，。；])/)
    .map((item) => item.replace(/[，。；\s]+/g, "").trim())
    .some((item) => item === clauseKey);

  if (hasClause) {
    return normalizedBase;
  }

  if (!normalizedBase) {
    return normalizeText(clause);
  }

  const needsSeparator = !/[，。；]$/.test(normalizedBase);
  return normalizeText(`${normalizedBase}${needsSeparator ? "，" : ""}${clause}`);
}

function stripForeignDescriptors(text: string) {
  return normalizeText(
    text
      .replace(foreignDescriptorPattern, "")
      .replace(/[，、]{2,}/g, "，")
      .replace(/^[，、\s]+|[，、\s]+$/g, ""),
  );
}

function isWeakDescriptor(text: string) {
  const normalized = normalizeText(text).replace(/[，。；、]/g, "");
  if (!normalized) {
    return true;
  }

  return /^(女生|男生|女人|男人|感|风|气质|脸|面孔|长相|形象)$/u.test(normalized) || normalized.length <= 1;
}

function stripHighAgeDescriptors(text: string) {
  return normalizeText(
    text
      .replace(highAgeDescriptorPattern, "")
      .replace(/[，、]{2,}/g, "，")
      .replace(/^[，、\s]+|[，、\s]+$/g, ""),
  );
}

function softenOlderReferences(text: string) {
  return normalizeText(
    text
      .replace(olderReferenceSofteningPattern, "中老年")
      .replace(/[，、]{2,}/g, "，")
      .replace(/^[，、\s]+|[，、\s]+$/g, ""),
  );
}

function impliesOlderPerson(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return olderPersonRequestPattern.test(normalized) || seniorAgeRangePattern.test(normalized);
}

function stripDriverUniformDescriptors(text: string) {
  return normalizeText(
    text
      .replace(driverUniformPattern, "")
      .replace(/[，、]{2,}/g, "，")
      .replace(/^[，、\s]+|[，、\s]+$/g, ""),
  );
}

function impliesPickupDriver(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return pickupDriverPattern.test(normalized) || driverRolePattern.test(normalized);
}

function impliesTaxiVehicle(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return taxiVehiclePattern.test(normalized);
}

function impliesPickupVehicleScene(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return pickupVehicleScenePattern.test(normalized) || pickupDriverPattern.test(normalized);
}

function impliesGreatWallScene(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return greatWallScenePattern.test(normalized);
}

function impliesParkingLotScene(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  if (nonParkingLotScenePattern.test(normalized)) {
    return false;
  }

  return parkingLotScenePattern.test(normalized);
}

function sanitizeAgeRange(ageRange: string, needsOlderButNotSenior: boolean) {
  const cleaned = normalizeText(ageRange);
  if (!cleaned) {
    return needsOlderButNotSenior ? "45-60岁中老年" : "";
  }

  if (seniorAgeRangePattern.test(cleaned)) {
    return "45-60岁中老年";
  }

  return cleaned;
}

function sanitizeSubject(
  subject: ShotSubject | undefined,
  input: {
    allowForeignMainCharacter: boolean;
    sourceRequestsOlderPerson: boolean;
    shotContextText: string;
  },
) {
  if (!subject || (subject.mainCharacterCount ?? 0) <= 0) {
    return subject;
  }

  const originalBundle = [
    subject.ageRange,
    subject.appearance,
    subject.features,
    subject.style,
    subject.relationship,
    subject.clothing,
    input.shotContextText,
  ]
    .filter(Boolean)
    .join("，");
  const needsOlderButNotSenior = input.sourceRequestsOlderPerson || impliesOlderPerson(originalBundle);
  const needsPickupDriverLook = impliesPickupDriver(originalBundle);

  const appearance = stripDriverUniformDescriptors(stripHighAgeDescriptors(
    input.allowForeignMainCharacter ? subject.appearance ?? "" : stripForeignDescriptors(subject.appearance ?? ""),
  ));
  const features = stripDriverUniformDescriptors(stripHighAgeDescriptors(
    input.allowForeignMainCharacter ? subject.features ?? "" : stripForeignDescriptors(subject.features ?? ""),
  ));
  const style = stripDriverUniformDescriptors(softenOlderReferences(stripHighAgeDescriptors(
    input.allowForeignMainCharacter ? subject.style ?? "" : stripForeignDescriptors(subject.style ?? ""),
  )));
  const clothing = stripDriverUniformDescriptors(stripHighAgeDescriptors(
    input.allowForeignMainCharacter ? subject.clothing ?? "" : stripForeignDescriptors(subject.clothing ?? ""),
  ));
  const ageRange = sanitizeAgeRange(subject.ageRange ?? "", needsOlderButNotSenior);

  return {
    ...subject,
    ageRange,
    clothing:
      needsPickupDriverLook
        ? "普通深色西装"
        : isWeakDescriptor(clothing) || weakOlderDescriptorPattern.test(normalizeText(clothing))
          ? subject.clothing ?? ""
          : clothing,
    appearance:
      isWeakDescriptor(softenOlderReferences(appearance))
        ? needsOlderButNotSenior
          ? `${input.allowForeignMainCharacter ? "" : "自然东方面孔，"}45-60岁中老年状态`.replace(/^，/, "")
          : input.allowForeignMainCharacter
            ? ""
            : "自然东方面孔"
        : softenOlderReferences(appearance),
    features: isWeakDescriptor(features) || weakOlderDescriptorPattern.test(normalizeText(features)) ? "" : features,
    style:
      needsPickupDriverLook
        ? appendUniqueClause(
            isWeakDescriptor(style) || weakOlderDescriptorPattern.test(normalizeText(style)) ? "" : style,
            "普通深色西装司机形象，不要制服感",
          )
        : isWeakDescriptor(style) || weakOlderDescriptorPattern.test(normalizeText(style))
          ? ""
          : style,
  } satisfies ShotSubject;
}

export function shouldAllowForeignMainCharacter(source: VideoTaskSource) {
  const sourceText = buildSourceText(source);
  if (!sourceText.trim()) {
    return false;
  }

  if (explicitForeignDenyPattern.test(sourceText)) {
    return false;
  }

  if (explicitForeignAllowPattern.test(sourceText)) {
    return true;
  }

  return false;
}

export function getMainCharacterAppearancePolicy(source: VideoTaskSource) {
  const allowForeignMainCharacter = shouldAllowForeignMainCharacter(source);
  const sourceRequestsOlderPerson = impliesOlderPerson(buildSourceText(source));
  return {
    allowForeignMainCharacter,
    sourceRequestsOlderPerson,
    maxSeniorVisualAgeYears: 60,
    defaultAppearance: allowForeignMainCharacter ? "" : "主要人物默认自然东方面孔，不要外国人形象",
    olderCharacterRule:
      "如出现老人/长辈，只允许年龄偏大的中老年状态，视觉年龄控制在45-60岁，不要60岁以上高龄老人形象。",
    summary: allowForeignMainCharacter
      ? sourceRequestsOlderPerson
        ? "当前需求明确要求外国人/海外人物形象；如涉及老人，也只保留45-60岁中老年状态。"
        : "当前需求明确要求外国人/海外人物形象，可按需求保留。"
      : sourceRequestsOlderPerson
        ? "如未明确要求外国人，主要人物默认自然东方面孔；如涉及老人，也只保留45-60岁中老年状态。"
        : "如未明确要求外国人，主要人物默认自然东方面孔，不要外国人形象。",
  };
}

export function applyMainCharacterAppearancePolicy(plan: ShotPlan, source: VideoTaskSource) {
  const policy = getMainCharacterAppearancePolicy(source);
  const forbiddenRules = [
    policy.allowForeignMainCharacter
      ? ""
      : "除非需求明确要求外国人，否则主要人物默认自然东方面孔，不要外国人形象或明显西方面孔。",
    "如出现老人或长辈，只能表现为45-60岁的中老年状态；不要60岁以上高龄老人形象，不要头发全白、拄拐、驼背、满脸深皱纹。",
    "如出现接机/接站的出租车司机或专车司机，不要制服、帽子、白手套等礼宾/司机制服特征，统一按普通西装形象处理。",
    chinaTaxiVehicleRule,
    chinaTaxiTrafficRule,
    chinaTaxiParkingRule,
  ].filter(Boolean);

  return {
    ...plan,
    styleConstraints: {
      ...plan.styleConstraints,
      forbidden: forbiddenRules.reduce(
        (text, rule) => appendUniqueClause(text, rule),
        plan.styleConstraints?.forbidden ?? "",
      ),
    },
    reusableModules: {
      ...plan.reusableModules,
      characterSetting: (() => {
        const cleaned = softenOlderReferences(stripHighAgeDescriptors(
          policy.allowForeignMainCharacter
            ? plan.reusableModules?.characterSetting ?? ""
            : stripForeignDescriptors(plan.reusableModules?.characterSetting ?? ""),
        ));
        if (isWeakDescriptor(cleaned)) {
          return policy.sourceRequestsOlderPerson
            ? `${policy.allowForeignMainCharacter ? "" : "主要人物默认自然东方面孔，"}45-60岁中老年状态`.replace(/^，/, "")
            : policy.allowForeignMainCharacter
              ? ""
              : "主要人物默认自然东方面孔";
        }
        const withNationality = policy.allowForeignMainCharacter
          ? cleaned
          : appendUniqueClause(cleaned, "主要人物默认自然东方面孔");
        const withOlderRule = appendUniqueClause(
          withNationality,
          "如出现老人或长辈，只表现为45-60岁中老年状态，不要白发拄拐的高龄老人",
        );
        return appendUniqueClause(
          withOlderRule,
          "如出现接机/接站司机，统一普通深色西装，不要司机制服或礼宾制服",
        );
      })(),
    },
    shots: plan.shots.map((shot) => ({
      ...shot,
      subject: sanitizeSubject(shot.subject, {
        allowForeignMainCharacter: policy.allowForeignMainCharacter,
        sourceRequestsOlderPerson: policy.sourceRequestsOlderPerson,
        shotContextText: [
          shot.location,
          shot.action,
          shot.sceneDescription,
          shot.narrationHint,
          shot.functionTag,
          shot.sellingPointType,
        ]
          .filter(Boolean)
          .join("，"),
      }),
    })),
  };
}

export function appendMainCharacterAppearancePrompt(
  basePrompt: string,
  input: {
    hasMainCharacter: boolean;
    source: VideoTaskSource;
    sceneContextText?: string;
  },
) {
  const sceneBundle = [input.sceneContextText, basePrompt].filter(Boolean).join("，");
  const needsPickupDriverLook = impliesPickupDriver(sceneBundle);
  const needsTaxiVehicleLook = impliesTaxiVehicle(sceneBundle);
  const needsPickupVehicleParking = impliesPickupVehicleScene(sceneBundle);
  const needsGreatWallSceneRule = impliesGreatWallScene(sceneBundle);
  const allowsParkingLotMarkings = impliesParkingLotScene(sceneBundle);

  if (!input.hasMainCharacter && !needsTaxiVehicleLook && !needsPickupVehicleParking && !needsGreatWallSceneRule) {
    return normalizeText(basePrompt);
  }

  const policy = getMainCharacterAppearancePolicy(input.source);
  const clauses = [
    input.hasMainCharacter ? (policy.allowForeignMainCharacter ? "" : "主要人物使用自然东方面孔，不要外国人面孔，除非任务明确要求") : "",
    input.hasMainCharacter
      ? "如出现老人或长辈，只允许45-60岁中老年状态，不要60岁以上高龄老人，不要头发全白、拄拐、驼背或满脸深皱纹"
      : "",
    needsPickupDriverLook ? "如出现接机或接站的出租车/专车司机，使用普通深色西装，不要制服、帽子、白手套或礼宾制服感" : "",
    needsTaxiVehicleLook ? chinaTaxiVehicleRule.replace(/。$/, "") : "",
    needsTaxiVehicleLook || needsPickupVehicleParking ? chinaTaxiTrafficRule.replace(/。$/, "") : "",
    needsPickupVehicleParking ? chinaTaxiParkingRule.replace(/。$/, "") : "",
    needsPickupVehicleParking && !allowsParkingLotMarkings ? nonParkingLotRoadsideRule.replace(/。$/, "") : "",
    needsGreatWallSceneRule ? greatWallHistoricSceneRule.replace(/。$/, "") : "",
    input.hasMainCharacter ? "人物肢体结构必须自然合理，不要多手、多胳膊、多腿、多脚、融合肢体或缺失肢体" : "",
  ].filter(Boolean);
  return clauses.reduce((prompt, clause) => appendUniqueClause(prompt, clause), basePrompt);
}

export function containsForeignMainCharacterDescriptor(text: string) {
  const normalized = normalizeText(text);
  return foreignKeywordPattern.test(normalized) && personContextPattern.test(normalized);
}
