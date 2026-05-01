"use client";

import { Download, Play, RotateCw, Upload, X } from "lucide-react";
import Image from "next/image";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageBrandTitle } from "../../_components/page-brand-title";
import { useVideoTimecode } from "../../_components/use-video-timecode";
import { ModuleTitle, TaskNextStepButton, type TaskStepActionState } from "../task-creation/_components/task-ui";
import { readDirectorVideoGenerationResponse } from "../../../lib/director-video-generation-client-response";
import { formatDirectorVideoGenerationError } from "../../../lib/director-video-generation-errors";
import { estimateDirectorVideoGenerationProgressPercent } from "../../../lib/director-video-generation-progress";

type StepStatus = "idle" | "running" | "success" | "failed";

type ImageCandidate = {
  candidateId: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  source: "generated" | "uploaded";
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

const NO_MODIFICATION_PROMPT_PLACEHOLDER = "输入修改要求（如没有修改要求，系统将会按原提示词直接生成）";

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

function resolveGenerationPrompt(input: {
  originalPrompt: string;
  modificationInstruction: string;
  optimizedPrompt: string;
  resultPrompt: string;
}) {
  const originalPrompt = input.originalPrompt.trim();
  const modificationInstruction = input.modificationInstruction.trim();
  const resultPrompt = input.resultPrompt.trim() || input.optimizedPrompt.trim();
  return modificationInstruction ? resultPrompt || originalPrompt : originalPrompt || resultPrompt;
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
          placeholder={NO_MODIFICATION_PROMPT_PLACEHOLDER}
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
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [promptBusyState, setPromptBusyState] = useState({ image: false, video: false });
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false);
  const [selectingCandidateId, setSelectingCandidateId] = useState<string | null>(null);
  const [candidateBusyState, setCandidateBusyState] = useState<{
    candidateId: string;
    action: "delete" | "regenerate" | "reupload";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadReplaceCandidateId, setUploadReplaceCandidateId] = useState<string | null>(null);
  const [previewCandidateId, setPreviewCandidateId] = useState("");
  const [failedImageCandidateIds, setFailedImageCandidateIds] = useState<Set<string>>(() => new Set());
  const [videoProgressClockMs, setVideoProgressClockMs] = useState(() => Date.now());
  const [videoProgressFloor, setVideoProgressFloor] = useState<{ jobId: string; percent: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);

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
    ? resolveGenerationPrompt({
        originalPrompt: activeSession.originalPrompt,
        modificationInstruction: activeSession.modificationInstruction,
        optimizedPrompt: activeSession.optimizedPrompt,
        resultPrompt: activeSession.imagePrompt,
      })
    : "";
  const videoGenerationPrompt = activeSession
    ? resolveGenerationPrompt({
        originalPrompt: activeSession.videoOriginalPrompt,
        modificationInstruction: activeSession.videoModificationInstruction,
        optimizedPrompt: activeSession.videoOptimizedPrompt,
        resultPrompt: activeSession.videoPrompt,
      })
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
  const activeVideoPromptLength = videoGenerationPrompt.length;
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
  const imageListMutationRunning = isGeneratingImages || isUploadingImage || Boolean(candidateBusyState);
  const videoJobRunning = isVideoJobRunning(videoJob);
  const videoActionRunning = isSubmittingVideo || videoJobRunning || activeSession?.videoStatus === "running";
  const videoActionBlockedReason = !selectedImage
    ? "请先选择图片。"
    : !videoGenerationPrompt
      ? "请先填写视频提示词。"
      : null;
  const videoActionLabel = videoActionRunning
    ? videoJob?.status === "IN_PROGRESS"
      ? "片段生成中（1/1）"
      : videoJob?.status === "QUEUED"
        ? "排队处理中（1/1）"
        : isSubmittingVideo
          ? "生成中..."
          : "正在生成视频片段..."
    : activeSession?.videoJobId
      ? "重新生成视频"
      : "生成视频";
  const estimatedVideoActionProgressPercent = videoActionRunning
    ? estimateDirectorVideoGenerationProgressPercent(
        videoJob,
        videoProgressClockMs,
        activeSession?.videoSettings.durationSeconds ?? 5,
      )
    : null;
  const videoActionProgressPercent =
    videoActionRunning && videoJob && estimatedVideoActionProgressPercent !== null
      ? Math.max(
          videoProgressFloor?.jobId === videoJob.jobId ? videoProgressFloor.percent : 0,
          estimatedVideoActionProgressPercent,
        )
      : null;
  const videoActionState: TaskStepActionState = {
    label: videoActionLabel,
    isRunning: videoActionRunning,
    busyDisplay: "progress",
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

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/director-video-generations", { cache: "no-store", signal });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "快速生成记录加载失败");
      if (!response.ok) {
        throw new Error(data.error ?? "快速生成记录加载失败");
      }
      const loadedSessions = data.sessions ?? [];
      if (loadedSessions.length) {
        setSessions(loadedSessions);
        setActiveSessionId((current) => current || loadedSessions[0]!.sessionId);
        return;
      }
      setSessions([]);
      setActiveSessionId("");
      setVideoJob(null);
    } catch (loadError) {
      if (signal?.aborted) {
        return;
      }
      setError(formatDirectorVideoGenerationError(loadError, "快速生成记录加载失败"));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSessions(controller.signal);

    return () => {
      controller.abort();
    };
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
    if (!videoActionRunning || !videoJob || estimatedVideoActionProgressPercent === null) {
      setVideoProgressFloor(null);
      return;
    }

    setVideoProgressFloor((current) => {
      const nextPercent =
        current?.jobId === videoJob.jobId
          ? Math.max(current.percent, estimatedVideoActionProgressPercent)
          : estimatedVideoActionProgressPercent;
      if (current?.jobId === videoJob.jobId && current.percent === nextPercent) {
        return current;
      }
      return {
        jobId: videoJob.jobId,
        percent: nextPercent,
      };
    });
  }, [estimatedVideoActionProgressPercent, videoActionRunning, videoJob]);

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
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "视频状态加载失败");
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
        .then((response) => readDirectorVideoGenerationResponse<SessionResponse>(response, "视频状态刷新失败"))
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
    setIsCreatingSession(true);
    setError(null);
    try {
      const response = await fetch("/api/director-video-generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "快速生成" }),
      });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "快速生成会话创建失败");
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "快速生成会话创建失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
    } catch (createError) {
      setError(formatDirectorVideoGenerationError(createError, "快速生成会话创建失败"));
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function deleteSession(sessionId: string) {
    setDeletingSessionId(sessionId);
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${sessionId}`, { method: "DELETE" });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "删除失败");
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
      setDeletingSessionId(null);
    }
  }

  async function optimizePrompt(target: "image" | "video") {
    if (!activeSession) return;
    setPromptBusyState((current) => ({ ...current, [target]: true }));
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
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "提示词优化失败");
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "提示词优化失败");
      }
      upsertSession(data.session);
    } catch (promptError) {
      setError(formatDirectorVideoGenerationError(promptError, "提示词优化失败"));
    } finally {
      setPromptBusyState((current) => ({ ...current, [target]: false }));
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
    setIsGeneratingImages(true);
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          imagePrompt: imageGenerationPrompt,
          originalPrompt: activeSession.originalPrompt,
          modificationInstruction: activeSession.modificationInstruction,
          imageSettings: activeSession.imageSettings,
        }),
      });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "图片生成失败");
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "图片生成失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
      setPreviewCandidateId("");
    } catch (imageError) {
      setError(formatDirectorVideoGenerationError(imageError, "图片生成失败"));
    } finally {
      setIsGeneratingImages(false);
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

  function triggerImageUpload(candidateId?: string) {
    if (imageListMutationRunning) {
      return;
    }
    setUploadReplaceCandidateId(candidateId ?? null);
    if (imageUploadInputRef.current) {
      imageUploadInputRef.current.value = "";
      imageUploadInputRef.current.click();
    }
  }

  async function handleImageUploadChange(event: ChangeEvent<HTMLInputElement>) {
    if (!activeSession) {
      return;
    }
    const file = event.target.files?.[0] ?? null;
    const replaceCandidateId = uploadReplaceCandidateId;
    setUploadReplaceCandidateId(null);
    event.target.value = "";
    if (!file) {
      return;
    }

    if (replaceCandidateId) {
      setCandidateBusyState({ candidateId: replaceCandidateId, action: "reupload" });
    } else {
      setIsUploadingImage(true);
    }
    setError(null);

    try {
      const formData = new FormData();
      formData.append("action", replaceCandidateId ? "reupload" : "upload");
      if (replaceCandidateId) {
        formData.append("candidateId", replaceCandidateId);
      }
      formData.append("file", file);

      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        body: formData,
      });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "上传图片失败");
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "上传图片失败");
      }

      upsertSession(data.session);
      setVideoJob(null);
      setFailedImageCandidateIds((current) => {
        const next = new Set(current);
        if (replaceCandidateId) {
          next.delete(replaceCandidateId);
        }
        if (data.session?.selectedImageCandidateId) {
          next.delete(data.session.selectedImageCandidateId);
        }
        return next;
      });
      if (!replaceCandidateId) {
        setPreviewCandidateId(data.session.selectedImageCandidateId ?? "");
      }
    } catch (uploadError) {
      setError(formatDirectorVideoGenerationError(uploadError, "上传图片失败"));
    } finally {
      if (replaceCandidateId) {
        setCandidateBusyState(null);
      } else {
        setIsUploadingImage(false);
      }
    }
  }

  async function deleteImageCandidate(candidateId: string) {
    if (!activeSession || imageListMutationRunning) return;
    setCandidateBusyState({ candidateId, action: "delete" });
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", candidateId }),
      });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "删除图片失败");
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
    if (!activeSession || imageListMutationRunning) return;
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
          originalPrompt: activeSession.originalPrompt,
          modificationInstruction: activeSession.modificationInstruction,
          imageSettings: activeSession.imageSettings,
        }),
      });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "重新生成图片失败");
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
    setSelectingCandidateId(candidateId);
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", candidateId }),
      });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "选图失败");
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "选图失败");
      }
      upsertSession(data.session);
      setVideoJob(null);
    } catch (selectError) {
      setError(formatDirectorVideoGenerationError(selectError, "选图失败"));
    } finally {
      setSelectingCandidateId(null);
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
    setIsSubmittingVideo(true);
    setError(null);
    try {
      const response = await fetch(`/api/director-video-generations/${activeSession.sessionId}/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          videoPrompt: videoGenerationPrompt,
          videoOriginalPrompt: activeSession.videoOriginalPrompt,
          videoModificationInstruction: activeSession.videoModificationInstruction,
          videoSettings: activeSession.videoSettings,
        }),
      });
      const data = await readDirectorVideoGenerationResponse<SessionResponse>(response, "快速生成失败");
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "快速生成失败");
      }
      upsertSession(data.session);
      setVideoJob(data.videoJob ?? null);
    } catch (videoError) {
      setError(formatDirectorVideoGenerationError(videoError, "快速生成失败"));
    } finally {
      setIsSubmittingVideo(false);
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
            </div>
            <button className="task-workbench-create-btn" type="button" disabled={isCreatingSession} onClick={() => void createSession()}>
              <span className="task-workbench-create-btn-text">{isCreatingSession ? "创建中..." : "新建生成"}</span>
            </button>
          </section>
        </section>

        {error ? <div className="error-box">{error}</div> : null}
        {loading ? (
          <section className="composer-card voice-section-card">
            <div className="task-module-empty">快速生成加载中...</div>
          </section>
        ) : !activeSession ? (
          <section className="composer-card voice-section-card">
            <div className="task-module-empty">暂无快速生成记录</div>
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
                                  disabled={Boolean(deletingSessionId)}
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
                    busy={promptBusyState.image}
                    disabled={false}
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
                    busy={promptBusyState.video}
                    disabled={false}
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
                  <input
                    ref={imageUploadInputRef}
                    className="director-video-upload-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => void handleImageUploadChange(event)}
                  />
                  <div className="director-video-actions">
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={isGeneratingImages || imageListMutationRunning || !imageGenerationPrompt}
                      onClick={() => void generateImages()}
                    >
                      {isGeneratingImages ? "生成中..." : activeSession.imageCandidates.length ? "重新批量生成" : "生成图片"}
                    </button>
                  </div>
                  <div className="director-video-image-secondary-actions">
                    <button
                      className="btn-secondary director-video-upload-button"
                      type="button"
                      disabled={imageListMutationRunning}
                      onClick={() => triggerImageUpload()}
                    >
                      <Upload size={14} aria-hidden="true" />
                      <span>{isUploadingImage ? "上传中..." : "上传图片"}</span>
                    </button>
                    {activeSession.imageCandidates.length ? (
                      <button
                        className="btn-secondary director-video-download-all"
                        type="button"
                        disabled={
                          imageListMutationRunning ||
                          activeSession.imageCandidates.every((candidate) =>
                            failedImageCandidateIds.has(candidate.candidateId),
                          )
                        }
                        onClick={downloadAllImages}
                      >
                        <Download size={14} aria-hidden="true" />
                        <span>下载全部</span>
                      </button>
                    ) : null}
                  </div>
                </div>
                {activeSession.imageCandidates.length ? (
                  <div className="director-video-image-grid">
                    {activeSession.imageCandidates.map((candidate, candidateIndex) => {
                      const selected = candidate.candidateId === activeSession.selectedImageCandidateId;
                      const unavailable = failedImageCandidateIds.has(candidate.candidateId);
                      const candidateBusy = candidateBusyState?.candidateId === candidate.candidateId;
                      const uploaded = candidate.source === "uploaded";
                      const candidateRegenerating = candidateBusy && candidateBusyState?.action === "regenerate";
                      const candidateReuploading = candidateBusy && candidateBusyState?.action === "reupload";
                      return (
                        <article
                          key={candidate.candidateId}
                          className={`director-video-image-card${selected ? " selected" : ""}${
                            unavailable ? " unavailable" : ""
                          }${uploaded ? " uploaded" : ""}`}
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
                                  disabled={
                                    imageListMutationRunning ||
                                    (!uploaded && !imageGenerationPrompt)
                                  }
                                  onClick={() =>
                                    uploaded
                                      ? triggerImageUpload(candidate.candidateId)
                                      : void regenerateImageCandidate(candidate.candidateId)
                                  }
                                >
                                  {uploaded ? (
                                    <Upload size={9} aria-hidden="true" />
                                  ) : (
                                    <RotateCw size={9} aria-hidden="true" />
                                  )}
                                  <span>
                                    {uploaded
                                      ? candidateReuploading
                                        ? "上传中"
                                        : "重新上传"
                                      : candidateRegenerating
                                        ? "生成中"
                                        : "重新生成"}
                                  </span>
                                </button>
                                <button
                                  className="director-video-image-icon-button director-video-image-delete-button"
                                  type="button"
                                  aria-label="删除图片"
                                  disabled={imageListMutationRunning}
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
                                {uploaded ? (
                                  <span className="director-video-image-source-badge">用户上传</span>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                          <div className="director-video-image-card-foot">
                            <button
                              className="btn-pill"
                              type="button"
                              disabled={Boolean(selectingCandidateId) || imageListMutationRunning || selected || unavailable || candidateBusy}
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
                  disabled={previewCandidateUnavailable || previewIsSelected || Boolean(selectingCandidateId) || imageListMutationRunning}
                  onClick={() => void selectImage(previewCandidate.candidateId)}
                >
                  {previewCandidateUnavailable
                    ? "图片不可用"
                    : previewIsSelected
                      ? "已选择这一张"
                      : selectingCandidateId === previewCandidate.candidateId
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
