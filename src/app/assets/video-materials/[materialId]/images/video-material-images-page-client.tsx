"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { VideoMaterialImageAsset, VideoMaterialRecord } from "../../../../../lib/video-material-types";
import { PageBrandTitle } from "../../../../_components/page-brand-title";
import { VideoMaterialImagePreviewModal } from "../../_components/video-material-image-preview-modal";

function formatFrameTimeLabel(timestampSeconds: number | null) {
  if (timestampSeconds == null || !Number.isFinite(timestampSeconds)) {
    return "";
  }
  return `${Math.max(0, timestampSeconds).toFixed(timestampSeconds >= 10 ? 0 : 1)}s`;
}

function toggleImageSelection(current: string[], imageId: string) {
  return current.includes(imageId) ? current.filter((item) => item !== imageId) : [...current, imageId];
}

function getImageCleaningBusyText(material: VideoMaterialRecord) {
  const job = material.imageCleaningJob;
  if (job.status !== "running" || job.totalCount <= 0) {
    return null;
  }

  const percent = Math.min(100, Math.round((job.processedCount / job.totalCount) * 100));
  const isCleaningAll =
    material.extractedFrames.length > 0 &&
    job.requestedImageIds.length === material.extractedFrames.length &&
    material.extractedFrames.every((image) => job.requestedImageIds.includes(image.imageId));
  const currentLabel = job.currentImageId
    ? (material.extractedFrames.find((image) => image.imageId === job.currentImageId)?.label ?? null)
    : null;
  const prefix = isCleaningAll ? "正在清洗全部抽帧图片…" : "正在清洗所选抽帧图片…";

  return currentLabel ? `${prefix} ${percent}%（当前：${currentLabel}）` : `${prefix} ${percent}%`;
}

function getImageCleaningFinishedText(material: VideoMaterialRecord) {
  const job = material.imageCleaningJob;
  if (job.totalCount <= 0) {
    return "图片清洗完成。";
  }

  const successCount = Math.max(0, job.processedCount - job.failedImageIds.length);
  if (job.failedImageIds.length > 0) {
    return `图片清洗完成，成功 ${successCount} 张，失败 ${job.failedImageIds.length} 张。`;
  }

  return `图片清洗完成，共清洗 ${successCount} 张。`;
}

async function downloadImageAsset(asset: VideoMaterialImageAsset) {
  const response = await fetch(asset.imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`图片下载失败（${asset.label}）`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = asset.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function VideoMaterialImageGridSection({
  title,
  images,
  selectedIds,
  actionButtons,
  busyText,
  onToggleSelection,
  onPreview,
}: {
  title: string;
  images: VideoMaterialImageAsset[];
  selectedIds: string[];
  actionButtons: Array<{
    key: string;
    label: string;
    disabled?: boolean;
    groupBreakAfter?: boolean;
    onClick: () => void;
  }>;
  busyText: string | null;
  onToggleSelection: (imageId: string) => void;
  onPreview: (imageId: string) => void;
}) {
  return (
    <section className="composer-card voice-section-card vm-image-list-section">
      <div className="vm-image-list-section-head">
        <div className="vm-image-list-section-title">
          <strong className="task-visual-section-title">{title}</strong>
          <span className="table-meta">{images.length} 张</span>
        </div>
        <div className="vm-image-list-section-actions">
          {actionButtons.map((button) => (
            <button
              key={button.key}
              className={`btn-pill${button.groupBreakAfter ? " vm-image-action-break" : ""}`}
              type="button"
              disabled={button.disabled || Boolean(busyText)}
              onClick={button.onClick}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>

      {busyText ? (
        <div className="vm-status-message">
          <span>{busyText}</span>
        </div>
      ) : null}

      <div className="vm-image-grid-scroll">
        {images.length ? (
          <div className="vm-image-grid">
            {images.map((image) => {
              const selected = selectedIds.includes(image.imageId);
              const timeLabel = formatFrameTimeLabel(image.timestampSeconds);
              return (
                <article key={image.imageId} className="task-visual-shot-strip-item vm-image-grid-item">
                  <div className="task-visual-shot-strip-media vm-image-grid-media">
                    <button className="vm-image-grid-preview" type="button" onClick={() => onPreview(image.imageId)}>
                      <Image src={image.imageUrl} alt={image.label} width={900} height={1350} unoptimized />
                    </button>
                    <button
                      className={`vm-image-select-toggle${selected ? " selected" : ""}`}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onToggleSelection(image.imageId)}
                    >
                      {selected ? "✓" : ""}
                    </button>
                  </div>
                  <span className="task-visual-shot-strip-label">
                    {timeLabel ? `${image.label} · ${timeLabel}` : image.label}
                  </span>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="task-visual-shot-candidate-empty vm-image-grid-empty">当前模块还没有图片。</div>
        )}
      </div>
    </section>
  );
}

export default function VideoMaterialImagesPageClient({ initialMaterial }: { initialMaterial: VideoMaterialRecord }) {
  const router = useRouter();
  const [material, setMaterial] = useState(initialMaterial);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedExtractedIds, setSelectedExtractedIds] = useState<string[]>([]);
  const [selectedCleanedIds, setSelectedCleanedIds] = useState<string[]>([]);
  const [activePreviewSection, setActivePreviewSection] = useState<"extracted" | "cleaned" | null>(null);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [deletingText, setDeletingText] = useState<string | null>(null);
  const [downloadingText, setDownloadingText] = useState<string | null>(null);
  const previousCleaningStatusRef = useRef(material.imageCleaningJob.status);

  const imageCleaningBusyText = useMemo(() => getImageCleaningBusyText(material), [material]);

  useEffect(() => {
    setSelectedExtractedIds((current) =>
      current.filter((imageId) => material.extractedFrames.some((image) => image.imageId === imageId)),
    );
    setSelectedCleanedIds((current) =>
      current.filter((imageId) => material.cleanedFrames.some((image) => image.imageId === imageId)),
    );
  }, [material]);

  useEffect(() => {
    if (!previewImageId || !activePreviewSection) {
      return;
    }
    const activeImages = activePreviewSection === "extracted" ? material.extractedFrames : material.cleanedFrames;
    if (!activeImages.some((image) => image.imageId === previewImageId)) {
      setPreviewImageId(null);
      setActivePreviewSection(null);
    }
  }, [activePreviewSection, material, previewImageId]);

  const previewImages = useMemo(
    () => (activePreviewSection === "cleaned" ? material.cleanedFrames : material.extractedFrames),
    [activePreviewSection, material.cleanedFrames, material.extractedFrames],
  );

  useEffect(() => {
    if (material.imageCleaningJob.status !== "running") {
      return;
    }

    let cancelled = false;

    const syncMaterial = async () => {
      try {
        const response = await fetch(`/api/video-materials/${material.materialId}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as {
          material?: VideoMaterialRecord;
        };
        if (!cancelled && response.ok && data.material) {
          setMaterial(data.material);
        }
      } catch {
        // best-effort polling
      }
    };

    void syncMaterial();
    const timer = window.setInterval(() => {
      void syncMaterial();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [material.imageCleaningJob.status, material.materialId]);

  useEffect(() => {
    const previousStatus = previousCleaningStatusRef.current;
    const currentStatus = material.imageCleaningJob.status;

    if (previousStatus === "running" && currentStatus === "completed") {
      setMessage(getImageCleaningFinishedText(material));
    } else if (previousStatus === "running" && currentStatus === "error") {
      setMessage(material.imageCleaningJob.message || "图片清洗失败。");
    }

    previousCleaningStatusRef.current = currentStatus;
  }, [material]);

  async function handleCleanFrames(scope: "selected" | "all") {
    const imageIds = scope === "all" ? material.extractedFrames.map((image) => image.imageId) : selectedExtractedIds;
    if (!imageIds.length) {
      setMessage("请先选择需要清洗的抽帧图片。");
      setSelectedExtractedIds([]);
      return;
    }

    setSelectedExtractedIds([]);
    setMessage(null);

    try {
      const response = await fetch(`/api/video-materials/${material.materialId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: scope === "all" ? "clean_all" : "clean_selected",
          imageIds: scope === "all" ? undefined : imageIds,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        material?: VideoMaterialRecord;
        warning?: string | null;
        error?: string;
      };
      if (!response.ok || !data.material) {
        throw new Error(data.error ?? "图片清洗失败");
      }

      setMaterial(data.material);
      if (data.warning) {
        setMessage(data.warning);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片清洗失败");
    }
  }

  async function handleDownloadFrames(scope: "selected" | "all", section: "extracted" | "cleaned") {
    const images = section === "extracted" ? material.extractedFrames : material.cleanedFrames;
    const selectedIds = section === "extracted" ? selectedExtractedIds : selectedCleanedIds;
    const targets = scope === "all" ? images : images.filter((image) => selectedIds.includes(image.imageId));

    if (!targets.length) {
      setMessage(section === "extracted" ? "请先选择要下载的抽帧图片。" : "请先选择要下载的清洗图片。");
      if (section === "extracted") {
        setSelectedExtractedIds([]);
      } else {
        setSelectedCleanedIds([]);
      }
      return;
    }

    if (section === "extracted") {
      setSelectedExtractedIds([]);
    } else {
      setSelectedCleanedIds([]);
    }

    setMessage(null);
    setDownloadingText(scope === "all" ? "正在准备全部下载…" : "正在准备所选下载…");

    try {
      for (const asset of targets) {
        await downloadImageAsset(asset);
      }
      setMessage(scope === "all" ? "图片已开始下载。" : "所选图片已开始下载。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片下载失败");
    } finally {
      setDownloadingText(null);
    }
  }

  async function handleDeleteCleanedFrames() {
    if (!selectedCleanedIds.length) {
      setMessage("请先选择要删除的清洗图片。");
      setSelectedCleanedIds([]);
      return;
    }

    const imageIds = [...selectedCleanedIds];
    setSelectedCleanedIds([]);
    setMessage(null);
    setDeletingText("正在删除所选图片…");

    try {
      const response = await fetch(`/api/video-materials/${material.materialId}/images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        material?: VideoMaterialRecord;
        error?: string;
      };
      if (!response.ok || !data.material) {
        throw new Error(data.error ?? "清洗图片删除失败");
      }

      setMaterial(data.material);
      setMessage("所选清洗图片已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清洗图片删除失败");
    } finally {
      setDeletingText(null);
    }
  }

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact vm-image-page-topbar">
              <div className="vm-image-page-title">
                <PageBrandTitle pageName="Image List" />
                <span className="table-meta">{`当前素材：${material.name || material.videoFileName || material.materialId}`}</span>
              </div>
            </div>
          </header>
        </section>

        <section className="voice-page-stack">
          {message ? <div className="notice-box">{message}</div> : null}

          <section className="composer-card voice-section-card product-archive-detail-card">
            <div className="vm-image-page-toolbar">
              <button
                className="btn-secondary small vm-image-page-back-btn"
                type="button"
                onClick={() => router.push(`/assets/video-materials?materialId=${material.materialId}`)}
              >
                返回上级页面
              </button>
              <span className="table-meta">{`${material.extractedFrames.length} 张抽帧 · ${material.cleanedFrames.length} 张清洗`}</span>
            </div>

            <div className="product-archive-detail-stack">
              <VideoMaterialImageGridSection
                title="抽帧图片展示"
                images={material.extractedFrames}
                selectedIds={selectedExtractedIds}
                busyText={imageCleaningBusyText || downloadingText}
                onToggleSelection={(imageId) =>
                  setSelectedExtractedIds((current) => toggleImageSelection(current, imageId))
                }
                onPreview={(imageId) => {
                  setActivePreviewSection("extracted");
                  setPreviewImageId(imageId);
                }}
                actionButtons={[
                  {
                    key: "clean-selected",
                    label: "清洗所选图片",
                    disabled: !selectedExtractedIds.length || !material.extractedFrames.length,
                    onClick: () => void handleCleanFrames("selected"),
                  },
                  {
                    key: "clean-all",
                    label: "全部清洗",
                    disabled: !material.extractedFrames.length,
                    groupBreakAfter: true,
                    onClick: () => void handleCleanFrames("all"),
                  },
                  {
                    key: "download-selected",
                    label: "下载所选图片",
                    disabled: !selectedExtractedIds.length || !material.extractedFrames.length,
                    onClick: () => void handleDownloadFrames("selected", "extracted"),
                  },
                  {
                    key: "download-all",
                    label: "全部下载",
                    disabled: !material.extractedFrames.length,
                    onClick: () => void handleDownloadFrames("all", "extracted"),
                  },
                ]}
              />

              <VideoMaterialImageGridSection
                title="清洗图片展示"
                images={material.cleanedFrames}
                selectedIds={selectedCleanedIds}
                busyText={deletingText || downloadingText}
                onToggleSelection={(imageId) =>
                  setSelectedCleanedIds((current) => toggleImageSelection(current, imageId))
                }
                onPreview={(imageId) => {
                  setActivePreviewSection("cleaned");
                  setPreviewImageId(imageId);
                }}
                actionButtons={[
                  {
                    key: "delete-selected",
                    label: "删除所选图片",
                    disabled: !selectedCleanedIds.length || !material.cleanedFrames.length,
                    onClick: () => void handleDeleteCleanedFrames(),
                  },
                  {
                    key: "download-selected",
                    label: "下载所选图片",
                    disabled: !selectedCleanedIds.length || !material.cleanedFrames.length,
                    onClick: () => void handleDownloadFrames("selected", "cleaned"),
                  },
                  {
                    key: "download-all",
                    label: "全部下载",
                    disabled: !material.cleanedFrames.length,
                    onClick: () => void handleDownloadFrames("all", "cleaned"),
                  },
                ]}
              />
            </div>
          </section>
        </section>
      </section>

      <VideoMaterialImagePreviewModal
        title={activePreviewSection === "cleaned" ? "清洗图片展示" : "抽帧图片展示"}
        images={previewImages}
        activeImageId={previewImageId}
        onClose={() => {
          setPreviewImageId(null);
          setActivePreviewSection(null);
        }}
        onChangeImage={setPreviewImageId}
      />
    </main>
  );
}
