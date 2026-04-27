import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { dbGetAll, dbGetSingleton, dbReplaceAll, dbSetSingleton } from "./db";
import {
  getDefaultTaskCreationParameterState,
  getTaskCreationExpectedDurationDefaults,
} from "./task-creation-parameters";
import {
  detectConstraintPreset,
  getVideoTaskTypeProfile,
  normalizeVideoTaskSource,
  taskConstraintPresets,
  type ShotPlan,
  type VideoTaskRecord,
  type VideoTaskStatus,
  type VideoTaskVideoType,
} from "./video-task-schema";

const PRODUCT_ARCHIVE_COLLECTION = "product-archives";
const VIDEO_MATERIAL_COLLECTION = "video-materials";
const VIDEO_TASK_COLLECTION = "video-tasks";
const IMPORT_STATE_COLLECTION = "legacy-local-import-state";

const GENERIC_PRODUCT_NAMES = new Set(["通用视频生成任务", "直接提示词视频任务", "未命名任务"]);
const PLACEHOLDER_LOCATIONS = new Set(["默认场景", "未指定地点"]);
const PLACEHOLDER_TARGET_PEOPLE = new Set(["通用"]);
const PLACEHOLDER_SELLING_POINTS = new Set(["突出核心体验与画面质感", "按提示词直接生成"]);
const LEGACY_DB_CANDIDATE_PATHS = [
  process.env.TRAVEL_LEGACY_APP_DB_PATH?.trim() ?? "",
  process.env.LEGACY_TRAVEL_APP_DB_PATH?.trim() ?? "",
  "/Users/bytedance/Documents/trae_projects/代码备份留存/AIGC/backend/data/app.db",
  join(/* turbopackIgnore: true */ process.cwd(), "..", "代码备份留存", "AIGC", "backend", "data", "app.db"),
];

type ImportState = {
  sourceDbPath: string | null;
  productArchivesImported: boolean;
  videoMaterialsImported: boolean;
  videoTasksImported: boolean;
};

type LegacyTaskRow = {
  id: string;
  product_name: string | null;
  location: string | null;
  selling_points: string | null;
  price_info: string | null;
  target_people: string | null;
  mode: string | null;
  status: string | null;
  current_step: string | null;
  step_statuses: string | null;
  created_at: string | null;
  updated_at: string | null;
  selected_template_id: string | null;
  selected_template_name: string | null;
  manual_prompt: string | null;
  supplemental_prompt: string | null;
  duration_option: string | null;
  visual_style_constraint: string | null;
  negative_constraints: string | null;
  shot_pacing: string | null;
  subject_consistency: string | null;
  camera_motion_strength: string | null;
};

type LegacyScriptRow = {
  id: string;
  task_id: string;
  variant_index: number | null;
  title: string | null;
  hook: string | null;
  lines: string | null;
  cta: string | null;
  created_at: string | null;
};

type LegacyStoryboardSlot = {
  slot?: number | null;
  purpose?: string | null;
  scene_type?: string | null;
  duration?: number | null;
  desc?: string | null;
  asset_id?: string | null;
};

type LegacyStoryboardRow = {
  id: string;
  task_id: string;
  variant_index: number | null;
  slots: string | null;
  created_at: string | null;
};

type LegacyVideoTemplateRow = {
  id: string;
  name: string | null;
  source_type: string | null;
  status: string | null;
  video_url: string | null;
  structure_summary: string | null;
  expression_style: string | null;
  style_tags: string | null;
  created_at: string | null;
};

type LegacyProductDescriptor = {
  archiveId: string;
  title: string;
  parsedText: string;
  parsedData: {
    rawText: string;
    summaryTitle: string;
    packagePersonCount: string;
    tags: string[];
    sellingPoints: string[];
  };
  keyInfo: {
    productName: string;
    originalPrice: string;
    redeemPrice: string;
    packagePersonCount: string;
  };
};

function getDefaultImportState(): ImportState {
  return {
    sourceDbPath: null,
    productArchivesImported: false,
    videoMaterialsImported: false,
    videoTasksImported: false,
  };
}

function readImportState() {
  const state = dbGetSingleton<Partial<ImportState>>(IMPORT_STATE_COLLECTION);
  return {
    ...getDefaultImportState(),
    ...state,
  } satisfies ImportState;
}

function writeImportState(patch: Partial<ImportState>) {
  const next = {
    ...readImportState(),
    ...patch,
  } satisfies ImportState;
  dbSetSingleton(IMPORT_STATE_COLLECTION, next);
  return next;
}

function listCollectionRecords(collection: string) {
  try {
    return dbGetAll<unknown>(collection);
  } catch {
    return [];
  }
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function toIsoTimestamp(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return new Date().toISOString();
  }

  const date = new Date(normalized.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }

  try {
    return JSON.parse(normalized) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(value: string | null | undefined) {
  const parsed = safeJsonParse<unknown[]>(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((item) => normalizeText(String(item ?? ""))).filter(Boolean);
}

function parseStoryboardSlots(value: string | null | undefined) {
  const parsed = safeJsonParse<LegacyStoryboardSlot[]>(value, []);
  if (!Array.isArray(parsed)) {
    return [] as LegacyStoryboardSlot[];
  }

  return parsed
    .map((slot) => ({
      slot: Number(slot.slot) || null,
      purpose: normalizeText(slot.purpose),
      scene_type: normalizeText(slot.scene_type),
      duration: typeof slot.duration === "number" && Number.isFinite(slot.duration) ? slot.duration : null,
      desc: normalizeMultilineText(slot.desc),
      asset_id: normalizeText(slot.asset_id),
    }))
    .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));
}

function buildIndexedBlockText(label: string, texts: string[]) {
  return texts.map((text, index) => `${label}${index + 1}：${text.trim()}`).join("\n");
}

function joinParts(parts: Array<string | null | undefined>, separator = "\n") {
  return parts.map((part) => normalizeText(part)).filter(Boolean).join(separator);
}

function isStructuredLegacyPrompt(value: string | null | undefined) {
  return /(视频标题|视频脚本|结构化商品信息|镜头\s*1|【镜头1|【视频脚本】)/.test(String(value ?? ""));
}

function extractLegacyVideoTitle(value: string | null | undefined) {
  const normalized = String(value ?? "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return "";
  }

  const lines = normalized.split("\n").map((line) => line.trim());
  const titleIndex = lines.findIndex((line) => /视频标题/.test(line));
  if (titleIndex >= 0) {
    for (let index = titleIndex + 1; index < lines.length; index += 1) {
      const candidate = lines[index];
      if (candidate && !/^[-#*]+$/.test(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function extractOriginalPrice(value: string | null | undefined) {
  const normalized = String(value ?? "");
  return (
    normalized.match(/原价[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/)?.[1]?.trim() ??
    normalized.match(/门市价[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/)?.[1]?.trim() ??
    ""
  );
}

function extractPackagePersonCount(input: {
  productName: string;
  targetPeople: string;
  sellingPoints: string[];
  prompt: string;
}) {
  const combined = [input.productName, input.targetPeople, ...input.sellingPoints, input.prompt].join(" ");
  return (
    combined.match(/(\d+\s*人)/)?.[1]?.replace(/\s+/g, "") ??
    combined.match(/(2大2小|两大两小|一家四口|情侣|亲子|家庭)/)?.[1] ??
    ""
  );
}

function resolveLegacyDbPath() {
  for (const candidate of LEGACY_DB_CANDIDATE_PATHS) {
    const normalized = candidate.trim();
    if (!normalized || !existsSync(normalized)) {
      continue;
    }

    try {
      const db = new Database(normalized, { readonly: true, fileMustExist: true });
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => String((row as { name: string }).name)),
      );
      db.close();

      if (tables.has("tasks") && tables.has("scripts") && tables.has("storyboards")) {
        return normalized;
      }
    } catch {
      // ignore invalid candidate
    }
  }

  return null;
}

function withLegacyDb<T>(runner: (db: Database.Database) => T) {
  const dbPath = resolveLegacyDbPath();
  if (!dbPath) {
    return null;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return { value: runner(db), dbPath };
  } finally {
    db.close();
  }
}

function getLegacyTemplatePrompt(template: LegacyVideoTemplateRow) {
  const tags = parseStringArray(template.style_tags);
  return joinParts(
    [
      template.structure_summary ? `结构参考：${normalizeText(template.structure_summary)}` : "",
      template.expression_style ? `表达风格：${normalizeText(template.expression_style)}` : "",
      tags.length ? `风格标签：${tags.join("、")}` : "",
    ],
    "\n",
  );
}

function buildLegacyProductDescriptor(task: LegacyTaskRow): LegacyProductDescriptor | null {
  const rawProductName = normalizeText(task.product_name);
  const sellingPoints = parseStringArray(task.selling_points).filter((item) => !PLACEHOLDER_SELLING_POINTS.has(item));
  const titleFromPrompt = extractLegacyVideoTitle(task.manual_prompt);
  const meaningfulProductName = rawProductName && !GENERIC_PRODUCT_NAMES.has(rawProductName) ? rawProductName : "";
  const meaningfulLocation = (() => {
    const value = normalizeText(task.location);
    return value && !PLACEHOLDER_LOCATIONS.has(value) ? value : "";
  })();
  const meaningfulTargetPeople = (() => {
    const value = normalizeText(task.target_people);
    return value && !PLACEHOLDER_TARGET_PEOPLE.has(value) ? value : "";
  })();
  const meaningfulPriceInfo = normalizeText(task.price_info);
  const hasStructuredProductInfo =
    Boolean(meaningfulProductName) ||
    Boolean(meaningfulLocation) ||
    Boolean(meaningfulPriceInfo) ||
    Boolean(meaningfulTargetPeople) ||
    sellingPoints.length > 0 ||
    isStructuredLegacyPrompt(task.manual_prompt);

  if (!hasStructuredProductInfo) {
    return null;
  }
  const title = meaningfulProductName || titleFromPrompt || joinParts([meaningfulLocation, meaningfulPriceInfo], " ") || "旧版商品档案";

  const promptSummary = isStructuredLegacyPrompt(task.manual_prompt) ? titleFromPrompt : normalizeText(task.manual_prompt);
  const originalPrice = extractOriginalPrice(task.manual_prompt);
  const packagePersonCount = extractPackagePersonCount({
    productName: title,
    targetPeople: meaningfulTargetPeople,
    sellingPoints,
    prompt: promptSummary,
  });
  const tags = [meaningfulLocation, meaningfulTargetPeople].filter(Boolean);
  const parsedText = joinParts(
    [
      title ? `商品名称：${title}` : "",
      meaningfulLocation ? `目的地：${meaningfulLocation}` : "",
      meaningfulPriceInfo ? `价格信息：${meaningfulPriceInfo}` : "",
      meaningfulTargetPeople ? `适合人群：${meaningfulTargetPeople}` : "",
      sellingPoints.length ? `核心卖点：${sellingPoints.join("；")}` : "",
      promptSummary ? `补充说明：${promptSummary}` : "",
    ],
    "\n",
  );
  const fingerprint = createHash("sha1")
    .update(
      JSON.stringify({
        title,
        location: meaningfulLocation,
        price: meaningfulPriceInfo,
        targetPeople: meaningfulTargetPeople,
        sellingPoints,
      }),
    )
    .digest("hex")
    .slice(0, 12);

  return {
    archiveId: `legacy-archive-${fingerprint}`,
    title,
    parsedText,
    parsedData: {
      rawText: parsedText,
      summaryTitle: title,
      packagePersonCount,
      tags,
      sellingPoints,
    },
    keyInfo: {
      productName: title,
      originalPrice,
      redeemPrice: meaningfulPriceInfo,
      packagePersonCount,
    },
  };
}

function pickLegacyVariant<T extends { variant_index: number | null; created_at: string | null }>(
  items: T[],
  variantIndex: number,
) {
  return (
    items
      .filter((item) => (item.variant_index ?? 1) === variantIndex)
      .sort((left, right) => toIsoTimestamp(left.created_at).localeCompare(toIsoTimestamp(right.created_at)))[0] ?? null
  );
}

function getPreferredLegacyScriptAndStoryboard(input: {
  scripts: LegacyScriptRow[];
  storyboards: LegacyStoryboardRow[];
}) {
  const candidateVariants = Array.from(
    new Set([...input.scripts.map((item) => item.variant_index ?? 1), ...input.storyboards.map((item) => item.variant_index ?? 1)]),
  ).sort((left, right) => left - right);
  const variant = candidateVariants[0] ?? 1;
  return {
    script: pickLegacyVariant(input.scripts, variant),
    storyboard: pickLegacyVariant(input.storyboards, variant),
  };
}

function mergeNarrationChunks(chunks: string[]) {
  return chunks
    .map((chunk) => normalizeText(chunk))
    .filter(Boolean)
    .join("，");
}

function assignNarrationToSlots(input: {
  slots: LegacyStoryboardSlot[];
  hook: string;
  middleLines: string[];
  cta: string;
}) {
  const remainingLines = [...input.middleLines];
  const texts = input.slots.map((slot) => {
    const purpose = normalizeText(slot.purpose);
    if (purpose.includes("hook") || purpose.includes("开场")) {
      return normalizeText(input.hook);
    }
    if (purpose.includes("cta") || purpose.includes("收尾")) {
      return normalizeText(input.cta);
    }
    return normalizeText(remainingLines.shift());
  });

  if (remainingLines.length > 0) {
    const lastMiddleIndex = input.slots
      .map((slot, index) => ({ purpose: normalizeText(slot.purpose), index }))
      .filter((item) => !item.purpose.includes("cta") && !item.purpose.includes("收尾"))
      .at(-1)?.index;

    const targetIndex = lastMiddleIndex ?? Math.max(0, texts.length - 1);
    texts[targetIndex] = mergeNarrationChunks([texts[targetIndex], ...remainingLines]);
  }

  return texts;
}

function inferLegacyVideoType(input: { task: LegacyTaskRow; hasNarration: boolean }): VideoTaskVideoType {
  if (input.hasNarration) {
    return "agency_guide_voiceover";
  }

  const productName = normalizeText(input.task.product_name);
  const hasStructuredProductInfo =
    Boolean(productName && !GENERIC_PRODUCT_NAMES.has(productName)) ||
    Boolean(normalizeText(input.task.location)) ||
    Boolean(normalizeText(input.task.price_info)) ||
    Boolean(normalizeText(input.task.target_people)) ||
    parseStringArray(input.task.selling_points).length > 0;

  if (normalizeText(input.task.mode) === "conversion" || hasStructuredProductInfo) {
    return "agency_guide_voiceover";
  }

  return "agency_montage_scenery";
}

function inferLegacyStatus(task: LegacyTaskRow): VideoTaskStatus {
  const currentStep = normalizeText(task.current_step);
  const status = normalizeText(task.status);
  const stepStatuses = safeJsonParse<Record<string, string>>(task.step_statuses, {});

  if (status === "success" && currentStep === "done") {
    return "COMPOSITION_READY";
  }

  if (stepStatuses.render === "success" || currentStep === "render") {
    return "COMPOSITION_READY";
  }

  if (stepStatuses.subtitle === "success" || currentStep === "subtitle") {
    return "SUBTITLE_AUDIO_READY";
  }

  if (stepStatuses.assets === "success" || currentStep === "assets") {
    return "IMAGES_READY";
  }

  if (stepStatuses.storyboard === "success" || currentStep === "storyboard") {
    return "CREATED";
  }

  return "CREATED";
}

function buildStageTimestamps(status: VideoTaskStatus, createdAt: string, updatedAt: string) {
  const order: VideoTaskStatus[] = [
    "CREATED",
    "SUBTITLE_AUDIO_READY",
    "IMAGES_READY",
    "CLIPS_READY",
    "COMPOSITION_READY",
  ];
  const currentIndex = order.indexOf(status);
  return order.reduce<Partial<Record<VideoTaskStatus, string>>>((result, item, index) => {
    if (index === 0) {
      result[item] = createdAt;
      return result;
    }

    if (index <= currentIndex) {
      result[item] = updatedAt;
    }

    return result;
  }, {});
}

function buildLegacyTaskTitle(task: LegacyTaskRow, script: LegacyScriptRow | null) {
  const promptTitle = extractLegacyVideoTitle(task.manual_prompt);
  const explicitProductName = normalizeText(task.product_name);
  const nonGenericProductName =
    explicitProductName && !GENERIC_PRODUCT_NAMES.has(explicitProductName) ? explicitProductName : "";

  return (
    nonGenericProductName ||
    promptTitle ||
    normalizeText(script?.title) ||
    normalizeText(task.selected_template_name) ||
    normalizeText(task.location) ||
    "旧版视频任务"
  );
}

function buildLegacySource(input: {
  task: LegacyTaskRow;
  productDescriptor: LegacyProductDescriptor | null;
  templatePrompt: string;
}) {
  const manualPrompt = normalizeMultilineText(input.task.manual_prompt);
  const supplementalPrompt = normalizeText(input.task.supplemental_prompt);
  const userPrompt = isStructuredLegacyPrompt(manualPrompt)
    ? joinParts([extractLegacyVideoTitle(manualPrompt), supplementalPrompt], "；")
    : joinParts([manualPrompt, supplementalPrompt], "\n").slice(0, 1200);

  return normalizeVideoTaskSource({
    productInfoId: input.productDescriptor?.archiveId ?? null,
    productInfoTitle: input.productDescriptor?.title ?? null,
    productInfoSnapshot: input.productDescriptor?.parsedText ?? "",
    userPrompt,
    videoMaterialId: input.task.selected_template_id ? `legacy-material-${normalizeText(input.task.selected_template_id)}` : null,
    videoMaterialName: normalizeText(input.task.selected_template_name) || null,
    videoTemplatePrompt: input.templatePrompt,
  });
}

function buildLegacyShotPlanAndDraftBundle(input: {
  task: LegacyTaskRow;
  script: LegacyScriptRow | null;
  storyboard: LegacyStoryboardRow | null;
  videoType: VideoTaskVideoType;
}) {
  const slots = parseStoryboardSlots(input.storyboard?.slots);
  const scriptLines = parseStringArray(input.script?.lines);
  const hook = normalizeText(input.script?.hook);
  const cta = normalizeText(input.script?.cta);
  const fallbackPrompt = normalizeText(input.task.manual_prompt) || normalizeText(input.task.product_name);
  const fallbackTitle = buildLegacyTaskTitle(input.task, input.script);
  const profile = getVideoTaskTypeProfile(input.videoType);

  const promptTexts =
    slots.length > 0
      ? slots.map(
          (slot, index) =>
            normalizeMultilineText(slot.desc) ||
            joinParts([normalizeText(slot.scene_type), normalizeText(input.task.location), `片段 ${index + 1}`], "，") ||
            `围绕${fallbackTitle}的片段 ${index + 1}`,
        )
      : [fallbackPrompt || `围绕${fallbackTitle}的主题画面`];

  const narrationTexts =
    slots.length > 0
      ? assignNarrationToSlots({
          slots,
          hook,
          middleLines: scriptLines,
          cta,
        })
      : [hook, ...scriptLines, cta].map((item) => normalizeText(item)).filter(Boolean);

  const segmentCount = Math.max(promptTexts.length, narrationTexts.length, 1);
  const shotPlanItems = Array.from({ length: segmentCount }, (_, index) => {
    const promptText = promptTexts[index] ?? promptTexts[promptTexts.length - 1] ?? `片段 ${index + 1}`;
    const narrationText = narrationTexts[index] ?? "";
    const slot = slots[index] ?? null;
    const purpose = normalizeText(slot?.purpose) || (index === 0 ? "hook" : index === segmentCount - 1 ? "closing" : "experience");
    const sceneText = normalizeMultilineText(slot?.desc) || promptText;
    const hasCharacters = /(人|情侣|孩子|家庭|父母|游客|主角|一家)/.test(
      `${sceneText}${normalizeText(input.task.target_people)}${narrationText}`,
    );

    return {
      shotIndex: index + 1,
      segmentIndex: index + 1,
      purpose,
      location: normalizeText(input.task.location),
      hasCharacters,
      characters: normalizeText(input.task.target_people) ? [normalizeText(input.task.target_people)] : [],
      hasTalent: profile.hasTalent,
      talentCaptureMode: profile.talentCaptureMode,
      hasVoice: profile.hasVoice && Boolean(narrationText),
      hasSubtitle: profile.hasSubtitle && Boolean(narrationText),
      requiresLipSync: profile.requiresLipSync && Boolean(narrationText),
      action: normalizeText(slot?.scene_type) || sceneText,
      emotion:
        purpose.includes("hook") ? "期待" : purpose.includes("cta") || purpose.includes("closing") ? "收束" : "自然",
      cameraMovement: "auto" as const,
      durationSeconds: slot?.duration && slot.duration > 0 ? slot.duration : 3,
      sceneDescription: sceneText,
      narrationHint: narrationText || sceneText,
    };
  });

  const shotPlan: ShotPlan = {
    shots: shotPlanItems,
    globalStyle: "旧版本地任务兼容导入，保留原始脚本和镜头结构",
    totalDurationSeconds: Number(
      shotPlanItems.reduce((sum, item) => sum + Math.max(0.8, item.durationSeconds || 0), 0).toFixed(2),
    ),
    validationErrors: [],
  };

  return {
    shotPlan,
    segmentCount,
    storyShotCount: shotPlanItems.length,
    draftBundle: {
      textToImagePrompt: buildIndexedBlockText(
        "片段",
        Array.from({ length: segmentCount }, (_, index) => promptTexts[index] ?? promptTexts[promptTexts.length - 1] ?? ""),
      ),
      imageToVideoPrompt: buildIndexedBlockText(
        "片段",
        Array.from({ length: segmentCount }, (_, index) => {
          const base = promptTexts[index] ?? promptTexts[promptTexts.length - 1] ?? "";
          const sceneType = normalizeText(slots[index]?.scene_type);
          return joinParts([base, sceneType ? `重点表现：${sceneType}` : ""], "，");
        }),
      ),
      narrationScript: buildIndexedBlockText(
        "镜头",
        Array.from({ length: segmentCount }, (_, index) => narrationTexts[index] ?? ""),
      ),
    },
  };
}

function loadLegacyTemplateMap(db: Database.Database) {
  const templates = db
    .prepare(
      "SELECT id, name, source_type, status, video_url, structure_summary, expression_style, style_tags, created_at FROM video_templates ORDER BY created_at DESC",
    )
    .all() as LegacyVideoTemplateRow[];

  return new Map(
    templates.map((template) => [
      normalizeText(template.id),
      {
        materialId: `legacy-material-${normalizeText(template.id)}`,
        name: normalizeText(template.name) || "旧版视频模板",
        videoTemplatePrompt: getLegacyTemplatePrompt(template),
        createdAt: toIsoTimestamp(template.created_at),
        videoUrl: normalizeText(template.video_url) || null,
      },
    ]),
  );
}

export function importLegacyProductArchivesIfNeeded() {
  const state = readImportState();
  if (state.productArchivesImported) {
    return;
  }

  if (listCollectionRecords(PRODUCT_ARCHIVE_COLLECTION).length > 0) {
    writeImportState({ productArchivesImported: true });
    return;
  }

  const result = withLegacyDb((db) => {
    const tasks = db
      .prepare(
        "SELECT id, product_name, location, selling_points, price_info, target_people, manual_prompt, created_at FROM tasks ORDER BY created_at DESC",
      )
      .all() as LegacyTaskRow[];

    const records = new Map<string, unknown>();
    for (const task of tasks) {
      const descriptor = buildLegacyProductDescriptor(task);
      if (!descriptor) {
        continue;
      }

      if (!records.has(descriptor.archiveId)) {
        const createdAt = toIsoTimestamp(task.created_at);
        records.set(descriptor.archiveId, {
          archiveId: descriptor.archiveId,
          title: descriptor.title,
          sourceImageUrl: null,
          sourceImageFileName: null,
          sourceImageUploadedAt: null,
          parsedText: descriptor.parsedText,
          parsedData: descriptor.parsedData,
          keyInfo: descriptor.keyInfo,
          createdAt,
          updatedAt: createdAt,
        });
      }
    }

    return Array.from(records.values());
  });

  if (result?.value?.length) {
    dbReplaceAll(
      PRODUCT_ARCHIVE_COLLECTION,
      result.value.map((record) => ({ key: String((record as { archiveId: string }).archiveId), data: record })),
    );
  }

  writeImportState({
    productArchivesImported: true,
    sourceDbPath: result?.dbPath ?? state.sourceDbPath,
  });
}

export function importLegacyVideoMaterialsIfNeeded() {
  const state = readImportState();
  if (state.videoMaterialsImported) {
    return;
  }

  if (listCollectionRecords(VIDEO_MATERIAL_COLLECTION).length > 0) {
    writeImportState({ videoMaterialsImported: true });
    return;
  }

  const result = withLegacyDb((db) => {
    const templates = db
      .prepare(
        "SELECT id, name, source_type, status, video_url, structure_summary, expression_style, style_tags, created_at FROM video_templates ORDER BY created_at DESC",
      )
      .all() as LegacyVideoTemplateRow[];

    return templates.map((template) => {
      const createdAt = toIsoTimestamp(template.created_at);
      const prompt = getLegacyTemplatePrompt(template);

      return {
        materialId: `legacy-material-${normalizeText(template.id)}`,
        name: normalizeText(template.name) || "旧版视频模板",
        status: "ready",
        statusMessage: "已从旧版本地模板自动导入",
        processingMode: "auto_all",
        videoFileName: null,
        videoFileUrl: normalizeText(template.video_url) || null,
        videoUploadedAt: createdAt,
        audioFileName: null,
        audioFileUrl: null,
        audioConvertedAt: null,
        framesExtracted: 0,
        videoAnalysis: normalizeText(template.structure_summary),
        videoAnalysisCompletedAt: createdAt,
        rawTranscript: "",
        contentScript: joinParts(
          [
            template.expression_style ? `表达风格：${normalizeText(template.expression_style)}` : "",
            parseStringArray(template.style_tags).length
              ? `风格标签：${parseStringArray(template.style_tags).join("、")}`
              : "",
          ],
          "\n",
        ),
        videoTemplatePrompt: prompt,
        reversePrompt: "",
        subtitle: normalizeText(template.name) || normalizeText(template.structure_summary),
        createdAt,
        updatedAt: createdAt,
      };
    });
  });

  if (result?.value?.length) {
    dbReplaceAll(
      VIDEO_MATERIAL_COLLECTION,
      result.value.map((record) => ({ key: record.materialId, data: record })),
    );
  }

  writeImportState({
    videoMaterialsImported: true,
    sourceDbPath: result?.dbPath ?? state.sourceDbPath,
  });
}

export function importLegacyVideoTasksIfNeeded() {
  const state = readImportState();
  if (state.videoTasksImported) {
    return;
  }

  if (listCollectionRecords(VIDEO_TASK_COLLECTION).length > 0) {
    writeImportState({ videoTasksImported: true });
    return;
  }

  const defaults = getDefaultTaskCreationParameterState();
  const result = withLegacyDb((db) => {
    const tasks = db
      .prepare(
        `SELECT id, product_name, location, selling_points, price_info, target_people, mode, status, current_step,
                step_statuses, created_at, updated_at, selected_template_id, selected_template_name, manual_prompt,
                supplemental_prompt, duration_option, visual_style_constraint, negative_constraints, shot_pacing,
                subject_consistency, camera_motion_strength
           FROM tasks
       ORDER BY created_at DESC`,
      )
      .all() as LegacyTaskRow[];
    const scripts = db
      .prepare(
        "SELECT id, task_id, variant_index, title, hook, lines, cta, created_at FROM scripts ORDER BY created_at ASC",
      )
      .all() as LegacyScriptRow[];
    const storyboards = db
      .prepare(
        "SELECT id, task_id, variant_index, slots, created_at FROM storyboards ORDER BY created_at ASC",
      )
      .all() as LegacyStoryboardRow[];
    const templateMap = loadLegacyTemplateMap(db);

    return tasks.map((task) => {
      const relatedScripts = scripts.filter((item) => item.task_id === task.id);
      const relatedStoryboards = storyboards.filter((item) => item.task_id === task.id);
      const { script, storyboard } = getPreferredLegacyScriptAndStoryboard({
        scripts: relatedScripts,
        storyboards: relatedStoryboards,
      });
      const productDescriptor = buildLegacyProductDescriptor(task);
      const templatePrompt = task.selected_template_id
        ? templateMap.get(normalizeText(task.selected_template_id))?.videoTemplatePrompt ?? ""
        : "";
      const source = buildLegacySource({
        task,
        productDescriptor,
        templatePrompt,
      });
      const hasNarration = Boolean(
        normalizeText(script?.hook) || parseStringArray(script?.lines).length || normalizeText(script?.cta),
      );
      const videoType = inferLegacyVideoType({ task, hasNarration });
      const expectedDurationRange =
        task.duration_option === "25_35" || task.duration_option === "35_60" || task.duration_option === "15_25"
          ? task.duration_option
          : defaults.videoExpectedDurationRange;
      const durationDefaults = getTaskCreationExpectedDurationDefaults(expectedDurationRange, videoType);
      const bundle = buildLegacyShotPlanAndDraftBundle({
        task,
        script,
        storyboard,
        videoType,
      });
      const presetSource = joinParts(
        [
          source.productInfoSnapshot,
          source.userPrompt,
          source.videoTemplatePrompt,
          normalizeText(task.visual_style_constraint),
        ],
        "\n",
      );
      const constraintPreset = detectConstraintPreset(presetSource);
      const status = inferLegacyStatus(task);
      const createdAt = toIsoTimestamp(task.created_at);
      const updatedAt = toIsoTimestamp(task.updated_at ?? task.created_at);
      const customRules = [
        normalizeText(task.visual_style_constraint) ? `风格约束：${normalizeText(task.visual_style_constraint)}` : "",
        normalizeText(task.shot_pacing) ? `镜头节奏：${normalizeText(task.shot_pacing)}` : "",
        normalizeText(task.subject_consistency) ? `主体一致性：${normalizeText(task.subject_consistency)}` : "",
        normalizeText(task.camera_motion_strength) ? `运镜强度：${normalizeText(task.camera_motion_strength)}` : "",
      ].filter(Boolean);
      const preset = taskConstraintPresets[constraintPreset] ?? taskConstraintPresets.general;

      const record: VideoTaskRecord = {
        taskId: `legacy-task-${normalizeText(task.id)}`,
        ownerUserId: null,
        title: buildLegacyTaskTitle(task, script),
        status,
        source,
        draftBundle: bundle.draftBundle,
        shotPlan: bundle.shotPlan,
        directorPlan: null,
        parameters: {
          image: {
            size: defaults.imageSize,
            guidanceScale: defaults.imageGuidanceScale,
            watermark: defaults.imageWatermark,
            seed: null,
          },
          video: {
            videoType,
            segmentMode: getVideoTaskTypeProfile(videoType).defaultSegmentMode,
            expectedDurationRange,
            storyShotCount: bundle.storyShotCount,
            storyShotsPerSegment: 1,
            introSegmentDurationSeconds: getVideoTaskTypeProfile(videoType).introSegmentDurationSeconds ?? null,
            mode: defaults.videoMode,
            multiShot: bundle.segmentCount > 1,
            shotType: defaults.videoShotType,
            enableTailFrame: defaults.videoEnableTailFrame,
            segmentCount: bundle.segmentCount,
            durationSeconds: durationDefaults.videoDurationSeconds,
            aspectRatio: defaults.videoAspectRatio,
            cfgScale: defaults.videoCfgScale,
            cameraControl: defaults.videoCameraControl,
            generateAudio: defaults.videoGenerateAudio,
            watermark: defaults.videoWatermark,
            negativePrompt: normalizeText(task.negative_constraints) || defaults.videoNegativePrompt,
          },
          audio: {
            voiceId: defaults.audioVoiceId,
            storyboardEnabled: false,
            storyboardVoiceIds: [],
            format: defaults.audioFormat,
            sampleRate: defaults.audioSampleRate,
            speechRate: defaults.audioSpeechRate,
            loudnessRate: defaults.audioLoudnessRate,
            enableSubtitle: defaults.audioEnableSubtitle,
          },
          composition: {
            includeBackgroundMusic: defaults.compositionIncludeBackgroundMusic,
            backgroundMusicUrl: null,
            backgroundMusicVolume: defaults.compositionBackgroundMusicVolume,
            subtitleConfig: defaults.compositionSubtitleConfig,
          },
          constraints: {
            ...preset.constraints,
            customRules,
          },
        },
        createdAt,
        updatedAt,
        stageTimestamps: buildStageTimestamps(status, createdAt, updatedAt),
      };

      return record;
    });
  });

  if (result?.value?.length) {
    dbReplaceAll(
      VIDEO_TASK_COLLECTION,
      result.value.map((record) => ({ key: record.taskId, data: record })),
    );
  }

  writeImportState({
    videoTasksImported: true,
    sourceDbPath: result?.dbPath ?? state.sourceDbPath,
  });
}
