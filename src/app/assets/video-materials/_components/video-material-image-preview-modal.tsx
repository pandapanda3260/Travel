"use client";

import Image from "next/image";

import type { VideoMaterialImageAsset } from "../../../../lib/video-material-types";

export function VideoMaterialImagePreviewModal({
  title,
  images,
  activeImageId,
  onClose,
  onChangeImage,
}: {
  title: string;
  images: VideoMaterialImageAsset[];
  activeImageId: string | null;
  onClose: () => void;
  onChangeImage: (imageId: string) => void;
}) {
  if (!activeImageId) {
    return null;
  }

  const currentIndex = images.findIndex((image) => image.imageId === activeImageId);
  if (currentIndex < 0) {
    return null;
  }

  const currentImage = images[currentIndex];
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-panel image-preview-panel vm-image-preview-panel"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            <p className="modal-head-subtitle">{`第 ${currentIndex + 1} / ${images.length} 张 · ${currentImage.label}`}</p>
          </div>
          <button className="btn-secondary small" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body image-preview-body">
          <div className="image-preview-stage vm-image-preview-stage">
            <button
              className="image-preview-nav image-preview-nav-prev"
              type="button"
              disabled={!hasPrevious}
              aria-label="上一张图片"
              onClick={() => hasPrevious && onChangeImage(images[currentIndex - 1].imageId)}
            >
              {"<"}
            </button>
            <div className="image-preview-canvas vm-image-preview-canvas">
              <Image
                className="vm-image-preview-image"
                src={currentImage.imageUrl}
                alt={currentImage.label}
                width={currentImage.width ?? 1600}
                height={currentImage.height ?? 1600}
                unoptimized
              />
            </div>
            <button
              className="image-preview-nav image-preview-nav-next"
              type="button"
              disabled={!hasNext}
              aria-label="下一张图片"
              onClick={() => hasNext && onChangeImage(images[currentIndex + 1].imageId)}
            >
              {">"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
