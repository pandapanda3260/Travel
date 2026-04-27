"use client";

import { Download, Play, RotateCw, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageBrandTitle } from "../../_components/page-brand-title";
import { useVideoTimecode } from "../../_components/use-video-timecode";
import { ModuleTitle, TaskNextStepButton, type TaskStepActionState } from "../task-creation/_components/task-ui";
import { formatDirectorVideoGenerationError } from "../../../lib/director-video-generation-errors";

type StepStatus = "idle" | "running" | "success" | "failed";

type ImageCandidate = {
  candidateId: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  createdAt: string;
};

type VideoGenerationSession = {
  sessionId: string;
  title: string;
  originalPrompt: string;
  modificationInstruction: string;
  optimizedPrompt: string;
  videoOriginalPrompt: string;
  videoModificationInstruction: string;
  videoOptimizedPrompt: string;
  imagePrompt: string;
  videoPrompt: string;
  promptStatus: StepStatus;
  videoPromptStatus: StepStatus;
  imageStatus: StepStatus;
  videoStatus: StepStatus;
  promptError: string | null;
  videoPromptError: string | null;
  imageError: string | null;
  videoError: string | null;
  imageSettings: {
    size: string;
    guidanceScale: number;
    watermark: boolean;
    seed: number | null;
    outputCount: number;
  };
  videoSettings: {
    durationSeconds: number;
    ratio: "16:9" | "9:16" | "1:1";
    resolution: string;
    generateAudio: boolean;
    watermark: boolean;
  };
  imageCandidates: ImageCandidate[];
  selectedImageCandidateId: string | null;
  videoJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

type VideoJob = {
  jobId: string;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  videoUrl: string | null;
  remoteVideoUrl: string | null;
  error: string | null;
  modelId: string | null;
  submittedAt: string;
  updatedAt: string;
};

type SessionResponse = {
  session?: VideoGenerationSession | null;
  sessions?: VideoGenerationSession[];
  videoJob?: VideoJob | null;
  error?: string;
};

const statusLabelMap: Record<StepStatus, string> = {
  idle: "待处理",
  running: "进行中",
  success: "已完成",
  failed: "失败",
};

function getStatusTone(status: StepStatus) {
  if (status === "success") return "created";
  if (status === "running") return "editing";
  return "idle";
}

function pickVideoUrl(job: VideoJob | null) {
  return job?.videoUrl ?? job?.remoteVideoUrl ?? null;
}

function isVideoJobRunning(job: VideoJob | null) {
  return job?.status === "QUEUED" || job?.status === "IN_PROGRESS";
}

function getElapsedMs(timestamp: string | null | undefined, nowMs: number) {
  if (!timestamp) {
    return 0;
  }
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && value > 0 ? Math.max(0, nowMs - value) : 0;
}

function getTimedStageRatio(elapsedMs: number, estimateMs: number, cap = 0.96) {
  return Math.min(Math.max(0, elapsedMs) / Math.max(1_000, estimateMs), cap);
}

function getVideoJobEstimateMs(durationSeconds: number) {
  return 18_000 + Math.max(0, durationSeconds) * 3_600;
}

function getVideoGenerationProgressPercent(job: VideoJob | null, nowMs: number, durationSeconds: number) {
  if (!job) {
    return 0;
  }
  const elapsedMs = getElapsedMs(job.status === "IN_PROGRESS" ? job.updatedAt : job.submittedAt, nowMs);
  if (job.status === "QUEUED") {
    return Math.round((0.04 + 0.08 * getTimedStageRatio(elapsedMs, 8_000)) * 100);
  }
  if (job.status === "IN_PROGRESS") {
    return Math.round((0.14 + 0.58 * getTimedStageRatio(elapsedMs, getVideoJobEstimateMs(durationSeconds))) * 100);
  }
  return 0;
}

function toCssAspectRatio(aspectRatio: "16:9" | "9:16" | "1:1" | null | undefined) {
  switch (aspectRatio) {
    case "16:9":
      return "16 / 9";
    case "1:1":
      return "1 / 1";
    case "9:16":
    default:
      return "9 / 16";
  }
}

function getVideoDownloadFileName(title: string | undefined, jobId: string | null | undefined) {
  const safeTitle = (title || "快速生成").replace(/[\\/:*?"<>|]+/g, "-").trim() || "快速生成";
  const suffix = jobId ? `-${jobId.slice(0, 8)}` : "";
  return `${safeTitle}${suffix}.mp4`;
}

function getImageDownloadFileName(title: string | undefined, candidate: ImageCandidate, index: number) {
  const safeTitle = (title || "快速生成图片").replace(/[\\/:*?"<>|]+/g, "-").trim() || "快速生成图片";
  const extension = candidate.imageUrl.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
  return `${safeTitle}-${String(index + 1).padStart(2, "0")}.${extension}`;
}

function getDisplaySessionTitle(title: string) {
  const value = title.trim() || "快速生成";
  const characters = Array.from(value);
  return characters.length > 8 ? `${characters.slice(0, 8).join("")}…` : value;
}

function getSessionStatusMeta(session: VideoGenerationSession) {
  if (session.videoStatus === "success") {
    return { label: "生成完成", tone: "default" as const };
  }
  if (session.videoStatus === "running") {
    return { label: "视频生成中", tone: "pending" as const };
  }
  if (session.videoStatus === "failed") {
    return { label: "视频失败", tone: "warning" as const };
  }
  if (session.imageStatus === "success") {
    return { label: "已出图", tone: "default" as const };
  }
  if (session.imageStatus === "running") {
    return { label: "图片生成中", tone: "pending" as const };
  }
  if (session.imageStatus === "failed") {
    return { label: "图片失败", tone: "warning" as const };
  }
  if (session.promptStatus === "success" || session.videoPromptStatus === "success") {
    return { label: "提示词完成", tone: "default" as const };
  }
  return { label: "待处理", tone: "pending" as const };
}

function getVideoStorageLabel(videoUrl: string | null) {
  if (!videoUrl) {
    return "待生成";
  }
  return videoUrl.startsWith("/") ? "本地保存" : "已生成";
}

function PromptOptimizationModule({
  title,
  originalValue,
  modificationValue,
  resultValue,
  status,
  error,
  busy,
  disabled,
  onOriginalChange,
  onModificationChange,
  onResultChange,
  onOptimize,
}: {
  title: string;
  originalValue: string;
  modificationValue: string;
  resultValue: string;
  status: StepStatus;
  error: string | null;
  busy: boolean;
  disabled: boolean;
  onOriginalChange: (value: string) => void;
  onModificationChange: (value: string) => void;
  onResultChange: (value: string) => void;
  onOptimize: () => void;
}) {
  const canOptimize = Boolean(originalValue.trim() || modificationValue.trim());

  return (
    <section className="director-video-prompt-module">
      <div className="director-video-prompt-module-head">
        <strong>{title}</strong>
        <span className={`table-status task-module-status ${getStatusTone(status)}`}>{statusLabelMap[status]}</span>
      </div>
      <label className="setting-field wide">
        <span>原始提示词</span>
        <textarea
          className="prompt-box director-video-textarea"
          value={originalValue}
          placeholder="输入原始提示词"
          onChange={(event) => onOriginalChange(event.target.value)}
        />
      </label>
      <label className="setting-field wide">
        <span>修改要求</span>
        <textarea
          className="prompt-box director-video-textarea director-video-modification-textarea"
          value={modificationValue}
          placeholder="输入修改要求"
          onChange={(event) => onModificationChange(event.target.value)}
        />
      </label>
      <label className="setting-field wide">
        <span>优化后提示词</span>
        <textarea
          className="prompt-box director-video-prompt-result"
          value={resultValue}
          placeholder="优化结果"
          onChange={(event) => onResultChange(event.target.value)}
        />
      </label>
      {error ? <p className="director-video-inline-error">{error}</p> : null}
      <div className="director-video-actions">
        <button className="btn-primary" type="button" disabled={disabled || busy || !canOptimize} onClick={onOptimize}>
          {busy ? "优化中..." : "优化提示词"}
        </button>
      </div>
    </section>
  );
}

export default function DirectorVideoGenerationPage() {
  const [sessions, setSessions] = useState<VideoGenerationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<
    "create" | "imagePrompt" | "videoPrompt" | "image" | "video" | "select" | "delete" | null
  >(null);
  const [candidateBusyState, setCandidateBusyState] = useState<{
    candidateId: string;
    action: "delete" | "regenerate";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewCandidateId, setPreviewCandidateId] = useState("");
  const [failedImageCandidateIds, setFailedImageCandidateIds] = useState<Set<string>>(() => new Set());
  const [videoProgressClockMs, setVideoProgressClockMs] = useState(() => Date.now());
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? sessions[0] ?? null,
    [activeSessionId, sessions],
  );
  const selectedImage = useMemo(() => {
    if (!activeSession) return null;
    return (
      activeSession.imageCandidates.find(
        (candidate) =>
          candidate.candidateId === activeSession.selectedImageCandidateId &&
          !failedImageCandidateIds.has(candidate.candidateId),
      ) ??
      activeSession.imageCandidates.find((candidate) => !failedImageCandidateIds.has(candidate.candidateId)) ??
      null
    );
  }, [activeSession, failedImageCandidateIds]);
  const imageGenerationPrompt = activeSession
    ? activeSession.imagePrompt.trim() || activeSession.optimizedPrompt.trim() || activeSession.originalPrompt.trim()
    : "";
  const previewCandidateIndex = useMemo(() => {
    if (!activeSession || !previewCandidateId) {
      return -1;
    }
    return activeSession.imageCandidates.findIndex((candidate) => candidate.candidateId === previewCandidateId);
  }, [activeSession, previewCandidateId]);
  const previewCandidate =
    activeSession && previewCandidateIndex >= 0 ? activeSession.imageCandidates[previewCandidateIndex] : null;
  const previewHasPrevious = previewCandidateIndex > 0;
  const previewHasNext =
    activeSession !== null && previewCandidateIndex >= 0 && previewCandidateIndex < activeSession.imageCandidates.length - 1;
  const previewIsSelected = Boolean(
    activeSession && previewCandidate && activeSession.selectedImageCandidateId === previewCandidate.candidateId,
  );
  const previewCandidateUnavailable = previewCandidate
    ? failedImageCandidateIds.has(previewCandidate.candidateId)
    : false;
  const playableVideoUrl = pickVideoUrl(videoJob);
  const videoDownloadFileName = getVideoDownloadFileName(activeSession?.title, videoJob?.jobId);
  const videoTimecode = useVideoTimecode(playableVideoUrl);
  const activePreviewTimecode = useVideoTimecode(playableVideoUrl);
  const activeVideoPromptLength = activeSession?.videoPrompt.trim().length ?? 0;
  const activeVideoParameters = useMemo(
    () =>
      activeSession
        ? [
            { label: "时长", value: `${activeSession.videoSettings.durationSeconds} 秒` },
            { label: "存储", value: getVideoStorageLabel(playableVideoUrl) },
            {
              label: "比例",
              value: `${activeSession.videoSettings.ratio} ${
                activeSession.videoSettings.ratio === "9:16"
                  ? "竖版"
                  : activeSession.videoSettings.ratio === "16:9"
                    ? "横版"
                    : "方版"
              }`,
            },
            { label: "原生音频", value: activeSession.videoSettings.generateAudio ? "开启" : "关闭" },
            { label: "Prompt", value: `${activeVideoPromptLength} 字` },
          ]
        : [],
    [activeSession, activeVideoPromptLength, playableVideoUrl],
  );
  const videoJobRunning = isVideoJobRunning(videoJob);
  const videoActionRunning = busyAction === "video" || videoJobRunning || activeSession?.videoStatus === "running";
  const videoActionBlockedReason = !selectedImage
    ? "请先选择图片。"
    : !activeSession?.videoPrompt.trim()
      ? "请先填写视频提示词。"
      : null;
  const videoActionLabel = videoActionRunning
    ? videoJob?.status === "IN_PROGRESS"
      ? "片段生成中（1/1）"
      : videoJob?.status === "QUEUED"
        ? "排队处理中（1/1）"
        : busyAction === "video"
          ? "生成中..."
          : "正在生成视频片段..."
    : activeSession?.videoJobId
      ? "重新生成视频"
      : "生成视频";
  const videoActionProgressPercent = videoActionRunning
    ? getVideoGenerationProgressPercent(videoJob, videoProgressClockMs, activeSession?.videoSettings.durationSeconds ?? 5)
    : null;
  const videoActionState: TaskStepActionState = {
    label: videoActionLabel,
    isRunning: videoActionRunning,
    progressPercent: videoActionProgressPercent,
    canRun: !videoActionBlockedReason,
    blockedReason: videoActionBlockedReason,
    onAction: () => {
      void generateVideo();
    },
  };

  const upsertSession = useCallback((nextSession: VideoGenerationSession) => {
    setSessions((current) => {
      const index = current.findIndex((item) => item.sessionId === nextSession.sessionId);
      if (index < 0) {
        return [nextSession, ...current];
      }
      const next = [...current];
      next[index] = nextSession;
      return next.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    });
    setActiveSessionId(nextSession.sessionId);
  }, []);

  const markImageCandidateFailed = useCallback((candidateId: string) => {
    setFailedImageCandidateIds((current) => {
      if (current.has(candidateId)) {
        return current;
      }
      const next = new Set(current);
      next.add(candidateId);
      return next;
    });
  }, []);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/director-video-generations", { cache: "no-store" });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "快速生成记录加载失败");
      }
      const loadedSessions = data.sessions ?? [];
      if (loadedSessions.length) {
        setSessions(loadedSessions);
        setActiveSessionId((current) => current || loadedSessions[0]!.sessionId);
        return;
      }
      const createResponse = await fetch("/api/director-video-generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "快速生成" }),
      });
      const createData = (await createResponse.json()) as SessionResponse;
      if (!createResponse.ok || !createData.session) {
        throw new Error(createData.error ?? "快速生成会话创建失败");
      }
      setSessions([createData.session]);
      setActiveSessionId(createData.session.sessionId);
    } catch (loadError) {
      setError(formatDirectorVideoGenerationError(loadError, "快速生成记录加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeSession || !previewCandidateId) {
      return;
    }
    if (!activeSession.imageCandidates.some((candidate) => candidate.candidateId === previewCandidateId)) {
      setPreviewCandidateId("");
    }
  }, [activeSession, previewCandidateId]);

  useEffect(() => {
    setFailedImageCandidateIds(new Set());
  }, [activeSession?.sessionId, activeSession?.updatedAt]);

  useEffect(() => {
    if (!videoActionRunning) {
      setVideoProgressClockMs(Date.now());
      return;
    }

    setVideoProgressClockMs(Date.now());
    const timer = window.setInterval(() => {
      setVideoProgressClockMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [videoActionRunning]);

  useEffect(() => {
    videoRef.current?.pause();
  }, [playableVideoUrl]);

  useEffect(() => {
    let cancelled = false;
    async function loadVideoJob() {
      if (!activeSession?.videoJobId) {
        setVideoJob(null);
        return;
      }
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/video`, {
        cache: "no-store",
      });
      const data = (await response.json()) as SessionResponse;
      if (cancelled) return;
      if (response.ok) {
        if (data.session) upsertSession(data.session);
        setVideoJob(data.videoJob ?? null);
      }
    }
    void loadVideoJob().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [activeSession?.sessionId, activeSession?.videoJobId, upsertSession]);

  useEffect(() => {
    if (!activeSession?.videoJobId || !videoJob || (videoJob.status !== "QUEUED" && videoJob.status !== "IN_PROGRESS")) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetch(`/api/director-video-generations/${activeSession.sessionId}/video`, { cache: "no-store" })
        .then((response) => response.json() as Promise<SessionResponse>)
        .then((data) => {
          if (data.session) upsertSession(data.session);
          setVideoJob(data.videoJob ?? null);
        })
        .catch(() => null);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [activeSession?.sessionId, activeSession?.videoJobId, upsertSession, videoJob]);

  function updateActiveSession(patch: Partial<VideoGenerationSession>) {
    if (!activeSession) return;
    setSessions((current) =>
      current.map((item) => (item.sessionId === activeSession.sessionId ? { ...item, ...patch } : item)),
    );
  }

  async function createSession() {
    setBusyAction("create");
    setError(null);
    try {
      const response = await fetch("/api/director-video-generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "快速生成" }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "快速生成会话创建失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
    } catch (createError) {
      setError(formatDirectorVideoGenerationError(createError, "快速生成会话创建失败"));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteSession(sessionId: string) {
    setBusyAction("delete");
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${sessionId}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as SessionResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "删除失败");
      }
      setSessions((current) => {
        const next = current.filter((session) => session.sessionId !== sessionId);
        setActiveSessionId(sessionId === activeSessionId ? (next[0]?.sessionId ?? "") : activeSessionId);
        return next;
      });
      if (sessionId === activeSessionId) setVideoJob(null);
    } catch (deleteError) {
      setError(formatDirectorVideoGenerationError(deleteError, "删除失败"));
    } finally {
      setBusyAction(null);
    }
  }

  async function optimizePrompt(target: "image" | "video") {
    if (!activeSession) return;
    setBusyAction(target === "video" ? "videoPrompt" : "imagePrompt");
    setError(null);
    const originalPrompt = target === "video" ? activeSession.videoOriginalPrompt : activeSession.originalPrompt;
    const modificationInstruction =
      target === "video" ? activeSession.videoModificationInstruction : activeSession.modificationInstruction;
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          originalPrompt,
          modificationInstruction,
        }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "提示词优化失败");
      }
      upsertSession(data.session);
    } catch (promptError) {
      setError(formatDirectorVideoGenerationError(promptError, "提示词优化失败"));
    } finally {
      setBusyAction(null);
    }
  }

  function playVideoFromStart() {
    const video = videoRef.current;
    if (!video || !playableVideoUrl) {
      return;
    }

    video.currentTime = 0;
    void video.play().catch((playError: unknown) => {
      setError(formatDirectorVideoGenerationError(playError, "视频播放失败"));
    });
  }

  async function generateImages() {
    if (!activeSession) return;
    setBusyAction("image");
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          imagePrompt: imageGenerationPrompt,
          imageSettings: activeSession.imageSettings,
        }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "图片生成失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
      setPreviewCandidateId("");
    } catch (imageError) {
      setError(formatDirectorVideoGenerationError(imageError, "图片生成失败"));
    } finally {
      setBusyAction(null);
    }
  }

  function downloadImageCandidate(candidate: ImageCandidate, index: number) {
    if (!activeSession || failedImageCandidateIds.has(candidate.candidateId)) {
      return;
    }

    const link = document.createElement("a");
    link.href = candidate.imageUrl;
    link.download = getImageDownloadFileName(activeSession.title, candidate, index);
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadAllImages() {
    if (!activeSession) {
      return;
    }

    activeSession.imageCandidates
      .filter((candidate) => !failedImageCandidateIds.has(candidate.candidateId))
      .forEach((candidate, index) => {
        window.setTimeout(() => downloadImageCandidate(candidate, index), index * 120);
      });
  }

  async function deleteImageCandidate(candidateId: string) {
    if (!activeSession) return;
    setCandidateBusyState({ candidateId, action: "delete" });
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", candidateId }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "删除图片失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
      setPreviewCandidateId((current) => (current === candidateId ? "" : current));
    } catch (deleteError) {
      setError(formatDirectorVideoGenerationError(deleteError, "删除图片失败"));
    } finally {
      setCandidateBusyState(null);
    }
  }

  async function regenerateImageCandidate(candidateId: string) {
    if (!activeSession) return;
    setCandidateBusyState({ candidateId, action: "regenerate" });
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "regenerate",
          candidateId,
          imagePrompt: imageGenerationPrompt,
          imageSettings: activeSession.imageSettings,
        }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "重新生成图片失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
    } catch (regenerateError) {
      setError(formatDirectorVideoGenerationError(regenerateError, "重新生成图片失败"));
    } finally {
      setCandidateBusyState(null);
    }
  }

  async function selectImage(candidateId: string) {
    if (!activeSession) return;
    setBusyAction("select");
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", candidateId }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "选图失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
    } catch (selectError) {
      setError(formatDirectorVideoGenerationError(selectError, "选图失败"));
    } finally {
      setBusyAction(null);
    }
  }

  function handlePreviewNavigate(direction: "prev" | "next") {
    if (!activeSession || previewCandidateIndex < 0) {
      return;
    }
    const nextIndex = direction === "prev" ? previewCandidateIndex - 1 : previewCandidateIndex + 1;
    const nextCandidate = activeSession.imageCandidates[nextIndex];
    if (nextCandidate) {
      setPreviewCandidateId(nextCandidate.candidateId);
    }
  }

  async function generateVideo() {
    if (!activeSession) return;
    setBusyAction("video");
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          videoPrompt: activeSession.videoPrompt,
          videoSettings: activeSession.videoSettings,
        }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "快速生成失败");
      }
      upsertSession(data.session);
      setVideoJob(data.videoJob ?? null);
    } catch (videoError) {
      setError(formatDirectorVideoGenerationError(videoError, "快速生成失败"));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="shell director-video-page">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="快速生成" />
            </div>
          </header>
          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>快速生成流水线</strong>
              <span>GPT-5.5 · Seedream 4.5 · Seedance 2.0</span>
            </div>
            <button className="task-workbench-create-btn" type="button" disabled={busyAction === "create"} onClick={() => void createSession()}>
              <span className="task-workbench-create-btn-text">{busyAction === "create" ? "创建中..." : "新建生成"}</span>
            </button>
          </section>
        </section>

        {error ? <div className="error-box">{error}</div> : null}
        {loading || !activeSession ? (
          <section className="composer-card voice-section-card">
            <div className="task-module-empty">快速生成加载中...</div>
          </section>
        ) : (
          <>
            <section className="generation-tasks-grid director-video-records-grid">
              <div className="panel dashboard-list">
                <ModuleTitle
                  title="生成记录"
                  eyebrow="快速生成"
                  level="primary"
                  action={<span className="table-meta">{sessions.length} 条记录</span>}
                />
                <div className="table-wrap fixed-table-wrap">
                  <table className="task-table jobs-table director-video-record-table">
                    <thead>
                      <tr>
                        <th>任务 ID</th>
                        <th>任务名称</th>
                        <th>类型</th>
                        <th>状态</th>
                        <th>创建时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => {
                        const statusMeta = getSessionStatusMeta(session);
                        return (
                          <tr
                            key={session.sessionId}
                            className={session.sessionId === activeSession.sessionId ? "task-table-row-active" : ""}
                          >
                            <td>
                              <div className="job-id-cell">
                                <span>{session.sessionId.slice(0, 8)}...</span>
                                <button
                                  className="btn-copy"
                                  type="button"
                                  aria-label="复制任务 ID"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(session.sessionId);
                                  }}
                                >
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                            <td className="task-name-cell">{getDisplaySessionTitle(session.title)}</td>
                            <td>
                              <span className="mode-pill mock">快速生成</span>
                            </td>
                            <td>
                              <span
                                className={`table-status${
                                  statusMeta.tone === "warning" ? " warning" : statusMeta.tone === "pending" ? " muted" : ""
                                }`}
                              >
                                {statusMeta.label}
                              </span>
                            </td>
                            <td className="submitted-time-cell">
                              <span>{new Date(session.createdAt).toLocaleDateString("zh-CN")}</span>
                              <strong>{new Date(session.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}</strong>
                            </td>
                            <td>
                              <div className="table-actions">
                                <button
                                  className="btn-pill"
                                  type="button"
                                  onClick={() => {
                                    setActiveSessionId(session.sessionId);
                                    setVideoJob(null);
                                    setPreviewCandidateId("");
                                  }}
                                >
                                  查看
                                </button>
                                <button
                                  className="btn-pill btn-pill-danger"
                                  type="button"
                                  disabled={busyAction === "delete" || sessions.length <= 1}
                                  onClick={() => void deleteSession(session.sessionId)}
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel preview-panel dashboard-preview">
                <ModuleTitle
                  title="预览与参数"
                  eyebrow="结果预览"
                  level="primary"
                  action={
                    <div className="action-row">
                      {playableVideoUrl ? (
                        <a className="btn-secondary small" href={playableVideoUrl} download={videoDownloadFileName}>
                          下载视频
                        </a>
                      ) : null}
                    </div>
                  }
                />
                <div className="result-layout equal-height-columns">
                  <div className="video-frame" style={{ aspectRatio: toCssAspectRatio(activeSession.videoSettings.ratio) }}>
                    {playableVideoUrl ? (
                      <>
                        <video
                          src={playableVideoUrl}
                          controls
                          playsInline
                          className="video-player"
                          {...activePreviewTimecode.videoTimecodeProps}
                        />
                        <div className="video-timecode-badge">{activePreviewTimecode.timecodeLabel}</div>
                      </>
                    ) : (
                      <div className="video-placeholder">
                        <span>{activeSession.videoError ?? "视频预览"}</span>
                      </div>
                    )}
                  </div>

                  <div className="video-params-panel">
                    <div className="video-params-header">
                      <p className="eyebrow">视频参数</p>
                    </div>
                    <div className="video-params-list">
                      {activeVideoParameters.map((item) => (
                        <div key={item.label} className="video-param-row">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="director-video-main">
              <section className="composer-card voice-section-card">
                <ModuleTitle
                  title="第一步：提示词优化"
                  eyebrow="Prompt"
                  inner
                />
                <div className="director-video-prompt-modules">
                  <PromptOptimizationModule
                    title="文生图提示词模块"
                    originalValue={activeSession.originalPrompt}
                    modificationValue={activeSession.modificationInstruction}
                    resultValue={activeSession.imagePrompt}
                    status={activeSession.promptStatus}
                    error={activeSession.promptError}
                    busy={busyAction === "imagePrompt"}
                    disabled={Boolean(busyAction) && busyAction !== "imagePrompt"}
                    onOriginalChange={(value) => updateActiveSession({ originalPrompt: value })}
                    onModificationChange={(value) => updateActiveSession({ modificationInstruction: value })}
                    onResultChange={(value) => updateActiveSession({ optimizedPrompt: value, imagePrompt: value })}
                    onOptimize={() => void optimizePrompt("image")}
                  />
                  <PromptOptimizationModule
                    title="图生视频提示词模块"
                    originalValue={activeSession.videoOriginalPrompt}
                    modificationValue={activeSession.videoModificationInstruction}
                    resultValue={activeSession.videoPrompt}
                    status={activeSession.videoPromptStatus}
                    error={activeSession.videoPromptError}
                    busy={busyAction === "videoPrompt"}
                    disabled={Boolean(busyAction) && busyAction !== "videoPrompt"}
                    onOriginalChange={(value) => updateActiveSession({ videoOriginalPrompt: value })}
                    onModificationChange={(value) => updateActiveSession({ videoModificationInstruction: value })}
                    onResultChange={(value) => updateActiveSession({ videoOptimizedPrompt: value, videoPrompt: value })}
                    onOptimize={() => void optimizePrompt("video")}
                  />
                </div>
              </section>

              <section className="composer-card voice-section-card">
                <ModuleTitle
                  title="第二步：生成图片"
                  eyebrow="Image"
                  inner
                  action={
                    <span className={`table-status task-module-status ${getStatusTone(activeSession.imageStatus)}`}>
                      {statusLabelMap[activeSession.imageStatus]}
                    </span>
                  }
                />
                <div className="composer-settings-grid director-video-settings-grid">
                  <label className="setting-field">
                    <span>图片尺寸</span>
                    <select
                      className="setting-select"
                      value={activeSession.imageSettings.size}
                      onChange={(event) =>
                        updateActiveSession({
                          imageSettings: { ...activeSession.imageSettings, size: event.target.value },
                        } as Partial<VideoGenerationSession>)
                      }
                    >
                      <option value="1664x2496">9:16</option>
                      <option value="1024x1024">1:1</option>
                      <option value="2496x1664">16:9</option>
                    </select>
                  </label>
                  <label className="setting-field">
                    <span>引导强度</span>
                    <input
                      className="setting-input"
                      type="number"
                      min="1"
                      max="10"
                      step="0.5"
                      value={activeSession.imageSettings.guidanceScale}
                      onChange={(event) =>
                        updateActiveSession({
                          imageSettings: {
                            ...activeSession.imageSettings,
                            guidanceScale: Number(event.target.value),
                          },
                        } as Partial<VideoGenerationSession>)
                      }
                    />
                  </label>
                  <label className="setting-field">
                    <span>出图数量</span>
                    <select
                      className="setting-select"
                      value={activeSession.imageSettings.outputCount}
                      onChange={(event) =>
                        updateActiveSession({
                          imageSettings: {
                            ...activeSession.imageSettings,
                            outputCount: Number(event.target.value),
                          },
                        } as Partial<VideoGenerationSession>)
                      }
                    >
                      {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setting-field">
                    <span>是否有水印</span>
                    <select
                      className="setting-select"
                      value={activeSession.imageSettings.watermark ? "true" : "false"}
                      onChange={(event) =>
                        updateActiveSession({
                          imageSettings: {
                            ...activeSession.imageSettings,
                            watermark: event.target.value === "true",
                          },
                        } as Partial<VideoGenerationSession>)
                      }
                    >
                      <option value="false">无水印</option>
                      <option value="true">有水印</option>
                    </select>
                  </label>
                </div>
                {activeSession.imageError ? <p className="director-video-inline-error">{activeSession.imageError}</p> : null}
                <div className="director-video-image-action-row">
                  <div className="director-video-actions">
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={busyAction === "image" || !imageGenerationPrompt}
                      onClick={() => void generateImages()}
                    >
                      {busyAction === "image" ? "生成中..." : activeSession.imageCandidates.length ? "重新批量生成" : "生成图片"}
                    </button>
                  </div>
                  {activeSession.imageCandidates.length ? (
                    <button
                      className="btn-secondary director-video-download-all"
                      type="button"
                      disabled={activeSession.imageCandidates.every((candidate) =>
                        failedImageCandidateIds.has(candidate.candidateId),
                      )}
                      onClick={downloadAllImages}
                    >
                      <Download size={14} aria-hidden="true" />
                      <span>下载全部</span>
                    </button>
                  ) : null}
                </div>
                {activeSession.imageCandidates.length ? (
                  <div className="director-video-image-grid">
                    {activeSession.imageCandidates.map((candidate, candidateIndex) => {
                      const selected = candidate.candidateId === activeSession.selectedImageCandidateId;
                      const unavailable = failedImageCandidateIds.has(candidate.candidateId);
                      const candidateBusy = candidateBusyState?.candidateId === candidate.candidateId;
                      return (
                        <article
                          key={candidate.candidateId}
                          className={`director-video-image-card${selected ? " selected" : ""}${
                            unavailable ? " unavailable" : ""
                          }`}
                        >
                          <div className="director-video-image-media">
                            <button
                              className="director-video-image-trigger image-preview-trigger"
                              type="button"
                              disabled={unavailable || candidateBusy}
                              onClick={() => {
                                if (!unavailable) {
                                  setPreviewCandidateId(candidate.candidateId);
                                }
                              }}
                            >
                              {unavailable ? (
                                <span className="director-video-image-missing">
                                  图片文件丢失
                                  <br />
                                  请重新生成
                                </span>
                              ) : (
                                <Image
                                  src={candidate.imageUrl}
                                  alt="生成图片"
                                  width={900}
                                  height={1600}
                                  unoptimized
                                  onError={() => markImageCandidateFailed(candidate.candidateId)}
                                />
                              )}
                            </button>
                            {!unavailable ? (
                              <>
                                <button
                                  className="director-video-image-overlay-button director-video-image-overlay-regenerate"
                                  type="button"
                                  disabled={candidateBusy || !imageGenerationPrompt}
                                  onClick={() => void regenerateImageCandidate(candidate.candidateId)}
                                >
                                  <RotateCw size={9} aria-hidden="true" />
                                  <span>
                                    {candidateBusyState?.candidateId === candidate.candidateId &&
                                    candidateBusyState.action === "regenerate"
                                      ? "生成中"
                                      : "重新生成"}
                                  </span>
                                </button>
                                <button
                                  className="director-video-image-icon-button director-video-image-delete-button"
                                  type="button"
                                  aria-label="删除图片"
                                  disabled={candidateBusy}
                                  onClick={() => void deleteImageCandidate(candidate.candidateId)}
                                >
                                  <X size={11} aria-hidden="true" strokeWidth={2.4} />
                                </button>
                                <a
                                  className="director-video-image-icon-button director-video-image-download-button"
                                  href={candidate.imageUrl}
                                  download={getImageDownloadFileName(activeSession.title, candidate, candidateIndex)}
                                  aria-label="下载图片"
                                >
                                  <Download size={9} aria-hidden="true" />
                                </a>
                              </>
                            ) : null}
                          </div>
                          <div className="director-video-image-card-foot">
                            <button
                              className="btn-pill"
                              type="button"
                              disabled={busyAction === "select" || selected || unavailable || candidateBusy}
                              onClick={() => void selectImage(candidate.candidateId)}
                            >
                              {unavailable ? "图片不可用" : selected ? "已选择" : "选择这一张"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              <section className="composer-card voice-section-card">
                <ModuleTitle
                  title="第三步：生成视频"
                  eyebrow="Video"
                  inner
                  action={
                    <span className={`table-status task-module-status ${getStatusTone(activeSession.videoStatus)}`}>
                      {statusLabelMap[activeSession.videoStatus]}
                    </span>
                  }
                />
                <div className="composer-settings-grid director-video-settings-grid">
                  <label className="setting-field">
                    <span>画幅</span>
                    <select
                      className="setting-select"
                      value={activeSession.videoSettings.ratio}
                      onChange={(event) =>
                        updateActiveSession({
                          videoSettings: {
                            ...activeSession.videoSettings,
                            ratio: event.target.value as "16:9" | "9:16" | "1:1",
                          },
                        } as Partial<VideoGenerationSession>)
                      }
                    >
                      <option value="9:16">9:16</option>
                      <option value="16:9">16:9</option>
                      <option value="1:1">1:1</option>
                    </select>
                  </label>
                  <label className="setting-field">
                    <span>时长</span>
                    <select
                      className="setting-select"
                      value={activeSession.videoSettings.durationSeconds}
                      onChange={(event) =>
                        updateActiveSession({
                          videoSettings: {
                            ...activeSession.videoSettings,
                            durationSeconds: Number(event.target.value),
                          },
                        } as Partial<VideoGenerationSession>)
                      }
                    >
                      {[4, 5, 6, 8, 10].map((value) => (
                        <option key={value} value={value}>
                          {value}s
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setting-field">
                    <span>清晰度</span>
                    <select
                      className="setting-select"
                      value={activeSession.videoSettings.resolution}
                      onChange={(event) =>
                        updateActiveSession({
                          videoSettings: {
                            ...activeSession.videoSettings,
                            resolution: event.target.value,
                          },
                        } as Partial<VideoGenerationSession>)
                      }
                    >
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                    </select>
                  </label>
                  <label className="setting-field">
                    <span>是否生成原生音频</span>
                    <select
                      className="setting-select"
                      value={activeSession.videoSettings.generateAudio ? "true" : "false"}
                      onChange={(event) =>
                        updateActiveSession({
                          videoSettings: {
                            ...activeSession.videoSettings,
                            generateAudio: event.target.value === "true",
                          },
                        } as Partial<VideoGenerationSession>)
                      }
                    >
                      <option value="false">不生成</option>
                      <option value="true">生成</option>
                    </select>
                  </label>
                </div>
                {activeSession.videoError ? <p className="director-video-inline-error">{activeSession.videoError}</p> : null}
                {playableVideoUrl ? (
                  <div className="director-video-output-layout">
                    <div className="director-video-output">
                      <div className="video-frame director-video-preview-frame" style={{ aspectRatio: toCssAspectRatio(activeSession.videoSettings.ratio) }}>
                        <video
                          ref={videoRef}
                          className="video-player"
                          src={playableVideoUrl}
                          preload="metadata"
                          playsInline
                          controls
                          {...videoTimecode.videoTimecodeProps}
                        />
                        <div className="video-timecode-badge">{videoTimecode.timecodeLabel}</div>
                      </div>
                    </div>
                    <div className="director-video-side-actions">
                      <button
                        className="btn-secondary director-video-side-button"
                        type="button"
                        onClick={playVideoFromStart}
                      >
                        <Play size={14} aria-hidden="true" />
                        <span>播放视频</span>
                      </button>
                      <a
                        className="btn-secondary director-video-side-button director-video-download-button"
                        href={playableVideoUrl}
                        download={videoDownloadFileName}
                      >
                        <Download size={14} aria-hidden="true" />
                        <span>下载视频</span>
                      </a>
                      <TaskNextStepButton
                        state={videoActionState}
                        onBlocked={(reason) => setError(reason)}
                        className="director-video-side-button"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="director-video-side-actions director-video-side-actions-empty">
                    <button className="btn-secondary director-video-side-button" type="button" disabled>
                      <Play size={14} aria-hidden="true" />
                      <span>播放视频</span>
                    </button>
                    <button className="btn-secondary director-video-side-button director-video-download-button" type="button" disabled>
                      <Download size={14} aria-hidden="true" />
                      <span>下载视频</span>
                    </button>
                    <TaskNextStepButton
                      state={videoActionState}
                      onBlocked={(reason) => setError(reason)}
                      className="director-video-side-button"
                    />
                  </div>
                )}
              </section>
            </section>
          </>
        )}
      </section>
      {previewCandidate ? (
        <div className="modal-overlay" role="presentation" onClick={() => setPreviewCandidateId("")}>
          <div
            className="modal-panel image-preview-panel"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h3>生成图片预览</h3>
                <p className="modal-head-subtitle">{`第 ${previewCandidateIndex + 1} / ${activeSession?.imageCandidates.length ?? 0} 张`}</p>
              </div>
              <button className="btn-secondary small" type="button" onClick={() => setPreviewCandidateId("")}>
                关闭
              </button>
            </div>
            <div className="modal-body image-preview-body">
              <div className="image-preview-stage">
                <div className="image-preview-canvas">
                  <button
                    className="image-preview-nav image-preview-nav-prev"
                    type="button"
                    disabled={!previewHasPrevious}
                    aria-label="上一张图片"
                    onClick={() => handlePreviewNavigate("prev")}
                  >
                    {"<"}
                  </button>
                  {previewCandidateUnavailable ? (
                    <div className="image-preview-missing">图片文件丢失，请重新生成图片。</div>
                  ) : (
                    <Image
                      src={previewCandidate.imageUrl}
                      alt="生成图片预览"
                      width={1600}
                      height={1600}
                      unoptimized
                      onError={() => markImageCandidateFailed(previewCandidate.candidateId)}
                    />
                  )}
                  <button
                    className="image-preview-nav image-preview-nav-next"
                    type="button"
                    disabled={!previewHasNext}
                    aria-label="下一张图片"
                    onClick={() => handlePreviewNavigate("next")}
                  >
                    {">"}
                  </button>
                </div>
              </div>
              <div className="image-preview-actions">
                <button
                  className="btn-primary small image-preview-select-button"
                  type="button"
                  disabled={previewCandidateUnavailable || previewIsSelected || busyAction === "select"}
                  onClick={() => void selectImage(previewCandidate.candidateId)}
                >
                  {previewCandidateUnavailable
                    ? "图片不可用"
                    : previewIsSelected
                      ? "已选择这一张"
                      : busyAction === "select"
                        ? "选择中..."
                        : "选择这一张"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
