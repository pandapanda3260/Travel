"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, PencilLine } from "lucide-react";

import { extractVisualSubtitleLinesFromAnalysis } from "../../../lib/video-material-subtitles";
import { sortVideoMaterialsByUploadTimeDesc } from "../../../lib/video-material-sort";
import type { ProcessingMode, VideoMaterialRecord, VideoMaterialSummary } from "../../../lib/video-material-types";
import { PageBrandTitle } from "../../_components/page-brand-title";
import { useVideoTimecode } from "../../_components/use-video-timecode";
import { ModuleStatusBadge, ModuleTitle } from "../../studio/task-creation/_components/task-ui";
import { VideoMaterialImagePreviewModal } from "./_components/video-material-image-preview-modal";

export type VideoMaterialsPayload = {
  materials: VideoMaterialSummary[];
  runtime: {
    asrProviderLabel: string;
    asrLiveEnabled: boolean;
    textProviderLabel: string;
    textLiveEnabled: boolean;
    visionProviderLabel: string;
    visionLiveEnabled: boolean;
  };
  error?: string;
};

const maxUploadFileSizeBytes = 500 * 1024 * 1024;

const PROCESSING_MODE_OPTIONS: Array<{
  value: ProcessingMode;
  label: string;
  description: string;
}> = [
  {
    value: "auto_all",
    label: "自动生成全部",
    description: "分析视频 + 识别音频 + 视频理解 + 生成脚本（自动流程，综合生成）",
  },
  {
    value: "audio_only",
    label: "只识别音频",
    description: "仅提取音轨并识别语音内容",
  },
];

function getDisplayMaterialName(record: Pick<VideoMaterialRecord, "name" | "subtitle" | "videoFileName">): string {
  if (record.name && record.name.trim()) {
    const chars = Array.from(record.name.trim());
    return chars.length <= 10 ? record.name.trim() : `${chars.slice(0, 10).join("")}…`;
  }
  if (record.subtitle && record.subtitle.trim()) {
    const chars = Array.from(record.subtitle.trim());
    return chars.length <= 8 ? chars.join("") : `${chars.slice(0, 8).join("")}…`;
  }
  if (record.videoFileName) return record.videoFileName;
  return "未命名素材";
}

function getEditableMaterialName(record: Pick<VideoMaterialRecord, "name" | "subtitle" | "videoFileName">): string {
  if (record.name?.trim()) return record.name.trim();
  if (record.subtitle?.trim()) return getDisplayMaterialName(record);
  return record.videoFileName ?? "";
}

function getMaterialListStatusMeta(status: VideoMaterialRecord["status"]) {
  switch (status) {
    case "ready":
      return { label: "已就绪", className: "task-module-status created" };
    case "error":
      return { label: "处理失败", className: "task-module-status idle" };
    case "uploading":
      return { label: "上传中", className: "task-module-status editing" };
    case "converting":
      return { label: "转换中", className: "task-module-status editing" };
    case "transcribing":
      return { label: "识别中", className: "task-module-status editing" };
    case "analyzing":
      return { label: "分析中", className: "task-module-status editing" };
    case "generating":
      return { label: "生成中", className: "task-module-status editing" };
    default:
      return { label: "未知", className: "task-module-status idle" };
  }
}

function toMaterialSummary(record: VideoMaterialRecord): VideoMaterialSummary {
  const {
    videoAnalysis,
    rawTranscript,
    contentScript,
    videoTemplatePrompt,
    reversePrompt,
    transcriptLines,
    visualSubtitleText,
    visualSubtitleLines,
    extractedFrames,
    cleanedFrames,
    ...summary
  } = record;
  void videoAnalysis;
  void rawTranscript;
  void contentScript;
  void videoTemplatePrompt;
  void reversePrompt;
  void transcriptLines;
  void visualSubtitleText;
  void visualSubtitleLines;
  void extractedFrames;
  void cleanedFrames;
  return summary;
}

function buildMaterialFromSummary(
  summary: VideoMaterialSummary,
  detail: VideoMaterialRecord | null,
): VideoMaterialRecord {
  if (detail?.materialId === summary.materialId) {
    return {
      ...summary,
      ...detail,
    };
  }

  return {
    ...summary,
    extractedFrames: [],
    cleanedFrames: [],
    videoAnalysis: "",
    rawTranscript: "",
    transcriptLines: [],
    visualSubtitleText: "",
    visualSubtitleLines: [],
    contentScript: "",
    videoTemplatePrompt: "",
    reversePrompt: "",
  };
}

function formatFrameTimeLabel(timestampSeconds: number | null) {
  if (timestampSeconds == null || !Number.isFinite(timestampSeconds)) {
    return "";
  }
  return `${Math.max(0, timestampSeconds).toFixed(timestampSeconds >= 10 ? 0 : 1)}s`;
}

function VideoMaterialFrameStrip({
  title,
  images,
  emptyText,
  onPreview,
  action,
}: {
  title: string;
  images: VideoMaterialRecord["extractedFrames"];
  emptyText: string;
  onPreview: (imageId: string) => void;
  action?: ReactNode;
}) {
  return (
    <section className="task-visual-shot-strip-card vm-frame-preview-card">
      <div className="task-visual-shot-strip-head">
        <strong className="task-visual-section-title vm-frame-preview-title">{title}</strong>
        <div className="vm-frame-preview-head-actions">
          {action ?? null}
          <span className="table-meta">{images.length ? `${images.length} 张` : "暂无图片"}</span>
        </div>
      </div>
      {images.length ? (
        <div className="task-visual-shot-strip-list">
          {images.map((image) => (
            <button
              key={image.imageId}
              className="task-visual-shot-strip-item"
              type="button"
              onClick={() => onPreview(image.imageId)}
            >
              <div className="task-visual-shot-strip-media">
                <Image src={image.imageUrl} alt={image.label} width={900} height={1350} unoptimized />
              </div>
              <span className="task-visual-shot-strip-label">
                {formatFrameTimeLabel(image.timestampSeconds)
                  ? `${image.label} · ${formatFrameTimeLabel(image.timestampSeconds)}`
                  : image.label}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="task-visual-shot-candidate-empty vm-frame-preview-empty">{emptyText}</div>
      )}
    </section>
  );
}

function getMaterialModuleStatusMeta(input: {
  hasMaterial: boolean;
  status?: VideoMaterialRecord["status"];
  isBusy?: boolean;
}) {
  if (input.isBusy) return { label: "处理中", tone: "editing" as const };
  if (!input.hasMaterial) return { label: "未开始", tone: "idle" as const };
  if (input.status === "ready") return { label: "已就绪", tone: "created" as const };
  if (input.status === "error") return { label: "处理失败", tone: "idle" as const };
  return { label: "处理中", tone: "editing" as const };
}

function getProcessingModeLabel(mode: ProcessingMode): string {
  return PROCESSING_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "自动生成全部";
}

function tryFormatAnalysisJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function getAnalysisSummary(analysisJson: string): { shotCount: number; videoType: string; theme: string } | null {
  try {
    const parsed = JSON.parse(analysisJson) as Record<string, unknown>;
    const info = parsed["视频级信息"] as Record<string, unknown> | undefined;
    const shots = parsed["镜头序列"] as unknown[] | undefined;
    return {
      shotCount: Array.isArray(shots) ? shots.length : 0,
      videoType: (info?.["视频类型"] as string) ?? "未知",
      theme: (info?.["核心主题"] as string) ?? "未知",
    };
  } catch {
    return null;
  }
}

function splitMaterialSubtitleText(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getMaterialAudioTranscriptLines(material: VideoMaterialRecord): string[] {
  const transcriptLines = material.transcriptLines?.map((line) => line.text.trim()).filter(Boolean) ?? [];
  if (transcriptLines.length > 0) {
    return transcriptLines;
  }

  const rawTranscript = material.rawTranscript.trim();
  return rawTranscript ? [rawTranscript] : [];
}

function getMaterialVisualSubtitleLines(material: VideoMaterialRecord): string[] {
  const storedLines = material.visualSubtitleLines?.map((line) => line.trim()).filter(Boolean) ?? [];
  if (storedLines.length > 0) {
    return storedLines;
  }

  const storedTextLines = splitMaterialSubtitleText(material.visualSubtitleText);
  if (storedTextLines.length > 0) {
    return storedTextLines;
  }

  return extractVisualSubtitleLinesFromAnalysis(material.videoAnalysis);
}

export default function VideoMaterialsPageClient({
  initialData,
  initialError = null,
}: {
  initialData: VideoMaterialsPayload;
  initialError?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [materials, setMaterials] = useState<VideoMaterialSummary[]>(() =>
    sortVideoMaterialsByUploadTimeDesc(initialData.materials ?? []),
  );
  const [runtime, setRuntime] = useState<VideoMaterialsPayload["runtime"] | null>(initialData.runtime ?? null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedMaterialDetail, setSelectedMaterialDetail] = useState<VideoMaterialRecord | null>(null);
  const [isSelectedMaterialLoading, setIsSelectedMaterialLoading] = useState(
    () => (initialData.materials?.length ?? 0) > 0,
  );
  const [selectedMaterialError, setSelectedMaterialError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">(() =>
    initialError ? "error" : "success",
  );
  const [isUploading, setIsUploading] = useState(false);
  const [deletingMaterialId, setDeletingMaterialId] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const pollTimerRef = useRef<number | null>(null);
  const detailRequestIdRef = useRef(0);

  const [processingMode, setProcessingMode] = useState<ProcessingMode>("auto_all");
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState("");
  const [editingMaterialName, setEditingMaterialName] = useState("");
  const [savingMaterialNameId, setSavingMaterialNameId] = useState("");
  const [copiedMaterialId, setCopiedMaterialId] = useState("");
  const copiedTimerRef = useRef<number | null>(null);
  const skipNameSaveRef = useRef(false);

  const selectedMaterialSummary =
    materials.find((material) => material.materialId === selectedMaterialId) ?? materials[0] ?? null;
  const requestedMaterialId = searchParams.get("materialId")?.trim() ?? "";

  const selectedMaterial = useMemo(() => {
    if (!selectedMaterialSummary) {
      return null;
    }
    return buildMaterialFromSummary(selectedMaterialSummary, selectedMaterialDetail);
  }, [selectedMaterialDetail, selectedMaterialSummary]);
  const selectedMaterialAudioTranscriptLines = useMemo(
    () => (selectedMaterial ? getMaterialAudioTranscriptLines(selectedMaterial) : []),
    [selectedMaterial],
  );
  const selectedMaterialAudioTranscriptText = selectedMaterialAudioTranscriptLines.join("\n");
  const selectedMaterialAudioTranscriptCharCount = selectedMaterialAudioTranscriptLines.reduce(
    (total, line) => total + Array.from(line).length,
    0,
  );
  const selectedMaterialVisualSubtitleLines = useMemo(
    () => (selectedMaterial ? getMaterialVisualSubtitleLines(selectedMaterial) : []),
    [selectedMaterial],
  );
  const selectedMaterialVisualSubtitleText = selectedMaterialVisualSubtitleLines.join("\n");
  const selectedMaterialVisualSubtitleCharCount = selectedMaterialVisualSubtitleLines.reduce(
    (total, line) => total + Array.from(line).length,
    0,
  );
  const previewVideoTimecode = useVideoTimecode(selectedMaterial?.videoFileUrl ?? null);

  useEffect(() => {
    if (!previewImageId) {
      return;
    }
    if (!selectedMaterial?.extractedFrames.some((image) => image.imageId === previewImageId)) {
      setPreviewImageId(null);
    }
  }, [previewImageId, selectedMaterial]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const hasProcessingMaterials = useMemo(
    () => materials.some((m) => m.status !== "ready" && m.status !== "error"),
    [materials],
  );

  useEffect(() => {
    if (!materials.length) {
      setSelectedMaterialId("");
      setSelectedMaterialDetail(null);
      setSelectedMaterialError(null);
      return;
    }
    setSelectedMaterialId((current) =>
      current && materials.some((m) => m.materialId === current) ? current : materials[0].materialId,
    );
  }, [materials]);

  useEffect(() => {
    if (!requestedMaterialId || !materials.some((material) => material.materialId === requestedMaterialId)) {
      return;
    }
    setSelectedMaterialId(requestedMaterialId);
  }, [materials, requestedMaterialId]);

  const loadMaterialDetail = useCallback(async (materialId: string) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setIsSelectedMaterialLoading(true);

    try {
      const response = await fetch(`/api/video-materials/${materialId}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        material?: VideoMaterialRecord;
        error?: string;
      };
      if (!response.ok || !data.material) {
        throw new Error(data.error ?? "素材详情加载失败");
      }
      if (requestId !== detailRequestIdRef.current) {
        return;
      }
      setSelectedMaterialDetail(data.material);
      setSelectedMaterialError(null);
    } catch (detailError) {
      if (requestId !== detailRequestIdRef.current) {
        return;
      }
      setSelectedMaterialError(detailError instanceof Error ? detailError.message : "素材详情加载失败");
    } finally {
      if (requestId === detailRequestIdRef.current) {
        setIsSelectedMaterialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedMaterialSummary) {
      return;
    }

    if (
      selectedMaterialDetail?.materialId === selectedMaterialSummary.materialId &&
      selectedMaterialDetail.updatedAt === selectedMaterialSummary.updatedAt
    ) {
      return;
    }

    void loadMaterialDetail(selectedMaterialSummary.materialId);
  }, [
    loadMaterialDetail,
    selectedMaterialDetail?.materialId,
    selectedMaterialDetail?.updatedAt,
    selectedMaterialSummary,
  ]);

  useEffect(() => {
    if (!hasProcessingMaterials) {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    if (pollTimerRef.current) return;

    pollTimerRef.current = window.setInterval(async () => {
      try {
        const response = await fetch("/api/video-materials", { cache: "no-store" });
        const data = (await response.json()) as VideoMaterialsPayload;
        if (response.ok && data.materials) {
          setMaterials(sortVideoMaterialsByUploadTimeDesc(data.materials));
          if (data.runtime) {
            setRuntime(data.runtime);
          }
        }
      } catch {
        // silent poll failure
      }
    }, 5000);

    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [hasProcessingMaterials]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setShowModeDropdown(false);
      }
    }
    if (showModeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showModeDropdown]);

  const previewInfoRows = useMemo(
    () =>
      selectedMaterial
        ? [
            { label: "素材 ID", value: selectedMaterial.materialId.slice(0, 12) },
            { label: "状态", value: getMaterialListStatusMeta(selectedMaterial.status).label },
            { label: "处理模式", value: getProcessingModeLabel(selectedMaterial.processingMode ?? "auto_all") },
            { label: "视频文件", value: selectedMaterial.videoFileName ?? "未上传" },
            { label: "音频文件", value: selectedMaterial.audioFileName ?? "未生成" },
            {
              label: "上传时间",
              value: selectedMaterial.videoUploadedAt
                ? new Date(selectedMaterial.videoUploadedAt).toLocaleString("zh-CN")
                : "—",
            },
            {
              label: "ASR 服务",
              value: runtime ? `${runtime.asrProviderLabel}` : "未加载",
            },
            ...(selectedMaterial.processingMode !== "audio_only"
              ? [
                  {
                    label: "视觉分析",
                    value: runtime ? `${runtime.visionProviderLabel}` : "未加载",
                  },
                ]
              : []),
          ]
        : [],
    [runtime, selectedMaterial],
  );

  const handleStartRenameMaterial = useCallback((material: VideoMaterialSummary) => {
    skipNameSaveRef.current = false;
    setEditingMaterialId(material.materialId);
    setEditingMaterialName(getEditableMaterialName(material));
    setError(null);
  }, []);

  const handleSaveMaterialName = useCallback(
    async (material: VideoMaterialSummary) => {
      if (editingMaterialId !== material.materialId) {
        return;
      }
      if (skipNameSaveRef.current) {
        skipNameSaveRef.current = false;
        return;
      }

      const nextName = editingMaterialName.trim();
      if (!nextName) {
        setError("素材名称不能为空");
        return;
      }

      if (nextName === material.name.trim()) {
        setEditingMaterialId("");
        setEditingMaterialName("");
        return;
      }

      setSavingMaterialNameId(material.materialId);
      setError(null);
      try {
        const response = await fetch(`/api/video-materials/${material.materialId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", name: nextName }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          material?: VideoMaterialRecord;
          error?: string;
        };
        if (!response.ok || !data.material) {
          throw new Error(data.error ?? "素材名称保存失败");
        }

        const updatedSummary = toMaterialSummary(data.material);
        setMaterials((current) =>
          sortVideoMaterialsByUploadTimeDesc(
            current.map((item) => (item.materialId === updatedSummary.materialId ? updatedSummary : item)),
          ),
        );
        setSelectedMaterialDetail((current) =>
          current?.materialId === data.material!.materialId ? data.material! : current,
        );
        setSelectedMaterialError(null);
        setEditingMaterialId("");
        setEditingMaterialName("");
      } catch (renameError) {
        setError(renameError instanceof Error ? renameError.message : "素材名称保存失败");
      } finally {
        setSavingMaterialNameId("");
      }
    },
    [editingMaterialId, editingMaterialName],
  );

  const handleCopyMaterialId = useCallback(async (materialId: string) => {
    try {
      await navigator.clipboard.writeText(materialId);
      setCopiedMaterialId(materialId);
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopiedMaterialId(""), 1200);
    } catch {
      window.alert("复制失败，请稍后重试");
    }
  }, []);

  const baseInfoStatusMeta = getMaterialModuleStatusMeta({
    hasMaterial: Boolean(selectedMaterial),
    status: selectedMaterial?.status,
    isBusy: isUploading,
  });

  const transcriptStatusMeta = getMaterialModuleStatusMeta({
    hasMaterial: Boolean(selectedMaterial),
    status:
      selectedMaterialAudioTranscriptLines.length > 0 || selectedMaterialVisualSubtitleLines.length > 0
        ? "ready"
        : selectedMaterial?.status,
  });

  const videoAnalysisStatusMeta = getMaterialModuleStatusMeta({
    hasMaterial: Boolean(selectedMaterial),
    status: selectedMaterial?.videoAnalysis ? "ready" : selectedMaterial?.status,
  });

  const contentStatusMeta = getMaterialModuleStatusMeta({
    hasMaterial: Boolean(selectedMaterial),
    status:
      selectedMaterial?.contentScript ||
      selectedMaterial?.videoTemplatePrompt ||
      selectedMaterial?.reversePrompt ||
      selectedMaterial?.subtitle
        ? "ready"
        : selectedMaterial?.status,
  });

  const handleUploadVideo = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setError(null);
      try {
        const createResponse = await fetch("/api/video-materials", { method: "POST" });
        const createData = (await createResponse.json()) as {
          material?: VideoMaterialRecord;
          error?: string;
        };
        if (!createResponse.ok || !createData.material) {
          throw new Error(createData.error ?? "创建素材记录失败");
        }

        const newMaterial = createData.material;
        setMaterials((current) =>
          sortVideoMaterialsByUploadTimeDesc([
            toMaterialSummary(newMaterial),
            ...current.filter((m) => m.materialId !== newMaterial.materialId),
          ]),
        );
        setSelectedMaterialId(newMaterial.materialId);

        const formData = new FormData();
        formData.set("file", file);
        formData.set("processingMode", processingMode);
        const uploadResponse = await fetch(`/api/video-materials/${newMaterial.materialId}`, {
          method: "POST",
          body: formData,
        });
        const uploadData = (await uploadResponse.json()) as {
          material?: VideoMaterialRecord;
          error?: string;
        };
        if (!uploadResponse.ok || !uploadData.material) {
          throw new Error(uploadData.error ?? "视频上传失败");
        }

        setMaterials((current) =>
          sortVideoMaterialsByUploadTimeDesc(
            current.map((m) =>
              m.materialId === uploadData.material!.materialId ? toMaterialSummary(uploadData.material!) : m,
            ),
          ),
        );
        setSelectedMaterialDetail(uploadData.material);
        setSelectedMaterialError(null);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "视频上传失败");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [processingMode],
  );

  async function handleDeleteMaterial(materialId: string) {
    setDeletingMaterialId(materialId);
    setError(null);
    try {
      const response = await fetch(`/api/video-materials/${materialId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "删除素材失败");
      }
      setMaterials((current) => current.filter((m) => m.materialId !== materialId));
      if (selectedMaterialDetail?.materialId === materialId) {
        setSelectedMaterialDetail(null);
        setSelectedMaterialError(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除素材失败");
    } finally {
      setDeletingMaterialId("");
    }
  }

  async function handleReprocess(materialId: string) {
    setIsReprocessing(true);
    setError(null);
    try {
      const response = await fetch(`/api/video-materials/${materialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reprocess", processingMode }),
      });
      const data = (await response.json()) as {
        material?: VideoMaterialRecord;
        error?: string;
      };
      if (!response.ok || !data.material) {
        throw new Error(data.error ?? "重新处理失败");
      }
      setMaterials((current) =>
        sortVideoMaterialsByUploadTimeDesc(
          current.map((m) => (m.materialId === data.material!.materialId ? toMaterialSummary(data.material!) : m)),
        ),
      );
      if (data.material.materialId === selectedMaterialId) {
        setSelectedMaterialDetail(data.material);
        setSelectedMaterialError(null);
      }
    } catch (reprocessError) {
      setError(reprocessError instanceof Error ? reprocessError.message : "重新处理失败");
    } finally {
      setIsReprocessing(false);
    }
  }

  const isAutoAllMode = (selectedMaterial?.processingMode ?? "auto_all") !== "audio_only";
  const analysisSummary = selectedMaterial?.videoAnalysis ? getAnalysisSummary(selectedMaterial.videoAnalysis) : null;
  const canReprocess = selectedMaterial?.status === "ready" || selectedMaterial?.status === "error";

  if (loadingStatus === "loading" && !materials.length) {
    return (
      <main className="shell">
        <section className="content">
          <section className="panel product-archive-panel">
            <div className="product-archive-empty">视频拆解页面加载中...</div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Video Breakdown" />
              <div className="topbar-actions compact">
                {/* Mode selector dropdown */}
                <div className="vm-mode-selector-wrapper" ref={modeDropdownRef}>
                  <button
                    className="toolbar-button vm-mode-trigger"
                    type="button"
                    onClick={() => setShowModeDropdown((v) => !v)}
                  >
                    <span className="vm-mode-trigger-label">模式选择</span>
                    <span className="vm-mode-trigger-value">{getProcessingModeLabel(processingMode)}</span>
                    <span className="vm-mode-trigger-arrow">{showModeDropdown ? "▲" : "▼"}</span>
                  </button>
                  {showModeDropdown ? (
                    <div className="vm-mode-dropdown">
                      {PROCESSING_MODE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`vm-mode-option${processingMode === option.value ? " vm-mode-option-active" : ""}`}
                          onClick={() => {
                            setProcessingMode(option.value);
                            setShowModeDropdown(false);
                          }}
                        >
                          <span className="vm-mode-option-check">{processingMode === option.value ? "✓" : ""}</span>
                          <span className="vm-mode-option-content">
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button className="toolbar-button" type="button">
                  使用说明
                </button>
              </div>
            </div>
          </header>

          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>工作台说明</strong>
              <span>
                上传视频后，系统根据所选模式自动处理：「自动生成全部」将并行进行视频分析与音频识别，最终综合生成内容脚本与提示词；「只识别音频」仅提取并识别音频内容。
              </span>
            </div>
            <button
              className="task-workbench-create-btn"
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="task-workbench-create-btn-text">{isUploading ? "上传中…" : "上传新的视频"}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  if (file.size > maxUploadFileSizeBytes) {
                    window.alert("视频文件不能超过 500MB，请压缩后重试。");
                    event.target.value = "";
                    return;
                  }
                  void handleUploadVideo(file);
                }
              }}
            />
          </section>
        </section>

        <section className="voice-page-stack">
          {error ? <div className="error-box">{error}</div> : null}

          <div className="dashboard-grid generation-tasks-grid product-archive-dashboard">
            {/* Left: Material List */}
            <section className="panel dashboard-list product-archive-list-panel">
              <ModuleTitle
                title="视频拆解列表"
                eyebrow="素材管理"
                level="primary"
                action={
                  <div className="action-row product-archive-header-actions">
                    <span className="table-meta">{materials.length} 条素材</span>
                  </div>
                }
              />
              <div className="table-wrap fixed-table-wrap product-archive-fixed-wrap">
                <table className="task-table jobs-table">
                  <thead>
                    <tr>
                      <th>素材 ID</th>
                      <th>素材名称</th>
                      <th>模式</th>
                      <th>状态</th>
                      <th>上传时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((material) => {
                      const statusMeta = getMaterialListStatusMeta(material.status);
                      return (
                        <tr
                          key={material.materialId}
                          className={material.materialId === selectedMaterialId ? "task-table-row-active" : ""}
                        >
                          <td>
                            <span className="job-id-cell vm-material-id-cell">
                              <span>{material.materialId.slice(0, 8)}...</span>
                              <button
                                className="btn-copy vm-row-icon-button"
                                type="button"
                                aria-label="复制素材 ID"
                                title={copiedMaterialId === material.materialId ? "已复制" : "复制素材 ID"}
                                onClick={() => void handleCopyMaterialId(material.materialId)}
                              >
                                {copiedMaterialId === material.materialId ? (
                                  <Check size={13} strokeWidth={2.2} />
                                ) : (
                                  <Copy size={13} strokeWidth={1.9} />
                                )}
                              </button>
                            </span>
                          </td>
                          <td className="task-name-cell vm-material-name-cell">
                            {editingMaterialId === material.materialId ? (
                              <input
                                className="vm-material-name-input"
                                value={editingMaterialName}
                                autoFocus
                                disabled={savingMaterialNameId === material.materialId}
                                maxLength={60}
                                aria-label="修改素材名称"
                                onChange={(event) => setEditingMaterialName(event.target.value)}
                                onFocus={(event) => event.currentTarget.select()}
                                onBlur={() => void handleSaveMaterialName(material)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                  if (event.key === "Escape") {
                                    skipNameSaveRef.current = true;
                                    setEditingMaterialId("");
                                    setEditingMaterialName("");
                                  }
                                }}
                              />
                            ) : (
                              <span className="vm-material-name-view">
                                <span className="vm-material-name-text">{getDisplayMaterialName(material)}</span>
                                <button
                                  className="vm-row-icon-button"
                                  type="button"
                                  aria-label="修改素材名称"
                                  title="修改素材名称"
                                  onClick={() => handleStartRenameMaterial(material)}
                                >
                                  <PencilLine size={13} strokeWidth={1.9} />
                                </button>
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="table-meta vm-mode-badge">
                              {getProcessingModeLabel(material.processingMode ?? "auto_all")}
                            </span>
                          </td>
                          <td>
                            <span className={`table-status ${statusMeta.className}`.trim()}>{statusMeta.label}</span>
                          </td>
                          <td className="submitted-time-cell">
                            {material.videoUploadedAt ? (
                              <>
                                <span>{new Date(material.videoUploadedAt).toLocaleDateString("zh-CN")}</span>
                                <strong>
                                  {new Date(material.videoUploadedAt).toLocaleTimeString("zh-CN", {
                                    hour12: false,
                                  })}
                                </strong>
                              </>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td>
                            <div className="table-actions">
                              <button
                                className="btn-pill"
                                type="button"
                                onClick={() => setSelectedMaterialId(material.materialId)}
                              >
                                查看
                              </button>
                              <button
                                className="btn-pill btn-pill-danger"
                                type="button"
                                disabled={deletingMaterialId === material.materialId}
                                onClick={() => void handleDeleteMaterial(material.materialId)}
                              >
                                {deletingMaterialId === material.materialId ? "删除中" : "删除"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!materials.length ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="product-archive-empty">
                            还没有视频拆解记录，请点击右上角按钮上传视频文件。
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Right: Material Preview */}
            <section className="panel preview-panel dashboard-preview product-archive-preview-panel">
              <ModuleTitle
                title="素材预览"
                eyebrow="结果预览"
                level="primary"
                action={
                  <span className="table-meta">
                    {selectedMaterial ? `当前素材：${getDisplayMaterialName(selectedMaterial)}` : "未选择"}
                  </span>
                }
              />

              <div className="result-layout equal-height-columns product-archive-preview-layout">
                <div className="video-frame product-archive-effect-frame vm-preview-video-frame">
                  {selectedMaterial?.videoFileUrl ? (
                    <>
                      <video
                        key={selectedMaterial.videoFileUrl}
                        src={selectedMaterial.videoFileUrl}
                        controls
                        preload="metadata"
                        className="vm-preview-player"
                        {...previewVideoTimecode.videoTimecodeProps}
                      />
                      <div className="video-timecode-badge">{previewVideoTimecode.timecodeLabel}</div>
                    </>
                  ) : (
                    <div className="product-archive-effect-empty">
                      <strong>视频预览</strong>
                      <span>选择素材后在此预览视频内容。</span>
                    </div>
                  )}
                </div>

                <div className="video-params-panel">
                  <div className="video-params-header">
                    <p className="eyebrow">关键信息</p>
                  </div>
                  <div className="video-params-list">
                    {previewInfoRows.map((item) => (
                      <div key={item.label} className="video-param-row">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Bottom: Material Detail */}
          <section className="composer-card voice-section-card product-archive-detail-card">
            <ModuleTitle
              title="视频拆解详细情况"
              eyebrow="素材详情"
              inner
              level="primary"
              action={
                <div className="action-row" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {selectedMaterial ? (
                    <span className="table-meta vm-header-meta-row">
                      <span className="vm-header-id-row">
                        <span>{selectedMaterial.materialId.slice(0, 8)}</span>
                        <button
                          className="btn-copy"
                          type="button"
                          aria-label="复制素材 ID"
                          title={copiedMaterialId === selectedMaterial.materialId ? "已复制" : "复制素材 ID"}
                          onClick={() => void handleCopyMaterialId(selectedMaterial.materialId)}
                        >
                          {copiedMaterialId === selectedMaterial.materialId ? (
                            <Check size={13} strokeWidth={2.2} />
                          ) : (
                            <Copy size={13} strokeWidth={1.9} />
                          )}
                        </button>
                      </span>
                      <span>{getMaterialListStatusMeta(selectedMaterial.status).label}</span>
                      <span>{getProcessingModeLabel(selectedMaterial.processingMode ?? "auto_all")}</span>
                    </span>
                  ) : (
                    <span className="table-meta">未选择</span>
                  )}
                  {selectedMaterial && canReprocess ? (
                    <button
                      className="btn-pill"
                      type="button"
                      disabled={isReprocessing}
                      onClick={() => void handleReprocess(selectedMaterial.materialId)}
                    >
                      {isReprocessing ? "处理中…" : "重新处理"}
                    </button>
                  ) : null}
                </div>
              }
            />

            {selectedMaterial ? (
              !selectedMaterialDetail && isSelectedMaterialLoading ? (
                <div className="product-archive-empty">素材详情加载中...</div>
              ) : (
                <div className="product-archive-detail-stack">
                  {selectedMaterialError ? <div className="error-box">{selectedMaterialError}</div> : null}
                  {selectedMaterial.statusMessage ? (
                    <div className="vm-status-message">
                      <span>{selectedMaterial.statusMessage}</span>
                    </div>
                  ) : null}

                  {/* Step 1: Upload & Audio Conversion */}
                  <section className="composer-card voice-section-card inner-card">
                    <ModuleTitle
                      title="第一步：视频上传与音频提取"
                      inner
                      level="secondary"
                      action={<ModuleStatusBadge label={baseInfoStatusMeta.label} tone={baseInfoStatusMeta.tone} />}
                    />
                    <p className="vm-detail-step-description">
                      上传视频后系统自动提取音频轨道，为后续语音识别提供输入源。
                    </p>
                    <div className="vm-detail-info-grid">
                      <div className="vm-detail-info-item">
                        <span>视频文件</span>
                        <strong>{selectedMaterial.videoFileName ?? "未上传"}</strong>
                      </div>
                      <div className="vm-detail-info-item">
                        <span>音频文件</span>
                        <strong>{selectedMaterial.audioFileName ?? "未生成"}</strong>
                      </div>
                      <div className="vm-detail-info-item">
                        <span>上传时间</span>
                        <strong>
                          {selectedMaterial.videoUploadedAt
                            ? new Date(selectedMaterial.videoUploadedAt).toLocaleString("zh-CN")
                            : "—"}
                        </strong>
                      </div>
                      <div className="vm-detail-info-item">
                        <span>音频转换时间</span>
                        <strong>
                          {selectedMaterial.audioConvertedAt
                            ? new Date(selectedMaterial.audioConvertedAt).toLocaleString("zh-CN")
                            : "—"}
                        </strong>
                      </div>
                    </div>
                    {selectedMaterial.audioFileUrl ? (
                      <div className="vm-audio-player-card">
                        <div className="vm-audio-player-card-head">
                          <strong>音频预览</strong>
                          <span className="table-meta">从视频中提取的音频轨道</span>
                        </div>
                        <audio
                          src={selectedMaterial.audioFileUrl}
                          controls
                          preload="metadata"
                          className="vm-audio-player"
                        />
                      </div>
                    ) : null}
                    <div className="vm-frame-preview-stack">
                      <VideoMaterialFrameStrip
                        title="抽帧图片预览"
                        images={selectedMaterial.extractedFrames}
                        emptyText="自动抽帧完成后，这里会展示关键帧图片预览。"
                        onPreview={setPreviewImageId}
                        action={
                          <button
                            className="btn-pill vm-image-list-entry"
                            type="button"
                            disabled={!selectedMaterial.materialId}
                            onClick={() => router.push(`/assets/video-materials/${selectedMaterial.materialId}/images`)}
                          >
                            点击进入图片列表页
                          </button>
                        }
                      />
                    </div>
                  </section>

                  {/* Step 2: Audio transcript and visual subtitles */}
                  <section className="composer-card voice-section-card inner-card">
                    <ModuleTitle
                      title="第二步：音频文字与画面字幕"
                      inner
                      level="secondary"
                      action={<ModuleStatusBadge label={transcriptStatusMeta.label} tone={transcriptStatusMeta.tone} />}
                    />
                    <div className="vm-transcript-grid">
                      <div className="vm-content-card">
                        <div className="vm-content-card-head">
                          <strong>音频识别结果</strong>
                          <span>
                            {selectedMaterialAudioTranscriptLines.length > 0
                              ? `${selectedMaterialAudioTranscriptLines.length} 条 · ${selectedMaterialAudioTranscriptCharCount} 字`
                              : "待识别"}
                          </span>
                        </div>
                        <textarea
                          className="vm-content-textarea vm-transcript-textarea"
                          value={selectedMaterialAudioTranscriptText}
                          readOnly
                          placeholder="音频识别完成后，这里会展示从声音里识别出的文字。"
                        />
                      </div>
                      <div className="vm-content-card">
                        <div className="vm-content-card-head">
                          <strong>画面字幕结果</strong>
                          <span>
                            {selectedMaterialVisualSubtitleLines.length > 0
                              ? `${selectedMaterialVisualSubtitleLines.length} 条 · ${selectedMaterialVisualSubtitleCharCount} 字`
                              : "待识别"}
                          </span>
                        </div>
                        <textarea
                          className="vm-content-textarea vm-transcript-textarea"
                          value={selectedMaterialVisualSubtitleText}
                          readOnly
                          placeholder="视频画面分析完成后，这里会展示从画面里读到的字幕。"
                        />
                      </div>
                    </div>
                  </section>

                  {/* Step 3: Video Content Understanding (auto_all mode only) */}
                  {isAutoAllMode ? (
                    <section className="composer-card voice-section-card inner-card">
                      <ModuleTitle
                        title="第三步：视频内容理解"
                        inner
                        level="secondary"
                        action={
                          <div className="vm-inline-status-row">
                            {(selectedMaterial.framesExtracted ?? 0) > 0 ? (
                              <span className="vm-inline-stat-text">{`关键帧数量 ${selectedMaterial.framesExtracted} 帧`}</span>
                            ) : null}
                            <ModuleStatusBadge
                              label={videoAnalysisStatusMeta.label}
                              tone={videoAnalysisStatusMeta.tone}
                            />
                          </div>
                        }
                      />
                      {(selectedMaterial.framesExtracted ?? 0) > 0 ? (
                        <div className="vm-analysis-stats">
                          {selectedMaterial.videoAnalysisCompletedAt ? (
                            <div className="vm-detail-info-item">
                              <span>分析完成时间</span>
                              <strong>
                                {new Date(selectedMaterial.videoAnalysisCompletedAt).toLocaleString("zh-CN")}
                              </strong>
                            </div>
                          ) : null}
                          {analysisSummary ? (
                            <>
                              <div className="vm-detail-info-item">
                                <span>视频类型</span>
                                <strong>{analysisSummary.videoType}</strong>
                              </div>
                              <div className="vm-detail-info-item">
                                <span>核心主题</span>
                                <strong>{analysisSummary.theme}</strong>
                              </div>
                              <div className="vm-detail-info-item">
                                <span>镜头数量</span>
                                <strong>{analysisSummary.shotCount} 个</strong>
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="vm-content-card">
                        <div className="vm-content-card-head">
                          <strong>视频结构化分析</strong>
                          <span>
                            {selectedMaterial.videoAnalysis ? `${selectedMaterial.videoAnalysis.length} 字` : "待分析"}
                          </span>
                        </div>
                        <textarea
                          className="vm-content-textarea vm-analysis-textarea"
                          value={
                            selectedMaterial.videoAnalysis ? tryFormatAnalysisJson(selectedMaterial.videoAnalysis) : ""
                          }
                          readOnly
                          placeholder="视频分析完成后，这里会展示 GPT-4o 输出的结构化视频分析 JSON（包含镜头拆解、画面描述、构图信息等）。"
                        />
                      </div>
                    </section>
                  ) : null}

                  {/* Step 3/4: Generated Content */}
                  <section className="composer-card voice-section-card inner-card">
                    <ModuleTitle
                      title={isAutoAllMode ? "第四步：内容脚本与提示词生成" : "第三步：内容脚本与提示词"}
                      inner
                      level="secondary"
                      action={<ModuleStatusBadge label={contentStatusMeta.label} tone={contentStatusMeta.tone} />}
                    />
                    <p className="vm-detail-step-description">
                      {isAutoAllMode
                        ? "综合视频结构化分析与语音文稿，生成内容脚本、仅含结构/表达形式的「视频模板提示词」、可直接用于模型的生成提示词与字幕。"
                        : "基于原始文稿，由大模型自动整理出结构化内容脚本、反向提示词和字幕文本。"}
                    </p>
                    <div className="vm-generated-content-stack">
                      <div className="vm-content-card">
                        <div className="vm-content-card-head">
                          <strong>内容脚本</strong>
                          <span>
                            {selectedMaterial.contentScript ? `${selectedMaterial.contentScript.length} 字` : "待生成"}
                          </span>
                        </div>
                        <textarea
                          className="vm-content-textarea"
                          value={selectedMaterial.contentScript}
                          readOnly
                          placeholder={
                            isAutoAllMode
                              ? "视频分析与语音识别完成后，这里会展示综合生成的内容脚本。"
                              : "语音识别完成后，这里会展示整理后的内容脚本。"
                          }
                        />
                      </div>

                      {isAutoAllMode ? (
                        <div className="vm-content-card">
                          <div className="vm-content-card-head">
                            <strong>视频模板提示词</strong>
                            <span>
                              {selectedMaterial.videoTemplatePrompt
                                ? `${selectedMaterial.videoTemplatePrompt.length} 字`
                                : "待生成"}
                            </span>
                          </div>
                          <p className="vm-template-hint">
                            仅抽象叙事节奏、镜头语法、字幕/人声关系等形式框架，不含具体商品信息与台词，便于后续按同结构创作新片。
                          </p>
                          <textarea
                            className="vm-content-textarea"
                            value={selectedMaterial.videoTemplatePrompt ?? ""}
                            readOnly
                            placeholder="分析完成后，这里会展示脱敏后的表达框架说明（非 JSON）。"
                          />
                        </div>
                      ) : null}

                      <div className="vm-content-card">
                        <div className="vm-content-card-head">
                          <strong>{isAutoAllMode ? "视频生成提示词" : "反向提示词"}</strong>
                          <span>
                            {selectedMaterial.reversePrompt ? `${selectedMaterial.reversePrompt.length} 字` : "待生成"}
                          </span>
                        </div>
                        <textarea
                          className="vm-content-textarea"
                          value={selectedMaterial.reversePrompt}
                          readOnly
                          placeholder={
                            isAutoAllMode
                              ? "视频分析完成后，这里会展示可用于 Kling / Runway 等模型的生成提示词。"
                              : "语音识别完成后，这里会展示生成的反向提示词。"
                          }
                        />
                      </div>

                      <div className="vm-content-card">
                        <div className="vm-content-card-head">
                          <strong>字幕</strong>
                          <span>{selectedMaterial.subtitle ? `${selectedMaterial.subtitle.length} 字` : "待生成"}</span>
                        </div>
                        <textarea
                          className="vm-content-textarea"
                          value={selectedMaterial.subtitle}
                          readOnly
                          placeholder="处理完成后，这里会展示生成的字幕文本。"
                        />
                      </div>
                    </div>
                  </section>
                </div>
              )
            ) : (
              <div className="product-archive-empty">请先上传视频后，再查看拆解详情。</div>
            )}
          </section>
        </section>
      </section>
      <VideoMaterialImagePreviewModal
        title="抽帧图片预览"
        images={selectedMaterial?.extractedFrames ?? []}
        activeImageId={previewImageId}
        onClose={() => setPreviewImageId(null)}
        onChangeImage={setPreviewImageId}
      />
    </main>
  );
}
