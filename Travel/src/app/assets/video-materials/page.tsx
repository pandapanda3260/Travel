"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import { ModuleStatusBadge, ModuleTitle } from "../../studio/task-creation/_components/task-ui";

type ProcessingMode = "auto_all" | "audio_only";

type VideoMaterialRecord = {
  materialId: string;
  name: string;
  status: "uploading" | "converting" | "transcribing" | "analyzing" | "generating" | "ready" | "error";
  statusMessage: string;
  processingMode: ProcessingMode;
  videoFileName: string | null;
  videoFileUrl: string | null;
  videoUploadedAt: string | null;
  audioFileName: string | null;
  audioFileUrl: string | null;
  audioConvertedAt: string | null;
  framesExtracted: number;
  videoAnalysis: string;
  videoAnalysisCompletedAt: string | null;
  rawTranscript: string;
  contentScript: string;
  videoTemplatePrompt: string;
  reversePrompt: string;
  subtitle: string;
  createdAt: string;
  updatedAt: string;
};

type VideoMaterialsPayload = {
  materials: VideoMaterialRecord[];
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

function sortMaterialsByCreatedAtDesc(materials: VideoMaterialRecord[]) {
  return [...materials].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function getDisplayMaterialName(record: VideoMaterialRecord): string {
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

export default function VideoMaterialsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [materials, setMaterials] = useState<VideoMaterialRecord[]>([]);
  const [runtime, setRuntime] = useState<VideoMaterialsPayload["runtime"] | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [deletingMaterialId, setDeletingMaterialId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const [processingMode, setProcessingMode] = useState<ProcessingMode>("auto_all");
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const selectedMaterial =
    materials.find((m) => m.materialId === selectedMaterialId) ?? materials[0] ?? null;

  const hasProcessingMaterials = useMemo(
    () => materials.some((m) => m.status !== "ready" && m.status !== "error"),
    [materials],
  );

  useEffect(() => {
    const loadPageData = async () => {
      setLoadingStatus("loading");
      try {
        const response = await fetch("/api/video-materials", { cache: "no-store" });
        const data = (await response.json()) as VideoMaterialsPayload;
        if (!response.ok) {
          throw new Error(data.error ?? "视频拆解页面加载失败");
        }
        setMaterials(sortMaterialsByCreatedAtDesc(data.materials ?? []));
        setRuntime(data.runtime ?? null);
        setLoadingStatus("success");
      } catch (loadError) {
        setLoadingStatus("error");
        setError(loadError instanceof Error ? loadError.message : "视频拆解页面加载失败");
      }
    };
    void loadPageData();
  }, []);

  useEffect(() => {
    if (!materials.length) {
      setSelectedMaterialId("");
      return;
    }
    setSelectedMaterialId((current) =>
      current && materials.some((m) => m.materialId === current)
        ? current
        : materials[0].materialId,
    );
  }, [materials]);

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
          setMaterials(sortMaterialsByCreatedAtDesc(data.materials));
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
              ? [{
                  label: "视觉分析",
                  value: runtime ? `${runtime.visionProviderLabel}` : "未加载",
                }]
              : []),
          ]
        : [],
    [runtime, selectedMaterial],
  );

  const baseInfoStatusMeta = getMaterialModuleStatusMeta({
    hasMaterial: Boolean(selectedMaterial),
    status: selectedMaterial?.status,
    isBusy: isUploading,
  });

  const transcriptStatusMeta = getMaterialModuleStatusMeta({
    hasMaterial: Boolean(selectedMaterial),
    status: selectedMaterial?.rawTranscript ? "ready" : selectedMaterial?.status,
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

  const handleUploadVideo = useCallback(async (file: File) => {
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
        sortMaterialsByCreatedAtDesc([
          newMaterial,
          ...current.filter((m) => m.materialId !== newMaterial.materialId),
        ]),
      );
      setSelectedMaterialId(newMaterial.materialId);

      const formData = new FormData();
      formData.set("file", file);
      formData.set("processingMode", processingMode);
      const uploadResponse = await fetch(
        `/api/video-materials/${newMaterial.materialId}`,
        { method: "POST", body: formData },
      );
      const uploadData = (await uploadResponse.json()) as {
        material?: VideoMaterialRecord;
        error?: string;
      };
      if (!uploadResponse.ok || !uploadData.material) {
        throw new Error(uploadData.error ?? "视频上传失败");
      }

      setMaterials((current) =>
        sortMaterialsByCreatedAtDesc(
          current.map((m) =>
            m.materialId === uploadData.material!.materialId ? uploadData.material! : m,
          ),
        ),
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "视频上传失败");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [processingMode]);

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
        body: JSON.stringify({ processingMode }),
      });
      const data = (await response.json()) as {
        material?: VideoMaterialRecord;
        error?: string;
      };
      if (!response.ok || !data.material) {
        throw new Error(data.error ?? "重新处理失败");
      }
      setMaterials((current) =>
        sortMaterialsByCreatedAtDesc(
          current.map((m) =>
            m.materialId === data.material!.materialId ? data.material! : m,
          ),
        ),
      );
    } catch (reprocessError) {
      setError(reprocessError instanceof Error ? reprocessError.message : "重新处理失败");
    } finally {
      setIsReprocessing(false);
    }
  }

  const isAutoAllMode = (selectedMaterial?.processingMode ?? "auto_all") !== "audio_only";
  const analysisSummary = selectedMaterial?.videoAnalysis
    ? getAnalysisSummary(selectedMaterial.videoAnalysis)
    : null;
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
              <div className="topbar-title brand-inline">
                <div className="brand-mark">AI</div>
                <div className="brand-name-row">
                  <h2>Hospitality AI Studio</h2>
                </div>
              </div>
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
                          <span className="vm-mode-option-check">
                            {processingMode === option.value ? "✓" : ""}
                          </span>
                          <span className="vm-mode-option-content">
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button className="toolbar-button" type="button">使用说明</button>
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
              <span className="task-workbench-create-btn-text">
                {isUploading ? "上传中…" : "上传新的视频"}
              </span>
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
                          className={
                            material.materialId === selectedMaterial?.materialId
                              ? "task-table-row-active"
                              : ""
                          }
                        >
                          <td>{material.materialId.slice(0, 8)}...</td>
                          <td className="task-name-cell">
                            {getDisplayMaterialName(material)}
                          </td>
                          <td>
                            <span className="table-meta vm-mode-badge">
                              {getProcessingModeLabel(material.processingMode ?? "auto_all")}
                            </span>
                          </td>
                          <td>
                            <span className={`table-status ${statusMeta.className}`.trim()}>
                              {statusMeta.label}
                            </span>
                          </td>
                          <td className="submitted-time-cell">
                            {material.videoUploadedAt ? (
                              <>
                                <span>
                                  {new Date(material.videoUploadedAt).toLocaleDateString("zh-CN")}
                                </span>
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
                    {selectedMaterial
                      ? `当前素材：${getDisplayMaterialName(selectedMaterial)}`
                      : "未选择"}
                  </span>
                }
              />

              <div className="result-layout equal-height-columns product-archive-preview-layout">
                <div className="video-frame product-archive-effect-frame vm-preview-video-frame">
                  {selectedMaterial?.videoFileUrl ? (
                    <video
                      key={selectedMaterial.videoFileUrl}
                      src={selectedMaterial.videoFileUrl}
                      controls
                      preload="metadata"
                      className="vm-preview-player"
                    />
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
                  <span className="table-meta">
                    {selectedMaterial
                      ? `${selectedMaterial.materialId.slice(0, 8)} · ${getMaterialListStatusMeta(selectedMaterial.status).label} · ${getProcessingModeLabel(selectedMaterial.processingMode ?? "auto_all")}`
                      : "未选择"}
                  </span>
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
              <div className="product-archive-detail-stack">
                {/* Step 1: Upload & Audio Conversion */}
                <section className="composer-card voice-section-card inner-card">
                  <ModuleTitle
                    title="第一步：视频上传与音频提取"
                    inner
                    level="secondary"
                    action={
                      <ModuleStatusBadge
                        label={baseInfoStatusMeta.label}
                        tone={baseInfoStatusMeta.tone}
                      />
                    }
                  />
                  <p className="vm-detail-step-description">
                    上传视频后系统自动提取音频轨道，为后续语音识别提供输入源。
                  </p>
                  <div className="vm-detail-info-grid">
                    <div className="vm-detail-info-item">
                      <span>视频文件</span>
                      <strong>
                        {selectedMaterial.videoFileName ?? "未上传"}
                      </strong>
                    </div>
                    <div className="vm-detail-info-item">
                      <span>音频文件</span>
                      <strong>
                        {selectedMaterial.audioFileName ?? "未生成"}
                      </strong>
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
                  {selectedMaterial.statusMessage ? (
                    <div className="vm-status-message">
                      <span>{selectedMaterial.statusMessage}</span>
                    </div>
                  ) : null}
                </section>

                {/* Step 2: Raw Transcript */}
                <section className="composer-card voice-section-card inner-card">
                  <ModuleTitle
                    title="第二步：语音识别原始文稿"
                    inner
                    level="secondary"
                    action={
                      <ModuleStatusBadge
                        label={transcriptStatusMeta.label}
                        tone={transcriptStatusMeta.tone}
                      />
                    }
                  />
                  <p className="vm-detail-step-description">
                    通过火山方舟 Doubao-录音文件识别2.0 自动识别音频中的语音内容。
                  </p>
                  <div className="vm-content-card">
                    <div className="vm-content-card-head">
                      <strong>原始文稿</strong>
                      <span>{selectedMaterial.rawTranscript ? `${selectedMaterial.rawTranscript.length} 字` : "待生成"}</span>
                    </div>
                    <textarea
                      className="vm-content-textarea"
                      value={selectedMaterial.rawTranscript}
                      readOnly
                      placeholder="视频上传处理完成后，这里会展示语音识别的原始文稿。"
                    />
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
                        <ModuleStatusBadge
                          label={videoAnalysisStatusMeta.label}
                          tone={videoAnalysisStatusMeta.tone}
                        />
                      }
                    />
                    <p className="vm-detail-step-description">
                      通过 GPT-4o 视觉模型逐帧分析视频内容，输出结构化的镜头拆解、画面描述、构图与运动信息，用于后续视频生成。
                    </p>

                    {(selectedMaterial.framesExtracted ?? 0) > 0 ? (
                      <div className="vm-analysis-stats">
                        <div className="vm-detail-info-item">
                          <span>提取帧数</span>
                          <strong>{selectedMaterial.framesExtracted} 帧</strong>
                        </div>
                        {selectedMaterial.videoAnalysisCompletedAt ? (
                          <div className="vm-detail-info-item">
                            <span>分析完成时间</span>
                            <strong>{new Date(selectedMaterial.videoAnalysisCompletedAt).toLocaleString("zh-CN")}</strong>
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
                          {selectedMaterial.videoAnalysis
                            ? `${selectedMaterial.videoAnalysis.length} 字`
                            : "待分析"}
                        </span>
                      </div>
                      <textarea
                        className="vm-content-textarea vm-analysis-textarea"
                        value={
                          selectedMaterial.videoAnalysis
                            ? tryFormatAnalysisJson(selectedMaterial.videoAnalysis)
                            : ""
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
                    action={
                      <ModuleStatusBadge
                        label={contentStatusMeta.label}
                        tone={contentStatusMeta.tone}
                      />
                    }
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
                        <span>{selectedMaterial.contentScript ? `${selectedMaterial.contentScript.length} 字` : "待生成"}</span>
                      </div>
                      <textarea
                        className="vm-content-textarea"
                        value={selectedMaterial.contentScript}
                        readOnly
                        placeholder={isAutoAllMode
                          ? "视频分析与语音识别完成后，这里会展示综合生成的内容脚本。"
                          : "语音识别完成后，这里会展示整理后的内容脚本。"}
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
                        <span>{selectedMaterial.reversePrompt ? `${selectedMaterial.reversePrompt.length} 字` : "待生成"}</span>
                      </div>
                      <textarea
                        className="vm-content-textarea"
                        value={selectedMaterial.reversePrompt}
                        readOnly
                        placeholder={isAutoAllMode
                          ? "视频分析完成后，这里会展示可用于 Kling / Runway 等模型的生成提示词。"
                          : "语音识别完成后，这里会展示生成的反向提示词。"}
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
            ) : (
              <div className="product-archive-empty">
                请先上传视频后，再查看拆解详情。
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
