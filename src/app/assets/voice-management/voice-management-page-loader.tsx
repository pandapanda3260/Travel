"use client";

import dynamic from "next/dynamic";

import { RouteLoadingShell } from "../../_components/route-loading-shell";
import { useDeferredRouteReady } from "../../_components/use-deferred-route-ready";
import type { VoiceManagementInitialData } from "./voice-management-page-client";

function VoiceManagementFallback() {
  return (
    <RouteLoadingShell pageName="Voice Management" title="浏览音色广场" description="正在加载收藏音色，稍后可点击复刻声音。" />
  );
}

const VoiceManagementPageClient = dynamic(() => import("./voice-management-page-client"), {
  ssr: false,
  loading: () => <VoiceManagementFallback />,
});

export function VoiceManagementPageLoader({
  initialData,
  initialError,
}: {
  initialData: VoiceManagementInitialData;
  initialError?: string | null;
}) {
  const ready = useDeferredRouteReady("voice-management");
  if (!ready) {
    return <VoiceManagementFallback />;
  }

  return <VoiceManagementPageClient initialData={initialData} initialError={initialError} />;
}
