export type VideoMaterialStatus =
  | "uploading"
  | "converting"
  | "transcribing"
  | "analyzing"
  | "generating"
  | "ready"
  | "error";

export type ProcessingMode = "auto_all" | "audio_only";

export type VideoMaterialImageAsset = {
  imageId: string;
  imageUrl: string;
  fileName: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  timestampSeconds: number | null;
  label: string;
  sourceImageId: string | null;
  createdAt: string;
};

export type VideoMaterialImageCleaningJob = {
  status: "idle" | "running" | "completed" | "error";
  requestedImageIds: string[];
  totalCount: number;
  processedCount: number;
  cleanedCount: number;
  failedImageIds: string[];
  currentImageId: string | null;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
};

export type VideoMaterialTranscriptLine = {
  text: string;
  startTime: number;
  endTime: number;
};

export type VideoMaterialRecord = {
  materialId: string;
  ownerUserId: string | null;
  name: string;
  nameEditedAt?: string | null;
  status: VideoMaterialStatus;
  statusMessage: string;
  processingMode: ProcessingMode;

  videoFileName: string | null;
  videoFileUrl: string | null;
  videoUploadedAt: string | null;

  audioFileName: string | null;
  audioFileUrl: string | null;
  audioConvertedAt: string | null;

  framesExtracted: number;
  extractedFrames: VideoMaterialImageAsset[];
  cleanedFrames: VideoMaterialImageAsset[];
  imageCleaningJob: VideoMaterialImageCleaningJob;
  videoAnalysis: string;
  videoAnalysisCompletedAt: string | null;

  rawTranscript: string;
  transcriptLines?: VideoMaterialTranscriptLine[];
  visualSubtitleText: string;
  visualSubtitleLines?: string[];
  contentScript: string;
  videoTemplatePrompt: string;
  reversePrompt: string;
  subtitle: string;

  createdAt: string;
  updatedAt: string;
};

export type VideoMaterialSummary = Omit<
  VideoMaterialRecord,
  | "videoAnalysis"
  | "rawTranscript"
  | "transcriptLines"
  | "visualSubtitleText"
  | "visualSubtitleLines"
  | "contentScript"
  | "videoTemplatePrompt"
  | "reversePrompt"
  | "extractedFrames"
  | "cleanedFrames"
>;
