import "../../video-materials.css";

import { notFound } from "next/navigation";

import { requireUserPageSession } from "../../../../../lib/auth-session";
import { ensurePendingVideoMaterialImageCleaning } from "../../../../../lib/video-material-image-clean-runner";
import { getVideoMaterial } from "../../../../../lib/video-material-store";
import VideoMaterialImagesPageClient from "./video-material-images-page-client";

type PageProps = {
  params: Promise<{ materialId: string }>;
};

export default async function VideoMaterialImagesPage({ params }: PageProps) {
  const session = await requireUserPageSession();
  const { materialId } = await params;
  let material = getVideoMaterial(materialId);

  if (!material) {
    notFound();
  }

  if (material.ownerUserId && material.ownerUserId !== session.userId) {
    notFound();
  }

  ensurePendingVideoMaterialImageCleaning(materialId);
  material = getVideoMaterial(materialId) ?? material;

  return <VideoMaterialImagesPageClient initialMaterial={material} />;
}
