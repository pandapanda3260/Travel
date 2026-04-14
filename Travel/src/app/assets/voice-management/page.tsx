"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveClonedVoiceDisplayName } from "../../../lib/speaker-display-overrides";

type TimbreCategory = {
  category: string;
  nextCategory?: string | null;
};

type TimbreEmotion = {
  emotion: string;
  emotionType: string;
  demoText?: string;
  demoUrl?: string;
};

type TimbreItem = {
  speakerId: string;
  speakerName: string;
  gender: string;
  age: string;
  categories: TimbreCategory[];
  emotions: TimbreEmotion[];
  tags: string[];
  description: string;
  previewText: string;
  previewUrl: string | null;
  avatarText: string;
};

type ClonedVoiceRecord = {
  cloneId: string;
  title: string;
  speakerId: string;
  alias: string | null;
  status: "PENDING" | "TRAINING" | "SUCCESS" | "ACTIVE" | "FAILED";
  language: "cn" | "en";
  modelType: 4 | 5;
  sourceFileName: string;
  sourceFormat: string;
  transcript: string;
  demoAudioUrl: string | null;
  trainingVersion: string | null;
  availableTrainingTimes: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type VoiceManagementRuntime = {
  timbreApiEnabled: boolean;
  cloneEnabled: boolean;
  cloneResourceId: string;
  defaultCloneSpeakerId: string;
  configFileName: string;
  cloneRules: {
    supportedFormats: string[];
    maxFileSizeMb: number;
    recommendedDuration: string;
    supportedLanguages: string[];
    supportedModelTypes: number[];
  };
};

type TabId = "square" | "favorites" | "my-voices";
type PageView = "tabs" | "clone-upload";
type CloneStage = "idle" | "uploaded" | "cloning" | "done";

function getSeedValue(seed: string) {
  return Array.from(seed).reduce((value, character, index) => {
    return (value + character.charCodeAt(0) * (index + 17)) % 100000;
  }, 0);
}

function buildGeneratedAvatar(seed: string) {
  const value = getSeedValue(seed);
  const hueA = value % 360;
  const hueB = (value * 1.7) % 360;
  const hueC = (value * 2.3) % 360;
  const eyeOffset = 27 + (value % 4);
  const mouthCurve = 55 + (value % 8);
  const hairHeight = 24 + (value % 10);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="hsl(${hueA} 78% 78%)" />
          <stop offset="100%" stop-color="hsl(${hueB} 76% 66%)" />
        </linearGradient>
        <linearGradient id="shirt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="hsl(${hueC} 48% 44%)" />
          <stop offset="100%" stop-color="hsl(${hueB} 58% 56%)" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="48" fill="url(#bg)" />
      <circle cx="48" cy="39" r="19" fill="#f4d7c6" />
      <path d="M29 ${hairHeight}c5-12 32-14 38 0v10H29z" fill="rgba(68,39,42,0.82)" />
      <circle cx="${eyeOffset}" cy="40" r="2.2" fill="#3d2d2d" />
      <circle cx="${96 - eyeOffset}" cy="40" r="2.2" fill="#3d2d2d" />
      <path d="M38 ${mouthCurve}c4 4 16 4 20 0" fill="none" stroke="#b76e79" stroke-width="2.6" stroke-linecap="round" />
      <path d="M16 92c5-19 22-29 32-29s27 10 32 29z" fill="url(#shirt)" />
    </svg>
  `;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function buildAvatarStyle(seed: string): CSSProperties {
  return {
    backgroundImage: buildGeneratedAvatar(seed),
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="upload-icon">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

export default function VoiceManagementPage() {
  const CARD_PAGE_SIZE = 9;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [pageView, setPageView] = useState<PageView>("tabs");
  const [activeTab, setActiveTab] = useState<TabId>("square");
  const [allTimbres, setAllTimbres] = useState<TimbreItem[]>([]);
  const [clonedVoices, setClonedVoices] = useState<ClonedVoiceRecord[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [runtime, setRuntime] = useState<VoiceManagementRuntime | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [playingSpeakerId, setPlayingSpeakerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Clone upload state
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneLanguage, setCloneLanguage] = useState<"cn" | "en">("cn");
  const [cloneSpeakerId, setCloneSpeakerId] = useState("");
  const [cloneStage, setCloneStage] = useState<CloneStage>("idle");
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [enableDenoise, setEnableDenoise] = useState(false);
  const [audioPlayUrl, setAudioPlayUrl] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const loadBaseData = useCallback(async () => {
    const response = await fetch("/api/voice-management?page=1", { cache: "no-store" });
    const data = (await response.json()) as {
      timbres: TimbreItem[];
      clonedVoices: ClonedVoiceRecord[];
      favoriteIds: string[];
      runtime: VoiceManagementRuntime;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error ?? "音色管理页面加载失败");
    }

    setAllTimbres(data.timbres);
    setClonedVoices(data.clonedVoices);
    setFavoriteIds(new Set(data.favoriteIds));
    setRuntime(data.runtime);
  }, []);

  useEffect(() => {
    void loadBaseData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "音色管理页面加载失败");
    });
  }, [loadBaseData]);

  const filteredTimbres = useMemo(() => {
    if (!searchKeyword.trim()) return allTimbres;
    const kw = searchKeyword.trim().toLowerCase();
    return allTimbres.filter((item) => {
      const haystack = [
        item.speakerId,
        item.speakerName,
        item.description,
        ...item.tags,
        ...item.categories.flatMap((c) => [c.category, c.nextCategory ?? ""]),
        ...item.emotions.map((e) => e.emotion),
      ].join(" ").toLowerCase();
      return haystack.includes(kw);
    });
  }, [allTimbres, searchKeyword]);

  const activeClonedVoices = useMemo(() => {
    return clonedVoices.filter((v) => v.status === "SUCCESS" || v.status === "ACTIVE");
  }, [clonedVoices]);

  const favoriteItems = useMemo(() => {
    const timbreMap = new Map(allTimbres.map((t) => [t.speakerId, t]));
    const cloneMap = new Map(activeClonedVoices.map((v) => [v.speakerId, v]));
    return Array.from(favoriteIds)
      .map((id) => {
        const timbre = timbreMap.get(id);
        if (timbre) return { type: "timbre" as const, item: timbre, speakerId: id };
        const clone = cloneMap.get(id);
        if (clone) return { type: "clone" as const, item: clone, speakerId: id };
        return null;
      })
      .filter(Boolean) as Array<{ type: "timbre" | "clone"; item: TimbreItem | ClonedVoiceRecord; speakerId: string }>;
  }, [allTimbres, activeClonedVoices, favoriteIds]);

  const squarePagedItems = useMemo(() => {
    const source = filteredTimbres;
    const rows: TimbreItem[][] = [];
    for (let i = 0; i < source.length; i += 3) {
      rows.push(source.slice(i, i + 3));
    }
    return rows;
  }, [filteredTimbres]);

  async function toggleFavorite(speakerId: string) {
    const isFav = favoriteIds.has(speakerId);
    const action = isFav ? "remove" : "add";

    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(speakerId);
      else next.add(speakerId);
      return next;
    });

    try {
      const response = await fetch("/api/voice-management/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakerId, action }),
      });
      if (!response.ok) {
        setFavoriteIds((prev) => {
          const rollback = new Set(prev);
          if (isFav) rollback.add(speakerId);
          else rollback.delete(speakerId);
          return rollback;
        });
      }
    } catch {
      setFavoriteIds((prev) => {
        const rollback = new Set(prev);
        if (isFav) rollback.add(speakerId);
        else rollback.delete(speakerId);
        return rollback;
      });
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(text);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError("复制失败");
    }
  }

  async function playPreview(item: TimbreItem | ClonedVoiceRecord) {
    setError(null);
    const speakerId = item.speakerId;

    if (playingSpeakerId === speakerId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingSpeakerId(null);
      return;
    }

    try {
      const isClonedVoice = "cloneId" in item;
      let audioUrl = isClonedVoice ? null : item.previewUrl;

      if (isClonedVoice || !audioUrl) {
        const response = await fetch("/api/voice-management/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerId }),
        });
        const data = (await response.json()) as { previewUrl?: string; error?: string };
        if (!response.ok || !data.previewUrl) {
          throw new Error(data.error ?? "试听音频生成失败");
        }
        audioUrl = data.previewUrl;

        if (isClonedVoice) {
          setClonedVoices((prev) =>
            prev.map((voice) =>
              voice.speakerId === speakerId ? { ...voice, demoAudioUrl: data.previewUrl ?? voice.demoAudioUrl } : voice,
            ),
          );
        } else {
          setAllTimbres((prev) =>
            prev.map((timbre) =>
              timbre.speakerId === speakerId ? { ...timbre, previewUrl: data.previewUrl ?? timbre.previewUrl } : timbre,
            ),
          );
        }
      }

      if (!audioUrl) {
        throw new Error("当前音色没有可用试听音频");
      }

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setPlayingSpeakerId(speakerId);
      audio.onended = () => setPlayingSpeakerId(null);
      await audio.play();
    } catch (playError) {
      setPlayingSpeakerId(null);
      setError(playError instanceof Error ? playError.message : "试听播放失败");
    }
  }

  function handleFileSelect(file: File | null) {
    if (!file) return;
    const maxSize = (runtime?.cloneRules.maxFileSizeMb ?? 8) * 1024 * 1024;
    if (file.size > maxSize) {
      setCloneError(`文件大小不能超过 ${runtime?.cloneRules.maxFileSizeMb ?? 8}MB`);
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const allowed = runtime?.cloneRules.supportedFormats ?? ["wav", "mp3", "m4a"];
    if (!allowed.includes(ext)) {
      setCloneError(`仅支持 ${allowed.join("、")} 格式`);
      return;
    }
    setCloneFile(file);
    setCloneStage("uploaded");
    setCloneError(null);
    setAudioPlayUrl(URL.createObjectURL(file));
  }

  async function handleStartClone() {
    if (!cloneFile) return;
    setCloneStage("cloning");
    setCloneError(null);

    try {
      const formData = new FormData();
      formData.set("title", cloneFile.name.replace(/\.[^.]+$/, ""));
      formData.set("transcript", "欢迎来到内容创作工作台，这是一段用于复刻试听的参考文本。");
      formData.set("language", cloneLanguage);
      formData.set("modelType", "4");
      formData.set("speakerId", cloneSpeakerId.trim() || runtime?.defaultCloneSpeakerId || "");
      formData.set("enableDenoise", enableDenoise ? "1" : "0");
      formData.set("file", cloneFile);

      const response = await fetch("/api/voice-management/clone", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "复刻失败");
      }

      setCloneStage("done");
      await loadBaseData();
    } catch (err) {
      setCloneStage("uploaded");
      setCloneError(err instanceof Error ? err.message : "复刻音色失败");
    }
  }

  function resetCloneUpload() {
    setCloneFile(null);
    setCloneStage("idle");
    setCloneError(null);
    if (audioPlayUrl) URL.revokeObjectURL(audioPlayUrl);
    setAudioPlayUrl(null);
    setAudioProgress(0);
    setAudioDuration(0);
  }

  function renderTimbreCard(item: TimbreItem) {
    const isFav = favoriteIds.has(item.speakerId);
    const isPlaying = playingSpeakerId === item.speakerId;

    return (
      <article key={item.speakerId} className="voice-card-new">
        <div className="voice-avatar-wrap">
          <button
            className={`voice-avatar-button image-fill${isPlaying ? " playing" : ""}`}
            type="button"
            style={buildAvatarStyle(item.speakerId)}
            aria-label={isPlaying ? `暂停${item.speakerName}` : `试听${item.speakerName}`}
            onClick={() => void playPreview(item)}
          >
            <span className="sr-only">{item.avatarText}</span>
          </button>
          <button
            className="voice-play-indicator"
            type="button"
            aria-label={isPlaying ? "暂停" : "播放"}
            onClick={() => void playPreview(item)}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
        <div className="voice-card-new-body">
          <div className="voice-card-new-head">
            <span className="voice-card-new-name">{item.speakerName}</span>
            <div className="voice-card-new-actions">
              <button
                className={`voice-action-btn${isFav ? " favorited" : ""}`}
                type="button"
                aria-label={isFav ? "取消收藏" : "收藏"}
                onClick={() => void toggleFavorite(item.speakerId)}
              >
                <StarIcon filled={isFav} />
              </button>
              <span className="voice-copy-tip-wrap">
                <button
                  className="voice-action-btn"
                  type="button"
                  aria-label="复制音色 ID"
                  onClick={() => void copyToClipboard(item.speakerId)}
                >
                  {copiedId === item.speakerId ? <CheckCircleIcon /> : <CopyIcon />}
                </button>
                <span className="voice-copy-tip" aria-hidden>
                  复制音色 ID
                </span>
              </span>
            </div>
          </div>
          <div className="voice-card-new-tags">
            {item.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="voice-tag-pill">{tag}</span>
            ))}
          </div>
          <p className="voice-card-new-desc">{item.description}</p>
        </div>
      </article>
    );
  }

  function renderCloneCard(item: ClonedVoiceRecord) {
    const isFav = favoriteIds.has(item.speakerId);
    const isPlaying = playingSpeakerId === item.speakerId;
    const displayName = resolveClonedVoiceDisplayName(item.speakerId, item.alias, item.title);

    return (
      <article key={item.cloneId} className="voice-card-new">
        <div className="voice-avatar-wrap">
          <button
            className={`voice-avatar-button image-fill${isPlaying ? " playing" : ""}`}
            type="button"
            style={buildAvatarStyle(item.speakerId || item.cloneId)}
            aria-label={isPlaying ? `暂停${displayName}` : `试听${displayName}`}
            onClick={() => void playPreview(item)}
          >
            <span className="sr-only">{displayName.slice(0, 1)}</span>
          </button>
          <button
            className="voice-play-indicator"
            type="button"
            aria-label={isPlaying ? "暂停" : "播放"}
            onClick={() => void playPreview(item)}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
        <div className="voice-card-new-body">
          <div className="voice-card-new-head">
            <span className="voice-card-new-name">{displayName}</span>
            <div className="voice-card-new-actions">
              <button
                className={`voice-action-btn${isFav ? " favorited" : ""}`}
                type="button"
                aria-label={isFav ? "取消收藏" : "收藏"}
                onClick={() => void toggleFavorite(item.speakerId)}
              >
                <StarIcon filled={isFav} />
              </button>
              <span className="voice-copy-tip-wrap">
                <button
                  className="voice-action-btn"
                  type="button"
                  aria-label="复制音色 ID"
                  onClick={() => void copyToClipboard(item.speakerId)}
                >
                  {copiedId === item.speakerId ? <CheckCircleIcon /> : <CopyIcon />}
                </button>
                <span className="voice-copy-tip" aria-hidden>
                  复制音色 ID
                </span>
              </span>
            </div>
          </div>
          <div className="voice-card-new-tags">
            <span className="voice-tag-pill">{item.language === "en" ? "English" : "中文"}</span>
            <span className="voice-tag-pill">声音复刻</span>
            <span className="voice-tag-pill">{item.status === "ACTIVE" || item.status === "SUCCESS" ? "可用" : item.status}</span>
          </div>
          <p className="voice-card-new-desc">{item.transcript}</p>
        </div>
      </article>
    );
  }

  // ===== Clone Upload Page =====
  if (pageView === "clone-upload") {
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
                  <button className="toolbar-button" type="button">查看 API Key</button>
                  <button className="toolbar-button" type="button">使用说明</button>
                </div>
              </div>
            </header>

            <section className="notice-bar task-workbench-note">
              <div className="task-workbench-note-main">
                <strong>工作台说明</strong>
                <span>上传或录制音频，快速复刻专属音色，复刻完成后可在「我的音色」中查看和使用。</span>
              </div>
            </section>
          </section>

          <section className="voice-page-stack">
            <section className="composer-card voice-section-card">
              <button
                className="voice-upload-back-btn"
                type="button"
                onClick={() => { setPageView("tabs"); resetCloneUpload(); }}
              >
                <ArrowLeftIcon />
                返回上级页面
              </button>
              <div className="voice-upload-page">
                <div className="voice-upload-hero">
                  <h2>录制或上传音频，<span>轻松复刻</span></h2>
                  <p>
                    推荐上传或录制10-30s音频，上传支持小于 8M 的 wav、mp3、m4a 格式文件，<br />
                    避免多人对话、明显杂音、噪音、混响等情况。
                  </p>
                </div>

                <div className="voice-upload-wave">
                  {Array.from({ length: 30 }, (_, i) => {
                    const h = 12 + Math.sin(i * 0.5) * 22 + Math.sin(i * 1.7 + 3) * 8;
                    return <div key={i} className="voice-upload-wave-bar" style={{ height: `${h}px` }} />;
                  })}
                </div>

                {cloneStage === "idle" && (
                  <>
                    <div
                      className="voice-upload-drop-zone"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleFileSelect(e.dataTransfer.files[0] ?? null);
                      }}
                    >
                      <UploadIcon />
                      <span className="upload-text">上传声音</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".wav,.mp3,.m4a"
                        style={{ display: "none" }}
                        onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </>
                )}

                {(cloneStage === "uploaded" || cloneStage === "cloning") && cloneFile && (
                  <>
                    <div className="voice-audio-card">
                      <button
                        className="voice-audio-play-btn"
                        type="button"
                        onClick={() => {
                          if (!audioPlayUrl) return;
                          if (audioRef.current) {
                            audioRef.current.pause();
                            audioRef.current = null;
                            setPlayingSpeakerId(null);
                            return;
                          }
                          const a = new Audio(audioPlayUrl);
                          audioRef.current = a;
                          setPlayingSpeakerId("__upload__");
                          a.onloadedmetadata = () => setAudioDuration(a.duration);
                          a.ontimeupdate = () => {
                            if (a.duration) setAudioProgress(a.currentTime / a.duration);
                          };
                          a.onended = () => { setPlayingSpeakerId(null); audioRef.current = null; setAudioProgress(0); };
                          void a.play();
                        }}
                      >
                        {playingSpeakerId === "__upload__" ? <PauseIcon /> : <PlayIcon />}
                      </button>
                      <div className="voice-audio-info">
                        <div className="voice-audio-name">{cloneFile.name}</div>
                        <div
                          className="voice-audio-progress-bar"
                          ref={progressRef}
                          onClick={(e) => {
                            if (!audioRef.current || !progressRef.current) return;
                            const rect = progressRef.current.getBoundingClientRect();
                            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                            audioRef.current.currentTime = ratio * audioRef.current.duration;
                            setAudioProgress(ratio);
                          }}
                        >
                          <div className="voice-audio-progress-track">
                            <div className="voice-audio-progress-fill" style={{ width: `${audioProgress * 100}%` }} />
                          </div>
                        </div>
                        <div className="voice-audio-meta-row">
                          <span className="voice-audio-duration">
                            {audioDuration > 0 ? `${Math.floor(audioProgress * audioDuration)}s / ${Math.floor(audioDuration)}s` : `${(cloneFile.size / 1024).toFixed(0)} KB`}
                          </span>
                        </div>
                      </div>
                      <div className="voice-audio-card-actions">
                        <button
                          className="voice-audio-action-btn"
                          type="button"
                          aria-label="删除"
                          onClick={resetCloneUpload}
                          disabled={cloneStage === "cloning"}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>

                    <div className="voice-upload-options">
                      <label className="setting-field" style={{ marginBottom: 4 }}>
                        <span>音色槽位 ID</span>
                        <input
                          className="setting-input"
                          value={cloneSpeakerId}
                          onChange={(e) => setCloneSpeakerId(e.target.value)}
                          placeholder={runtime?.defaultCloneSpeakerId || "从火山引擎控制台获取，格式 S_xxxxxxx"}
                          disabled={cloneStage === "cloning"}
                        />
                      </label>
                      <p style={{ margin: "0 0 8px", color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
                        在火山引擎控制台「语音技术 → 声音复刻」中购买槽位后获取，每个槽位对应一个独立音色。
                      </p>
                      <div className="voice-upload-option-row clone-options-inline">
                        <label className="setting-field">
                          <span>语言选择</span>
                          <select
                            className="setting-select"
                            value={cloneLanguage}
                            onChange={(e) => setCloneLanguage(e.target.value as "cn" | "en")}
                            disabled={cloneStage === "cloning"}
                          >
                            <option value="cn">中文</option>
                            <option value="en">English</option>
                          </select>
                        </label>
                        <div className="clone-denoise-inline">
                          <span className="voice-upload-denoise-label">去噪音</span>
                          <button
                            type="button"
                            className={`toggle-switch${enableDenoise ? " active" : ""}`}
                            onClick={() => setEnableDenoise(!enableDenoise)}
                            disabled={cloneStage === "cloning"}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="voice-upload-actions">
                      {cloneStage === "cloning" ? (
                        <button className="btn-primary clone-action-btn" type="button" disabled>
                          复刻中...
                        </button>
                      ) : (
                        <>
                          <button
                            className="btn-secondary clone-action-btn"
                            type="button"
                            onClick={resetCloneUpload}
                          >
                            重新上传
                          </button>
                          <button
                            className="btn-primary clone-action-btn"
                            type="button"
                            onClick={() => void handleStartClone()}
                          >
                            开始复刻
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}

                {cloneStage === "done" && (
                  <div className="voice-clone-status">
                    <div className="status-icon success">
                      <CheckCircleIcon />
                    </div>
                    <h3>复刻完成</h3>
                    <p>音色已成功复刻，可前往「我的音色」查看和使用。</p>
                    <div style={{ marginTop: 20 }}>
                      <button
                        className="btn-primary"
                        type="button"
                        onClick={() => {
                          resetCloneUpload();
                          setPageView("tabs");
                          setActiveTab("my-voices");
                        }}
                      >
                        跳转至我的音色
                      </button>
                    </div>
                  </div>
                )}

                {cloneError && <div className="error-box">{cloneError}</div>}
              </div>
            </section>
          </section>
        </section>
      </main>
    );
  }

  // ===== Main Tabs Page =====
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
                <button className="toolbar-button" type="button">查看 API Key</button>
                <button className="toolbar-button" type="button">使用说明</button>
              </div>
            </div>
          </header>

          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>工作台说明</strong>
              <span>浏览音色广场、管理收藏与复刻音色，所有配置实时保存，刷新页面不会丢失。</span>
            </div>
            <button
              className="task-workbench-create-btn"
              type="button"
              onClick={() => setPageView("clone-upload")}
            >
              <span className="task-workbench-create-btn-text">点击复刻声音</span>
            </button>
          </section>
        </section>

        <section className="voice-page-stack">
          {error ? <div className="error-box">{error}</div> : null}

          <section className="composer-card voice-section-card">
            <div className="voice-tab-header">
              <div className="voice-tab-header-left">
                <div className="voice-tabs-bar">
                  <button
                    className={`voice-tab-button${activeTab === "square" ? " active" : ""}`}
                    type="button"
                    onClick={() => setActiveTab("square")}
                  >
                    广场
                  </button>
                  <button
                    className={`voice-tab-button${activeTab === "my-voices" ? " active" : ""}`}
                    type="button"
                    onClick={() => setActiveTab("my-voices")}
                  >
                    我的音色
                  </button>
                  <button
                    className={`voice-tab-button${activeTab === "favorites" ? " active" : ""}`}
                    type="button"
                    onClick={() => setActiveTab("favorites")}
                  >
                    收藏音色
                  </button>
                </div>
              </div>
              
            </div>

            {/* ===== Square Tab ===== */}
            {activeTab === "square" && (
              <>
                <div className="voice-tab-search" style={{ marginBottom: searchKeyword.trim() ? 0 : 14 }}>
                  <span className="search-icon"><SearchIcon /></span>
                  <input
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="在音色库中搜索音色名称或音色ID"
                  />
                </div>

                {searchKeyword.trim() && (
                  <div className="voice-search-result-hint">
                    <button
                      className="voice-search-back-btn"
                      type="button"
                      aria-label="清空搜索"
                      onClick={() => setSearchKeyword("")}
                    >
                      <ArrowLeftIcon />
                    </button>
                    <strong className="voice-search-result-label">搜索结果</strong>
                  </div>
                )}

                {filteredTimbres.length > 0 ? (
                  <div className="voice-grid-board">
                    {squarePagedItems.map((row, rowIndex) => (
                      <div key={rowIndex} className="voice-grid-row">
                        {row.map((item) => renderTimbreCard(item))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="voice-empty-state">
                    {searchKeyword.trim() ? "没有找到匹配的音色，试试其他关键词" : "正在加载音色列表..."}
                  </div>
                )}
              </>
            )}

            {/* ===== My Voices Tab ===== */}
            {activeTab === "my-voices" && (
              <>
                <div style={{ padding: "4px 0 14px" }}>
                  <span className="voice-count-label">{clonedVoices.length} 个音色</span>
                </div>

                {clonedVoices.length > 0 ? (
                  <div className="voice-grid-board">
                    {Array.from(
                      { length: Math.ceil(clonedVoices.length / 3) },
                      (_, i) => clonedVoices.slice(i * 3, i * 3 + 3),
                    ).map((row, rowIndex) => (
                      <div key={rowIndex} className="voice-grid-row">
                        {row.map((item) => renderCloneCard(item))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="voice-empty-state">
                    还没有复刻音色，点击「声音复刻」按钮开始创建。
                  </div>
                )}
              </>
            )}

            {/* ===== Favorites Tab ===== */}
            {activeTab === "favorites" && (
              <>
                <div className="voice-tab-search" style={{ marginBottom: searchKeyword.trim() ? 0 : 14 }}>
                  <span className="search-icon"><SearchIcon /></span>
                  <input
                    placeholder="在收藏音色搜索音色名称或音色ID"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                  />
                </div>

                {searchKeyword.trim() && (
                  <div className="voice-search-result-hint">
                    <button
                      className="voice-search-back-btn"
                      type="button"
                      aria-label="清空搜索"
                      onClick={() => setSearchKeyword("")}
                    >
                      <ArrowLeftIcon />
                    </button>
                    <strong className="voice-search-result-label">搜索结果</strong>
                  </div>
                )}

                <div style={{ padding: "0 0 10px" }}>
                  <span className="voice-count-label">{favoriteItems.length} 个收藏音色</span>
                </div>

                {favoriteItems.length > 0 ? (
                  <div className="voice-grid-board">
                    {Array.from(
                      { length: Math.ceil(favoriteItems.length / 3) },
                      (_, i) => favoriteItems.slice(i * 3, i * 3 + 3),
                    ).map((row, rowIndex) => (
                      <div key={rowIndex} className="voice-grid-row">
                        {row.map((entry) =>
                          entry.type === "timbre"
                            ? renderTimbreCard(entry.item as TimbreItem)
                            : renderCloneCard(entry.item as ClonedVoiceRecord),
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="voice-empty-state">
                    还没有收藏任何音色，在广场或我的音色中点击星标即可收藏。
                  </div>
                )}
              </>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
