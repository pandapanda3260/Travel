"use client";

import dynamic from "next/dynamic";

import { RouteLoadingShell } from "../../_components/route-loading-shell";
import { useDeferredRouteReady } from "../../_components/use-deferred-route-ready";

function VideoGenerationFallback() {
  return (
    <RouteLoadingShell pageName="快速生成" title="快速生成流水线" description="正在加载生成记录和当前任务状态。" />
  );
}

const VideoGenerationPageClient = dynamic(() => import("./video-generation-page-client"), {
  ssr: false,
  loading: () => <VideoGenerationFallback />,
});

export function VideoGenerationPageLoader() {
  const ready = useDeferredRouteReady("video-generation");
  if (!ready) {
    return <VideoGenerationFallback />;
  }

  return <VideoGenerationPageClient />;
}
