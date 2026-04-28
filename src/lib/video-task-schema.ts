import type { SubtitleConfig } from "./subtitle-style-config";

export type VideoTaskStatus = "CREATED" | "SUBTITLE_AUDIO_READY" | "IMAGES_READY" | "CLIPS_READY" | "COMPOSITION_READY";

export type ShotGenerationMode = "photo_direct_i2v" | "photo_enhanced_i2v" | "ai_generated_broll";
export type ShotSourceTrace = "user_photo" | "enhanced_from_user_photo" | "reference_video_keyframe" | "ai_generated";

export type HotelAssetSceneType =
  | "exterior"
  | "lobby"
  | "room"
  | "bathroom"
  | "dining"
  | "food"
  | "facility"
  | "neighborhood"
  | "service_detail"
  | "atmosphere"
  | "other";

export type TimedWord = {
  word: string;
  startTime: number;
  endTime: number;
};

export type VideoTaskVideoType =
  | "agency_guide_voiceover"
  | "agency_guide_selfie_narration"
  | "agency_guide_presenter_narration"
  | "agency_guide_roaming_voiceover"
  | "agency_guide_scenery_voiceover"
  | "agency_montage_scenery"
  | "agency_montage_roaming_voiceover"
  | "agency_montage_presenter_checkin"
  | "hotel_explore_voiceover"
  | "hotel_explore_selfie_narration"
  | "hotel_explore_presenter_narration"
  | "hotel_explore_roaming_voiceover"
  | "hotel_explore_roaming_silent"
  | "hotel_montage_voiceover"
  | "retail_explore_presenter_narration"
  | "agency_creative_beat_mix";

export type VideoTaskSegmentMode =
  | "single_speaking"
  | "single_action"
  | "multi_shot_montage"
  | "hybrid_intro_plus_montage";

export type VideoTaskExpectedDurationRange = "15_25" | "25_35" | "35_60";

export type VideoTaskTalentCaptureMode = "none" | "selfie" | "presented" | "intro_host";
export type VideoTaskSubtitleMode = "none" | "voice_aligned" | "caption_only";
export type VideoTaskWorkflowKind = "visual_reference_first" | "captured_material_first";
export type VideoTaskAssetSourceType = "user_upload" | "enhanced" | "ai_generated" | "video_material";

export type VideoTaskTypeProfile = {
  key: VideoTaskVideoType;
  label: string;
  description: string;
  hasTalent: boolean;
  talentCaptureMode: VideoTaskTalentCaptureMode;
  hasVoice: boolean;
  hasSubtitle: boolean;
  subtitleMode: VideoTaskSubtitleMode;
  requiresLipSync: boolean;
  hasBgm: boolean;
  defaultSegmentMode: VideoTaskSegmentMode;
  allowManualMultiShot: boolean;
  recommendedShotsPerSegment: number;
  introSegmentDurationSeconds?: number | null;
  preferredConstraintPreset: TaskConstraintPresetKey;
  workflowKind?: VideoTaskWorkflowKind;
};

export type VideoTaskDraftBundle = {
  textToImagePrompt: string;
  imageToVideoPrompt: string;
  narrationScript: string;
};

export type ShotVisual = {
  sceneSetting?: string;
  shotScale?: string;
  wideContent?: string;
  midContent?: string;
  closeContent?: string;
  composition?: string;
  colorTone?: string;
  keyDetails?: string;
};

export type ShotSubject = {
  mainCharacterCount?: number;
  mainCharacterGender?: string;
  relationship?: string;
  clothing?: string;
  ageRange?: string;
  features?: string;
  appearance?: string;
  style?: string;
  position?: string;
  extraCount?: number;
  extraDistribution?: string;
  extraScale?: string;
};

export type ShotCinematography = {
  shotType?: string;
  rhythm?: string;
  infoDensity?: string;
  lighting?: string;
};

export type ShotStructure = {
  phase?: string;
  prevTransition?: string;
  nextTransition?: string;
  transitionType?: string;
};

export type ShotPlanItem = {
  shotId?: string;
  shotIndex: number;
  segmentId?: string | null;
  segmentIndex?: number | null;
  sceneType?: HotelAssetSceneType;
  purpose: string;
  location: string;
  hasCharacters: boolean;
  characters: string[];
  hasTalent?: boolean;
  talentCaptureMode?: VideoTaskTalentCaptureMode;
  hasVoice?: boolean;
  hasSubtitle?: boolean;
  requiresLipSync?: boolean;
  action: string;
  emotion: string;
  cameraMovement: string;
  durationSeconds: number;
  sceneDescription: string;
  contentDescription?: string;
  narrationHint: string;
  startAtSeconds?: number;
  endAtSeconds?: number;
  functionTag?: string;
  sellingPointType?: string;
  shotScale?: string;
  compositionHint?: string;
  rhythmTag?: string;
  mood?: string;
  sellingPointTags?: string[];
  assetId?: string | null;
  assetSourceType?: VideoTaskAssetSourceType | null;
  assetSubjectSummary?: string | null;
  sourceMaterialId?: string | null;
  sourceStartAtSeconds?: number | null;
  sourceEndAtSeconds?: number | null;
  sourceTimeRangeLabel?: string | null;
  referenceImageUrl?: string | null;
  generationMode?: ShotGenerationMode;
  sourceTrace?: ShotSourceTrace | null;
  needImageEnhancement?: boolean;
  needImageToVideo?: boolean;
  isAtmosphereInsert?: boolean;
  img2imgPrompt?: string | null;
  i2vPrompt?: string | null;
  visual?: ShotVisual;
  subject?: ShotSubject;
  cinematography?: ShotCinematography;
  structure?: ShotStructure;
};

export type ShotPlanStyleConstraints = {
  style?: string;
  videoType?: string;
  forbidden?: string;
  realismLevel?: string;
  styleConsistency?: string;
  characterConsistency?: string;
};

export type ShotPlanReusableModules = {
  characterSetting?: string;
  sceneSetting?: string;
  actionTemplates?: string;
  shotTemplates?: string;
};

export type ShotPlanNarrativeCurves = {
  openingStrategy?: string;
  midStructure?: string;
  closingStrategy?: string;
  rhythmCurve?: string;
  emotionCurve?: string;
  infoOrder?: string;
};

export type SubtitlePlanEntry = {
  text: string;
  startAtSeconds: number;
  durationSeconds: number;
  charCount: number;
  coveredShotIndexes: number[];
};

export type SegmentSubtitlePlan = {
  segmentIndex: number;
  segmentId: string;
  subtitles: SubtitlePlanEntry[];
};

export type StoryboardNarrativeBeat = {
  beatId: string;
  title: string;
  phase: "opening_hook" | "commercial_info" | "package_value" | "purchase_advice" | "closing" | "experience";
  goal: string;
  durationRangeLabel: string;
  targetShotIndexes: number[];
  materialStrategy: string;
  narrationStrategy: string;
};

export type StoryboardMaterialIntent = {
  assetId: string;
  displayName: string;
  sourceType: VideoTaskAssetSourceType | "user_video";
  sceneType?: HotelAssetSceneType | null;
  originalUserNote: string;
  analysisSummary: string;
  recommendedRole: string;
  mappedShotIndexes: number[];
  priority: "hero" | "core" | "support" | "backup";
};

export type StoryboardShotBinding = {
  shotIndex: number;
  segmentIndex?: number | null;
  primaryAssetId: string | null;
  primaryAssetLabel: string;
  sourceType: VideoTaskAssetSourceType | "user_video" | null;
  supportingAssetIds: string[];
  bindingReason: string;
  userIntentPreserved: string;
  narrationGoal: string;
  subtitleGoal: string;
  needsAiFallback: boolean;
};

export type TaskStoryboardPlan = {
  version: 1;
  narrativeSummary: string;
  speakingStyle: string;
  editingGuidance: string;
  beats: StoryboardNarrativeBeat[];
  materialIntents: StoryboardMaterialIntent[];
  shotBindings: StoryboardShotBinding[];
  reviewChecklist: string[];
  warnings: string[];
  generatedAt: string;
};

export type ShotPlan = {
  shots: ShotPlanItem[];
  globalStyle: string;
  totalDurationSeconds: number;
  validationErrors: string[];
  styleConstraints?: ShotPlanStyleConstraints;
  reusableModules?: ShotPlanReusableModules;
  narrativeCurves?: ShotPlanNarrativeCurves;
  subtitlePlan?: SegmentSubtitlePlan[];
  storyboard?: TaskStoryboardPlan;
};

export type DirectorStoryShot = {
  shotId: string;
  shotIndex: number;
  segmentId: string;
  segmentIndex: number;
  title: string;
  sceneType?: HotelAssetSceneType;
  purpose: string;
  location: string;
  hasCharacters: boolean;
  characters: string[];
  hasTalent: boolean;
  talentCaptureMode: VideoTaskTalentCaptureMode;
  hasVoice: boolean;
  hasSubtitle: boolean;
  requiresLipSync: boolean;
  action: string;
  emotion: string;
  cameraMovement: string;
  durationSeconds: number;
  sceneDescription: string;
  contentDescription?: string;
  narrationHint: string;
  imagePrompt: string;
  videoPrompt: string;
  narrationText: string;
  subtitleText: string;
  startAtSeconds?: number;
  endAtSeconds?: number;
  functionTag?: string;
  sellingPointType?: string;
  shotScale?: string;
  compositionHint?: string;
  rhythmTag?: string;
  mood?: string;
  sellingPointTags?: string[];
  assetId?: string | null;
  assetSourceType?: VideoTaskAssetSourceType | null;
  assetSubjectSummary?: string | null;
  sourceMaterialId?: string | null;
  sourceStartAtSeconds?: number | null;
  sourceEndAtSeconds?: number | null;
  sourceTimeRangeLabel?: string | null;
  referenceImageUrl?: string | null;
  generationMode?: ShotGenerationMode;
  sourceTrace?: ShotSourceTrace | null;
  needImageEnhancement?: boolean;
  needImageToVideo?: boolean;
  isAtmosphereInsert?: boolean;
  img2imgPrompt?: string | null;
  i2vPrompt?: string | null;
  visual?: ShotVisual;
  subject?: ShotSubject;
  cinematography?: ShotCinematography;
  structure?: ShotStructure;
};

export type DirectorRenderSegment = {
  segmentId: string;
  segmentIndex: number;
  title: string;
  segmentMode: VideoTaskSegmentMode;
  shotIds: string[];
  shotIndexes: number[];
  durationSeconds: number;
  hasTalent: boolean;
  talentCaptureMode: VideoTaskTalentCaptureMode;
  hasVoice: boolean;
  hasSubtitle: boolean;
  requiresLipSync: boolean;
  multiShot: boolean;
  shotType: "customize" | "intelligence";
  imagePrompt: string;
  videoPrompt: string;
  multiPrompt: Array<{
    index: number;
    prompt: string;
    duration: number;
  }>;
  narrationText: string;
  subtitleText: string;
  note?: string;
};

export type DirectorAudioCue = {
  cueId: string;
  cueIndex: number;
  shotId: string | null;
  shotIndex: number | null;
  targetSegmentId: string;
  targetSegmentIndex: number;
  startAtSeconds: number;
  plannedDurationSeconds: number;
  audioDurationSeconds: number | null;
  hasVoice: boolean;
  hasSubtitle: boolean;
  requiresLipSync: boolean;
  voiceId: string | null;
  narrationText: string;
  subtitleText: string;
  audioUrl?: string | null;
  words?: TimedWord[];
};

export type VideoTaskDirectorPlan = {
  videoType: VideoTaskVideoType;
  segmentMode: VideoTaskSegmentMode;
  totalDurationSeconds: number;
  storyShots: DirectorStoryShot[];
  renderSegments: DirectorRenderSegment[];
  audioCues: DirectorAudioCue[];
  subtitlePlan?: SegmentSubtitlePlan[];
  storyboard?: TaskStoryboardPlan;
  legacyMirrored: boolean;
};

export type TaskConstraintLevel = "high" | "medium" | "low" | "none";

export type TaskConstraints = {
  peopleStructure: string | null;
  adultGenderRule: "one_male_one_female" | "any" | null;
  characterConsistency: TaskConstraintLevel;
  sceneConsistency: TaskConstraintLevel;
  forbidEmptyShots: boolean;
  requirePeopleInEveryShot: boolean;
  customRules: string[];
};

export type TaskConstraintPresetKey =
  | "family_travel"
  | "travel_guide"
  | "hotel_promo"
  | "food_explore"
  | "scenery_showcase"
  | "general";

export const taskConstraintPresets: Record<TaskConstraintPresetKey, { label: string; constraints: TaskConstraints }> = {
  family_travel: {
    label: "亲子/家庭旅行",
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "high",
      sceneConsistency: "medium",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [
        "家庭/亲子类：出镜家庭成员的人数、关系与儿童性别年龄等特征须与用户商品信息及主动提示词一致；若用户未写清，由你在规划中一次性合理推断并在全片各镜头中保持不变，不得中途增减人物或替换儿童样貌。",
      ],
    },
  },
  travel_guide: {
    label: "旅行攻略",
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "low",
      sceneConsistency: "low",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  },
  hotel_promo: {
    label: "酒店/民宿推广",
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "medium",
      sceneConsistency: "high",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  },
  food_explore: {
    label: "美食探店",
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "medium",
      sceneConsistency: "medium",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  },
  scenery_showcase: {
    label: "风光展示",
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "none",
      sceneConsistency: "low",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  },
  general: {
    label: "通用",
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "medium",
      sceneConsistency: "medium",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  },
};

export const DEFAULT_VIDEO_TASK_VIDEO_TYPE: VideoTaskVideoType = "agency_guide_voiceover";

export const videoTaskTypeProfiles: Record<VideoTaskVideoType, VideoTaskTypeProfile> = {
  agency_guide_voiceover: {
    key: "agency_guide_voiceover",
    label: "旅行社-攻略-空镜旁白",
    description: "以空镜、景点和环境为主，配旁白和字幕，不需要对口型，适合玩法攻略和产品信息讲解。",
    hasTalent: false,
    talentCaptureMode: "none",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "travel_guide",
  },
  agency_guide_selfie_narration: {
    key: "agency_guide_selfie_narration",
    label: "旅行社-攻略-自拍口播",
    description: "主角自拍口播，要求口型同步，有字幕和 BGM，默认 1 个说话镜头对应 1 个输出片段。",
    hasTalent: true,
    talentCaptureMode: "selfie",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: true,
    hasBgm: true,
    defaultSegmentMode: "single_speaking",
    allowManualMultiShot: false,
    recommendedShotsPerSegment: 1,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "travel_guide",
  },
  agency_guide_presenter_narration: {
    key: "agency_guide_presenter_narration",
    label: "旅行社-攻略-他拍口播",
    description: "主角他拍口播，要求口型同步，有字幕和 BGM，适合更稳定的他拍讲解场景。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: true,
    hasBgm: true,
    defaultSegmentMode: "single_speaking",
    allowManualMultiShot: false,
    recommendedShotsPerSegment: 1,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "travel_guide",
  },
  agency_guide_roaming_voiceover: {
    key: "agency_guide_roaming_voiceover",
    label: "旅行社-攻略-漫游旁白",
    description: "人物漫游体验为主，配旁白和字幕，不需要对口型，适合边逛边讲的攻略内容。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "travel_guide",
  },
  agency_guide_scenery_voiceover: {
    key: "agency_guide_scenery_voiceover",
    label: "旅行社-混剪-空镜旁白",
    description: "纯景色/景观混剪，配旁白和字幕，无需对口型，适合景点玩法讲解和氛围带看。",
    hasTalent: false,
    talentCaptureMode: "none",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "scenery_showcase",
  },
  agency_montage_scenery: {
    key: "agency_montage_scenery",
    label: "旅行社-混剪-空镜无声",
    description: "景色视频混剪，无口播，仅文案字幕和 BGM，适合卡点和氛围展示。",
    hasTalent: false,
    talentCaptureMode: "none",
    hasVoice: false,
    hasSubtitle: true,
    subtitleMode: "caption_only",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "scenery_showcase",
  },
  agency_montage_roaming_voiceover: {
    key: "agency_montage_roaming_voiceover",
    label: "旅行社-混剪-漫游旁白",
    description: "人物漫游混剪，配旁白和字幕，无需对口型，适合体验带看和氛围推进。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "travel_guide",
  },
  agency_montage_presenter_checkin: {
    key: "agency_montage_presenter_checkin",
    label: "旅行社-混剪-漫游无声",
    description: "人物漫游混剪，无口播、无字幕，仅 BGM 和动作节奏，适合他拍漫游打卡内容。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: false,
    hasSubtitle: false,
    subtitleMode: "none",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "single_action",
    allowManualMultiShot: false,
    recommendedShotsPerSegment: 1,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "travel_guide",
  },
  hotel_explore_voiceover: {
    key: "hotel_explore_voiceover",
    label: "酒店-探店-空镜旁白",
    description: "以酒店空镜、空间和设施展示为主，配旁白和字幕，无需对口型。",
    hasTalent: false,
    talentCaptureMode: "none",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "hotel_promo",
  },
  hotel_explore_selfie_narration: {
    key: "hotel_explore_selfie_narration",
    label: "酒店-探店-自拍口播",
    description: "主角自拍讲酒店体验，要求口型同步，有字幕和 BGM。",
    hasTalent: true,
    talentCaptureMode: "selfie",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: true,
    hasBgm: true,
    defaultSegmentMode: "single_speaking",
    allowManualMultiShot: false,
    recommendedShotsPerSegment: 1,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "hotel_promo",
  },
  hotel_explore_presenter_narration: {
    key: "hotel_explore_presenter_narration",
    label: "酒店-探店-他拍口播",
    description: "主角他拍讲酒店体验，要求口型同步，有字幕和 BGM。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: true,
    hasBgm: true,
    defaultSegmentMode: "single_speaking",
    allowManualMultiShot: false,
    recommendedShotsPerSegment: 1,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "hotel_promo",
  },
  hotel_explore_roaming_voiceover: {
    key: "hotel_explore_roaming_voiceover",
    label: "酒店-探店-漫游旁白",
    description: "人物漫游探店酒店，配旁白和字幕，无需对口型，适合带看空间和体验流程。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "hotel_promo",
    workflowKind: "captured_material_first",
  },
  hotel_explore_roaming_silent: {
    key: "hotel_explore_roaming_silent",
    label: "酒店-探店-漫游无声",
    description: "人物漫游探店酒店，无口播、无字幕，仅 BGM 和动作节奏推进。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: false,
    hasSubtitle: false,
    subtitleMode: "none",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "single_action",
    allowManualMultiShot: false,
    recommendedShotsPerSegment: 1,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "hotel_promo",
    workflowKind: "captured_material_first",
  },
  hotel_montage_voiceover: {
    key: "hotel_montage_voiceover",
    label: "酒店-混剪-空镜旁白",
    description: "酒店空镜混剪，配旁白和字幕，无需对口型，适合氛围种草和卖点带看。",
    hasTalent: false,
    talentCaptureMode: "none",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "multi_shot_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "hotel_promo",
  },
  retail_explore_presenter_narration: {
    key: "retail_explore_presenter_narration",
    label: "超市卖场-探店-他拍口播",
    description: "主角他拍讲解超市卖场动线、货盘和体验点，要求口型同步，有字幕和 BGM。",
    hasTalent: true,
    talentCaptureMode: "presented",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: true,
    hasBgm: true,
    defaultSegmentMode: "single_speaking",
    allowManualMultiShot: false,
    recommendedShotsPerSegment: 1,
    introSegmentDurationSeconds: null,
    preferredConstraintPreset: "general",
  },
  agency_creative_beat_mix: {
    key: "agency_creative_beat_mix",
    label: "旅行社-创意-卡点混剪",
    description:
      "前 4 秒左右可有人物开场读稿，后续转入创意卡点混剪，主体以旁白、字幕和 BGM 推进，不默认做单独口型同步。",
    hasTalent: true,
    talentCaptureMode: "intro_host",
    hasVoice: true,
    hasSubtitle: true,
    subtitleMode: "voice_aligned",
    requiresLipSync: false,
    hasBgm: true,
    defaultSegmentMode: "hybrid_intro_plus_montage",
    allowManualMultiShot: true,
    recommendedShotsPerSegment: 2,
    introSegmentDurationSeconds: 3,
    preferredConstraintPreset: "travel_guide",
  },
};

export function getDefaultTaskConstraints(): TaskConstraints {
  return { ...taskConstraintPresets.general.constraints, customRules: [] };
}

const presetDetectionRules: Array<{ key: TaskConstraintPresetKey; patterns: RegExp }> = [
  { key: "family_travel", patterns: /(亲子|家庭|一家四口|2大2小|两大两小|爸爸妈妈|带娃|带孩子|全家|萌娃)/ },
  { key: "hotel_promo", patterns: /(酒店|民宿|客房|套房|度假村|入住|check.?in|大床|双床|海景房)/ },
  { key: "food_explore", patterns: /(美食|探店|餐厅|小吃|夜市|打卡|觅食|吃货|菜品|火锅|烧烤)/ },
  { key: "scenery_showcase", patterns: /(风光|日出|日落|雪山|湖泊|星空|航拍|全景|延时|自然风景)/ },
  { key: "travel_guide", patterns: /(攻略|目的地|行程|路线|推荐|必去|打卡点|景点|几天几晚|自由行)/ },
];

export function detectConstraintPreset(sourceText: string): TaskConstraintPresetKey {
  for (const rule of presetDetectionRules) {
    if (rule.patterns.test(sourceText)) {
      return rule.key;
    }
  }
  return "general";
}

/** 文档与「系统规则」页使用；与 {@link detectConstraintPreset} 使用同一组规则，按数组顺序优先匹配。 */
export function getConstraintPresetDetectionDocs() {
  return presetDetectionRules.map((rule) => ({
    presetKey: rule.key,
    presetLabel: taskConstraintPresets[rule.key].label,
    patternSource: rule.patterns.source,
  }));
}

export function getVideoTaskTypeProfile(videoType?: VideoTaskVideoType | null) {
  return (
    videoTaskTypeProfiles[videoType ?? DEFAULT_VIDEO_TASK_VIDEO_TYPE] ??
    videoTaskTypeProfiles[DEFAULT_VIDEO_TASK_VIDEO_TYPE]
  );
}

export function getVideoTaskWorkflowKind(videoType?: VideoTaskVideoType | null): VideoTaskWorkflowKind {
  return getVideoTaskTypeProfile(videoType).workflowKind ?? "visual_reference_first";
}

export function usesCapturedMaterialFirstWorkflow(videoType?: VideoTaskVideoType | null) {
  return getVideoTaskWorkflowKind(videoType) === "captured_material_first";
}

export function isHotelVideoType(videoType?: VideoTaskVideoType | null) {
  return Boolean(videoType?.startsWith("hotel_"));
}

export function computeVideoTaskStoryShotCount(input: {
  videoType?: VideoTaskVideoType | null;
  segmentCount: number;
  storyShotsPerSegment?: number | null;
}) {
  const profile = getVideoTaskTypeProfile(input.videoType);
  const segmentCount = Math.max(1, Math.round(input.segmentCount || 1));
  const shotsPerSegment = Math.max(1, Math.round(input.storyShotsPerSegment ?? profile.recommendedShotsPerSegment));

  if (profile.defaultSegmentMode === "single_speaking" || profile.defaultSegmentMode === "single_action") {
    return segmentCount;
  }

  if (profile.defaultSegmentMode === "hybrid_intro_plus_montage") {
    if (segmentCount <= 1) {
      return 1;
    }
    return 1 + (segmentCount - 1) * shotsPerSegment;
  }

  return segmentCount * shotsPerSegment;
}

export type VideoTaskSource = {
  productInfoId: string | null;
  productInfoTitle: string | null;
  productInfoSnapshot: string;
  userPrompt: string;
  /** 系统基于用户原始提示词整理出的创作提示词；不覆盖 userPrompt */
  optimizedUserPrompt?: string;
  /** 可选参考视频素材 id（与视频拆解素材库 `materialId` 同语义） */
  videoMaterialId: string | null;
  /** 对应视频素材名称（与素材库 `name` 同语义，仅展示） */
  videoMaterialName: string | null;
  /** 与素材库 `videoTemplatePrompt` 同语义：仅该正文进入镜头规划 */
  videoTemplatePrompt: string;
};

/** 旧版任务 JSON 中的字段名，读入时由 {@link normalizeVideoTaskSource} 归一 */
export type LegacyVideoTaskSourceFields = {
  videoTemplateId?: string | null;
  videoTemplateName?: string | null;
};

export type VideoTaskSourcePatch = Partial<VideoTaskSource> & LegacyVideoTaskSourceFields;

export function normalizeVideoTaskSource(
  partial?: Partial<VideoTaskSource> | LegacyVideoTaskSourceFields | null,
): VideoTaskSource {
  const raw = partial as (Partial<VideoTaskSource> & LegacyVideoTaskSourceFields) | null | undefined;
  return {
    productInfoId: raw?.productInfoId ?? null,
    productInfoTitle: raw?.productInfoTitle ?? null,
    productInfoSnapshot: raw?.productInfoSnapshot ?? "",
    userPrompt: raw?.userPrompt ?? "",
    optimizedUserPrompt: raw?.optimizedUserPrompt ?? "",
    videoMaterialId: raw?.videoMaterialId ?? raw?.videoTemplateId ?? null,
    videoMaterialName: raw?.videoMaterialName ?? raw?.videoTemplateName ?? null,
    videoTemplatePrompt: raw?.videoTemplatePrompt ?? "",
  };
}

export function hasVideoTaskSourceContent(
  source?: Pick<
    VideoTaskSource,
    "productInfoSnapshot" | "userPrompt" | "optimizedUserPrompt" | "videoTemplatePrompt"
  > | null,
) {
  return Boolean(
    source?.productInfoSnapshot?.trim() ||
    source?.userPrompt?.trim() ||
    source?.optimizedUserPrompt?.trim() ||
    source?.videoTemplatePrompt?.trim(),
  );
}

export type VideoTaskImageParameters = {
  size: string;
  guidanceScale: number;
  watermark: boolean;
  seed: number | null;
};

export type VideoTaskVideoParameters = {
  videoType: VideoTaskVideoType;
  segmentMode: VideoTaskSegmentMode;
  expectedDurationRange: VideoTaskExpectedDurationRange;
  storyShotCount: number;
  storyShotsPerSegment: number;
  introSegmentDurationSeconds: number | null;
  mode: "std" | "pro";
  multiShot: boolean;
  shotType: "customize" | "intelligence";
  enableTailFrame: boolean;
  segmentCount: number;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  cfgScale: number;
  cameraControl: "auto" | "down_back" | "forward_up" | "right_turn_forward" | "left_turn_forward";
  generateAudio: boolean;
  watermark: boolean;
  negativePrompt: string;
};

export type VideoTaskAudioParameters = {
  voiceId: string | null;
  storyboardEnabled: boolean;
  storyboardVoiceIds: string[];
  format: "mp3" | "ogg_opus";
  sampleRate: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  speechRate: -10 | 0 | 10 | 20;
  loudnessRate: -10 | 0 | 10;
  enableSubtitle: boolean;
};

export type VideoTaskCompositionParameters = {
  includeBackgroundMusic: boolean;
  backgroundMusicUrl: string | null;
  backgroundMusicVolume: number;
  subtitleConfig: SubtitleConfig;
};

export type VideoTaskParameterBundle = {
  image: VideoTaskImageParameters;
  video: VideoTaskVideoParameters;
  audio: VideoTaskAudioParameters;
  composition: VideoTaskCompositionParameters;
  constraints: TaskConstraints;
};

export type VideoTaskRecord = {
  taskId: string;
  ownerUserId: string | null;
  title: string;
  status: VideoTaskStatus;
  source: VideoTaskSource;
  draftBundle: VideoTaskDraftBundle;
  shotPlan: ShotPlan | null;
  directorPlan: VideoTaskDirectorPlan | null;
  parameters: VideoTaskParameterBundle;
  createdAt: string;
  updatedAt: string;
  stageTimestamps: Partial<Record<VideoTaskStatus, string>>;
};

export type VideoTaskGeneratedVideoType = "DIRECTOR" | "AUTO";
export type VideoTaskStageTone = "idle" | "editing" | "created";

export function normalizeVideoTaskStatus(status?: string | null): VideoTaskStatus {
  switch (status) {
    case "SUBTITLE_AUDIO_READY":
    case "IMAGES_READY":
    case "CLIPS_READY":
    case "COMPOSITION_READY":
    case "CREATED":
      return status;
    case "VIDEO_BURN_READY":
      return "COMPOSITION_READY";
    default:
      return "CREATED";
  }
}

export type VideoTaskGeneratedVideoRecord = {
  taskId: string;
  taskTitle: string;
  videoJobId: string;
  type: VideoTaskGeneratedVideoType;
  status: "COMPLETED" | "FAILED";
  createdAt: string;
  originalPrompt: string;
  optimizedPrompt: string;
  videoUrl: string | null;
  modelId: string | null;
  resolvedDurationSeconds: number | null;
  generationSettings: {
    durationSeconds: number;
    aspectRatio: "16:9" | "9:16" | "1:1";
    shotType: string;
    generateAudio: boolean;
    negativePrompt: string;
  } | null;
  error: string | null;
};

export const videoTaskStatusFlow: Array<{ key: VideoTaskStatus; label: string; description: string }> = [
  {
    key: "CREATED",
    label: "任务已创建",
    description: "镜头规划、片段提示词与兼容导出草稿已生成",
  },
  {
    key: "SUBTITLE_AUDIO_READY",
    label: "音频/字幕已生成",
    description: "口播、旁白或字幕轨已准备完成",
  },
  {
    key: "IMAGES_READY",
    label: "图片已生成",
    description: "片段级参考图片已确认完成",
  },
  {
    key: "CLIPS_READY",
    label: "片段已生成",
    description: "输出片段已准备完成",
  },
  {
    key: "COMPOSITION_READY",
    label: "视频合成完成",
    description: "时间线合成输出已完成",
  },
];

export function getVideoTaskStatusIndex(status: VideoTaskStatus) {
  return videoTaskStatusFlow.findIndex((item) => item.key === status);
}

export function isVideoTaskStatus(value: string | null | undefined): value is VideoTaskStatus {
  return videoTaskStatusFlow.some((item) => item.key === value);
}

export function promoteVideoTaskStatus(currentStatus: VideoTaskStatus, targetStatus: VideoTaskStatus) {
  return getVideoTaskStatusIndex(currentStatus) >= getVideoTaskStatusIndex(targetStatus) ? currentStatus : targetStatus;
}

export function capVideoTaskStatus(currentStatus: VideoTaskStatus, maxStatus: VideoTaskStatus) {
  return getVideoTaskStatusIndex(currentStatus) <= getVideoTaskStatusIndex(maxStatus) ? currentStatus : maxStatus;
}

export function getVideoTaskStatusMeta(status: VideoTaskStatus) {
  const currentStep = videoTaskStatusFlow.find((item) => item.key === status);

  return {
    label: currentStep?.label ?? "任务处理中",
    description: currentStep?.description ?? "",
    tone: "created" as VideoTaskStageTone,
  };
}

export function getVideoTaskModuleStatusMeta(
  currentStatus: VideoTaskStatus | null | undefined,
  targetStatus: VideoTaskStatus,
) {
  if (!currentStatus) {
    return {
      label: "任务未创建",
      tone: "idle" as VideoTaskStageTone,
    };
  }

  const currentIndex = getVideoTaskStatusIndex(currentStatus);
  const targetIndex = getVideoTaskStatusIndex(targetStatus);

  if (currentIndex >= targetIndex) {
    return getVideoTaskStatusMeta(targetStatus);
  }

  return {
    label: "待开始",
    tone: "editing" as VideoTaskStageTone,
  };
}

export function deriveVideoTaskTitle(source: VideoTaskSource) {
  const explicitSource =
    source.userPrompt.trim() ||
    source.optimizedUserPrompt?.trim() ||
    source.videoMaterialName?.trim() ||
    source.videoTemplatePrompt.trim() ||
    source.productInfoTitle?.trim() ||
    source.productInfoSnapshot.trim();
  if (explicitSource.trim()) {
    return explicitSource.replace(/\s+/g, " ").slice(0, 18);
  }

  return "未命名视频任务";
}
