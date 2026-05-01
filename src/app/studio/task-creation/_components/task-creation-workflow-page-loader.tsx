"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { RouteLoadingShell } from "../../../_components/route-loading-shell";
import { useDeferredRouteReady } from "../../../_components/use-deferred-route-ready";
import type { TaskCreationWorkflowMode } from "../../../../lib/task-creation-workflow-mode";

function TaskCreationWorkflowFallback() {
  return (
    <RouteLoadingShell pageName="任务创建" title="创建新的任务" description="正在加载任务工作台和任务索引。" />
  );
}

const TaskCreationWorkflowPage = dynamic(
  () => import("./task-creation-workflow-page").then((module) => module.TaskCreationWorkflowPage),
  {
    ssr: false,
    loading: () => <TaskCreationWorkflowFallback />,
  },
);

function getWorkflowModeFromPathname(pathname: string | null): TaskCreationWorkflowMode | null {
  if (pathname === "/studio/task-creation/real-photo-video") {
    return "real_photo_to_video";
  }
  if (pathname === "/studio/task-creation/ai-image-video") {
    return "ai_image_to_video";
  }
  return null;
}

export function TaskCreationWorkflowPageLoader({ workflowMode }: { workflowMode: TaskCreationWorkflowMode }) {
  const pathname = usePathname();
  const [softPathname, setSoftPathname] = useState<string | null>(null);
  const resolvedWorkflowMode = getWorkflowModeFromPathname(softPathname ?? pathname) ?? workflowMode;
  const ready = useDeferredRouteReady(resolvedWorkflowMode);

  useEffect(() => {
    function handleSoftModeChange(event: Event) {
      const href =
        event instanceof CustomEvent && typeof event.detail?.href === "string" ? event.detail.href : window.location.href;
      setSoftPathname(new URL(href, window.location.href).pathname);
    }

    function handlePopState() {
      setSoftPathname(window.location.pathname);
    }

    window.addEventListener("travel:task-creation-mode-change", handleSoftModeChange);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("travel:task-creation-mode-change", handleSoftModeChange);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  if (!ready) {
    return <TaskCreationWorkflowFallback />;
  }

  return <TaskCreationWorkflowPage workflowMode={resolvedWorkflowMode} />;
}
