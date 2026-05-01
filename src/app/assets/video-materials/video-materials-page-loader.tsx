"use client";

import dynamic from "next/dynamic";

import { RouteLoadingShell } from "../../_components/route-loading-shell";
import { useDeferredRouteReady } from "../../_components/use-deferred-route-ready";
import type { VideoMaterialsPayload } from "./video-materials-page-client";

function VideoMaterialsFallback() {
  return (
    <RouteLoadingShell pageName="Video Breakdown" title="上传视频后" description="正在加载视频拆解记录和模式选择。" />
  );
}

const VideoMaterialsPageClient = dynamic(() => import("./video-materials-page-client"), {
  ssr: false,
  loading: () => <VideoMaterialsFallback />,
});

export function VideoMaterialsPageLoader({ initialData }: { initialData: VideoMaterialsPayload }) {
  const ready = useDeferredRouteReady("video-materials");
  if (!ready) {
    return <VideoMaterialsFallback />;
  }

  return <VideoMaterialsPageClient initialData={initialData} deferInitialLoad />;
}
