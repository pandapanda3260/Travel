"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TaskHotelAssetRecord } from "../../../../lib/task-hotel-asset-store";
import {
  usesCapturedMaterialFirstWorkflow,
  type HotelAssetSceneType,
  type VideoTaskVideoType,
} from "../../../../lib/video-task-schema";

type HotelAssetPanelResponse = {
  assets?: TaskHotelAssetRecord[];
  runtime?: {
    providerLabel?: string;
    modelId?: string;
    liveEnabled?: boolean;
  };
  error?: string;
};

type HotelAssetPanelProps = {
  taskId: string | null;
  videoType: VideoTaskVideoType | null;
  ensureTaskId?: () => Promise<string | null>;
  onAssetCountChange?: (count: number) => void;
};

type AssetDraftState = {
  displayName: string;
  sceneType: HotelAssetSceneType;
  userNote: string;
};

type AssetSyncState = {
  phase: "idle" | "scheduled" | "saving" | "saved" | "analyzing" | "updated" | "error";
  message?: string;
};

const sceneOptions: Array<{ value: "" | HotelAssetSceneType; label: string }> = [
  { value: "", label: "自动识别场景" },
  { value: "exterior", label: "酒店外观" },
  { value: "lobby", label: "酒店大堂" },
  { value: "room", label: "客房" },
  { value: "bathroom", label: "卫浴" },
  { value: "dining", label: "餐厅" },
  { value: "food", label: "早餐 / 菜品" },
  { value: "facility", label: "配套设施" },
  { value: "neighborhood", label: "周边环境" },
  { value: "service_detail", label: "服务细节" },
  { value: "atmosphere", label: "氛围镜头" },
  { value: "other", label: "其他" },
];

const sceneLabelMap: Record<HotelAssetSceneType, string> = {
  exterior: "酒店外观",
  lobby: "酒店大堂",
  room: "客房",
  bathroom: "卫浴",
  dining: "餐厅",
  food: "早餐 / 菜品",
  facility: "配套设施",
  neighborhood: "周边环境",
  service_detail: "服务细节",
  atmosphere: "氛围镜头",
  other: "其他",
};

function getReviewTone(status: TaskHotelAssetRecord["reviewStatus"]) {
  switch (status) {
    case "passed":
      return { label: "可用", tone: "passed" as const };
    case "warning":
      return { label: "建议增强", tone: "warning" as const };
    case "rejected":
      return { label: "不建议使用", tone: "rejected" as const };
    default:
      return { label: "待分析", tone: "pending" as const };
  }
}

function sliceDisplayName(value: string) {
  return Array.from(value.trim()).slice(0, 6).join("");
}

function getDefaultDisplayName(index: number) {
  return `图片${index + 1}`;
}

function buildFallbackDraft(asset: TaskHotelAssetRecord, index: number): AssetDraftState {
  return {
    displayName: sliceDisplayName(asset.displayName || getDefaultDisplayName(index)),
    sceneType: asset.sceneType,
    userNote: asset.userNote,
  };
}

export function HotelAssetPanel({ taskId, videoType, ensureTaskId, onAssetCountChange }: HotelAssetPanelProps) {
  const supportsCapturedMaterialAssets = usesCapturedMaterialFirstWorkflow(videoType);
  const [assets, setAssets] = useState<TaskHotelAssetRecord[]>([]);
  const [assetDrafts, setAssetDrafts] = useState<Record<string, AssetDraftState>>({});
  const [assetSyncStates, setAssetSyncStates] = useState<Record<string, AssetSyncState>>({});
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading">("idle");
  const [replacingAssetId, setReplacingAssetId] = useState("");
  const [deletingAssetId, setDeletingAssetId] = useState("");
  const [namingAssetId, setNamingAssetId] = useState("");
  const [enhancingAssetId, setEnhancingAssetId] = useState("");
  const [draggingAssetId, setDraggingAssetId] = useState("");
  const [activeAssetId, setActiveAssetId] = useState("");
  const [previewAssetId, setPreviewAssetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const saveTimersRef = useRef<Record<string, number | undefined>>({});
  const reanalyzeTimersRef = useRef<Record<string, number | undefined>>({});
  const resetTimersRef = useRef<Record<string, number | undefined>>({});
  const lastReanalyzeKeysRef = useRef<Record<string, string>>({});
  const assetDraftsRef = useRef<Record<string, AssetDraftState>>({});
  const assetSyncStatesRef = useRef<Record<string, AssetSyncState>>({});
  const assetsRef = useRef<TaskHotelAssetRecord[]>([]);
  const previousActiveAssetIdRef = useRef("");

  const buildAssetDrafts = useCallback((nextAssets: TaskHotelAssetRecord[]) => {
    return nextAssets.reduce<Record<string, AssetDraftState>>((accumulator, asset, index) => {
      accumulator[asset.assetId] = buildFallbackDraft(asset, index);
      return accumulator;
    }, {});
  }, []);

  useEffect(() => {
    assetDraftsRef.current = assetDrafts;
  }, [assetDrafts]);

  useEffect(() => {
    assetSyncStatesRef.current = assetSyncStates;
  }, [assetSyncStates]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const setAssetSyncState = useCallback((assetId: string, nextState: AssetSyncState | null) => {
    setAssetSyncStates((current) => {
      if (!nextState || nextState.phase === "idle") {
        if (!current[assetId]) {
          return current;
        }
        const next = { ...current };
        delete next[assetId];
        return next;
      }

      return {
        ...current,
        [assetId]: nextState,
      };
    });
  }, []);

  const clearAssetTimers = useCallback((assetId: string) => {
    const saveTimer = saveTimersRef.current[assetId];
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      delete saveTimersRef.current[assetId];
    }

    const reanalyzeTimer = reanalyzeTimersRef.current[assetId];
    if (reanalyzeTimer) {
      window.clearTimeout(reanalyzeTimer);
      delete reanalyzeTimersRef.current[assetId];
    }

    const resetTimer = resetTimersRef.current[assetId];
    if (resetTimer) {
      window.clearTimeout(resetTimer);
      delete resetTimersRef.current[assetId];
    }
  }, []);

  useEffect(() => {
    const saveTimers = saveTimersRef.current;
    const reanalyzeTimers = reanalyzeTimersRef.current;
    const resetTimers = resetTimersRef.current;

    return () => {
      for (const assetId of Object.keys({
        ...saveTimers,
        ...reanalyzeTimers,
        ...resetTimers,
      })) {
        clearAssetTimers(assetId);
      }
    };
  }, [clearAssetTimers]);

  const applyAssets = useCallback(
    (nextAssets: TaskHotelAssetRecord[]) => {
      setAssets(nextAssets);
      onAssetCountChange?.(nextAssets.length);
      setAssetDrafts((currentDrafts) => {
        const nextDrafts = buildAssetDrafts(nextAssets);
        for (const asset of nextAssets) {
          const currentDraft = currentDrafts[asset.assetId];
          const currentSyncState = assetSyncStatesRef.current[asset.assetId];
          if (
            currentDraft &&
            (currentSyncState?.phase === "scheduled" || currentSyncState?.phase === "saving")
          ) {
            nextDrafts[asset.assetId] = currentDraft;
          }
        }
        return nextDrafts;
      });
      setActiveAssetId((current) => {
        if (nextAssets.length === 0) {
          return "";
        }
        return nextAssets.some((asset) => asset.assetId === current) ? current : (nextAssets[0]?.assetId ?? "");
      });
    },
    [buildAssetDrafts, onAssetCountChange],
  );

  useEffect(() => {
    if (!supportsCapturedMaterialAssets || !taskId) {
      setAssets([]);
      setAssetDrafts({});
      setAssetSyncStates({});
      setLoadStatus("idle");
      setActiveAssetId("");
      onAssetCountChange?.(0);
      return;
    }

    let cancelled = false;

    const loadAssets = async () => {
      setLoadStatus("loading");
      try {
        const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets`, {
          cache: "no-store",
        });
        const data = (await response.json()) as HotelAssetPanelResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "酒店素材加载失败");
        }
        if (cancelled) {
          return;
        }
        applyAssets(data.assets ?? []);
        setError(null);
        setLoadStatus("success");
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setLoadStatus("error");
        setError(loadError instanceof Error ? loadError.message : "酒店素材加载失败");
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [applyAssets, onAssetCountChange, supportsCapturedMaterialAssets, taskId]);

  const activeAsset = useMemo(
    () => assets.find((asset) => asset.assetId === activeAssetId) ?? assets[0] ?? null,
    [activeAssetId, assets],
  );
  const previewAsset = useMemo(
    () => assets.find((asset) => asset.assetId === previewAssetId) ?? null,
    [assets, previewAssetId],
  );
  const activeEnhancedAssets = useMemo(() => {
    if (!activeAsset) {
      return [];
    }
    return assets.filter((asset) => asset.enhancedFromAssetId === activeAsset.assetId).slice(0, 4);
  }, [activeAsset, assets]);
  const hasPendingAssets = useMemo(() => assets.some((asset) => asset.reviewStatus === "pending"), [assets]);

  const refreshAssets = useCallback(async () => {
    if (!taskId) {
      return;
    }

    const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets`, {
      cache: "no-store",
    });
    const data = (await response.json()) as HotelAssetPanelResponse;
    if (!response.ok) {
      throw new Error(data.error ?? "酒店素材刷新失败");
    }
    applyAssets(data.assets ?? []);
  }, [applyAssets, taskId]);

  useEffect(() => {
    if (!supportsCapturedMaterialAssets || !taskId || !hasPendingAssets) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAssets().catch(() => {
        // 后台分析中的轮询失败时保留当前状态，避免打断上传后的手工编辑。
      });
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasPendingAssets, refreshAssets, supportsCapturedMaterialAssets, taskId]);

  useEffect(() => {
    for (const asset of assets) {
      const syncState = assetSyncStatesRef.current[asset.assetId];
      if (syncState?.phase === "analyzing" && asset.reviewStatus !== "pending") {
        setAssetSyncState(asset.assetId, {
          phase: "updated",
          message: "识别结果已更新",
        });
        const existingTimer = resetTimersRef.current[asset.assetId];
        if (existingTimer) {
          window.clearTimeout(existingTimer);
        }
        resetTimersRef.current[asset.assetId] = window.setTimeout(() => {
          setAssetSyncState(asset.assetId, null);
          delete resetTimersRef.current[asset.assetId];
        }, 2400);
      }
    }
  }, [assets, setAssetSyncState]);

  const patchAsset = useCallback(
    async (payload: Record<string, unknown>, fallbackMessage: string) => {
      if (!taskId) {
        return;
      }

      const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as HotelAssetPanelResponse;
      if (!response.ok) {
        throw new Error(data.error ?? fallbackMessage);
      }
      applyAssets(data.assets ?? []);
    },
    [applyAssets, taskId],
  );

  const getAssetById = useCallback((assetId: string) => {
    return assetsRef.current.find((asset) => asset.assetId === assetId) ?? null;
  }, []);

  const saveAssetDraft = useCallback(
    async (assetId: string) => {
      const asset = getAssetById(assetId);
      const draft = assetDraftsRef.current[assetId];
      if (!taskId || !asset || !draft) {
        return;
      }

      const nextUserNote = draft.userNote.trim();
      const sceneChanged = draft.sceneType !== asset.sceneType;
      const noteChanged = nextUserNote !== asset.userNote;
      if (!sceneChanged && !noteChanged) {
        return;
      }

      setAssetSyncState(assetId, {
        phase: "saving",
        message: "正在自动保存…",
      });
      await patchAsset(
        {
          assetId,
          sceneType: draft.sceneType,
          userNote: nextUserNote,
        },
        "酒店素材自动保存失败",
      );
      setAssetSyncState(assetId, {
        phase: "saved",
        message: "已自动保存，稍后重新识别",
      });
    },
    [getAssetById, patchAsset, setAssetSyncState, taskId],
  );

  const triggerAssetReanalysis = useCallback(
    async (assetId: string) => {
      const asset = getAssetById(assetId);
      const draft = assetDraftsRef.current[assetId];
      if (!taskId || !asset || !draft) {
        return;
      }

      const reanalyzeKey = `${asset.fileUrl}::${draft.sceneType}::${draft.userNote.trim()}`;
      if (lastReanalyzeKeysRef.current[assetId] === reanalyzeKey && asset.reviewStatus !== "pending") {
        return;
      }

      await saveAssetDraft(assetId);
      setAssetSyncState(assetId, {
        phase: "analyzing",
        message: "识别中…",
      });
      await patchAsset(
        {
          assetId,
          reanalyze: true,
        },
        "酒店素材重新识别失败",
      );
      lastReanalyzeKeysRef.current[assetId] = reanalyzeKey;
    },
    [getAssetById, patchAsset, saveAssetDraft, setAssetSyncState, taskId],
  );

  const scheduleAssetAutoSync = useCallback(
    (assetId: string, options?: { flush?: boolean }) => {
      if (!taskId) {
        return;
      }

      const saveDelay = options?.flush ? 120 : 700;
      const reanalyzeDelay = options?.flush ? 900 : 4200;

      clearAssetTimers(assetId);
      setAssetSyncState(assetId, {
        phase: "scheduled",
        message: "已修改，将自动保存并重新识别",
      });

      saveTimersRef.current[assetId] = window.setTimeout(() => {
        void saveAssetDraft(assetId).catch((saveError) => {
          setError(saveError instanceof Error ? saveError.message : "酒店素材自动保存失败");
          setAssetSyncState(assetId, {
            phase: "error",
            message: "自动保存失败",
          });
        });
      }, saveDelay);

      reanalyzeTimersRef.current[assetId] = window.setTimeout(() => {
        void triggerAssetReanalysis(assetId).catch((reanalyzeError) => {
          setError(reanalyzeError instanceof Error ? reanalyzeError.message : "酒店素材重新识别失败");
          setAssetSyncState(assetId, {
            phase: "error",
            message: "自动识别失败，请稍后再试",
          });
        });
      }, reanalyzeDelay);
    },
    [clearAssetTimers, saveAssetDraft, setAssetSyncState, taskId, triggerAssetReanalysis],
  );

  useEffect(() => {
    const previousAssetId = previousActiveAssetIdRef.current;
    if (
      previousAssetId &&
      previousAssetId !== activeAssetId &&
      assetSyncStatesRef.current[previousAssetId]?.phase === "scheduled"
    ) {
      scheduleAssetAutoSync(previousAssetId, { flush: true });
    }
    previousActiveAssetIdRef.current = activeAssetId;
  }, [activeAssetId, scheduleAssetAutoSync]);

  const updateAssetDraft = useCallback(
    (assetId: string, updates: Partial<AssetDraftState>, options?: { flush?: boolean }) => {
      setAssetDrafts((current) => {
        const assetIndex = assetsRef.current.findIndex((item) => item.assetId === assetId);
        const asset = assetIndex >= 0 ? assetsRef.current[assetIndex] : null;
        if (!asset) {
          return current;
        }

        return {
          ...current,
          [assetId]: {
            ...(current[assetId] ?? buildFallbackDraft(asset, assetIndex)),
            ...updates,
          },
        };
      });
      scheduleAssetAutoSync(assetId, options);
    },
    [scheduleAssetAutoSync],
  );

  const getAssetSyncMessage = useCallback(
    (assetId: string) => {
      return assetSyncStates[assetId]?.message ?? "";
    },
    [assetSyncStates],
  );

  async function handleUploadFiles(files: File[], replaceAssetId?: string) {
    if (files.length === 0) {
      return;
    }

    if (replaceAssetId) {
      setReplacingAssetId(replaceAssetId);
    } else {
      setUploadStatus("uploading");
    }
    setError(null);
    try {
      let targetTaskId = taskId;
      if (!targetTaskId && !replaceAssetId) {
        targetTaskId = (await ensureTaskId?.()) ?? null;
      }
      if (!targetTaskId) {
        throw new Error("请先确认当前任务信息后再上传酒店实拍图");
      }

      const filesToUpload = replaceAssetId ? files.slice(0, 1) : files;
      let nextAssetsFromServer: TaskHotelAssetRecord[] | null = null;
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append("file", file);
        if (replaceAssetId) {
          formData.append("replaceAssetId", replaceAssetId);
        }

        const response = await fetch(`/api/video-tasks/${targetTaskId}/hotel-assets`, {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as HotelAssetPanelResponse;
        if (!response.ok) {
          throw new Error(data.error ?? `上传 ${file.name} 失败`);
        }
        nextAssetsFromServer = data.assets ?? nextAssetsFromServer;
      }

      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      if (replaceAssetId && replaceInputRefs.current[replaceAssetId]) {
        replaceInputRefs.current[replaceAssetId]!.value = "";
      }
      if (nextAssetsFromServer) {
        applyAssets(nextAssetsFromServer);
      } else {
        await refreshAssets();
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "酒店素材上传失败");
    } finally {
      if (replaceAssetId) {
        setReplacingAssetId("");
      } else {
        setUploadStatus("idle");
      }
    }
  }

  async function handleRenameAsset(assetId: string) {
    const draft = assetDraftsRef.current[assetId];
    const assetIndex = assetsRef.current.findIndex((item) => item.assetId === assetId);
    if (!draft || assetIndex < 0) {
      return;
    }

    const nextDisplayName = sliceDisplayName(draft.displayName) || getDefaultDisplayName(assetIndex);
    setAssetDrafts((current) => ({
      ...current,
      [assetId]: {
        ...current[assetId],
        displayName: nextDisplayName,
      },
    }));

    setNamingAssetId(assetId);
    setError(null);
    try {
      await patchAsset(
        {
          assetId,
          displayName: nextDisplayName,
        },
        "图片名称更新失败",
      );
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "图片名称更新失败");
    } finally {
      setNamingAssetId("");
    }
  }

  async function handleReorderAssets(nextAssets: TaskHotelAssetRecord[]) {
    setAssets(nextAssets);
    setError(null);
    try {
      await patchAsset(
        {
          assetOrders: nextAssets.map((asset, index) => ({
            assetId: asset.assetId,
            sortOrder: index,
          })),
        },
        "图片排序更新失败",
      );
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "图片排序更新失败");
      await refreshAssets();
    }
  }

  async function handleDeleteAsset(assetId: string) {
    if (!taskId) {
      return;
    }

    clearAssetTimers(assetId);
    setDeletingAssetId(assetId);
    setError(null);
    try {
      const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets?assetId=${encodeURIComponent(assetId)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as HotelAssetPanelResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "酒店素材删除失败");
      }
      applyAssets(data.assets ?? []);
      setAssetSyncState(assetId, null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "酒店素材删除失败");
    } finally {
      setDeletingAssetId("");
    }
  }

  async function handleEnhanceAsset(assetId: string) {
    const asset = getAssetById(assetId);
    const draft = assetDraftsRef.current[assetId];
    if (!taskId || !asset || !draft) {
      return;
    }

    setEnhancingAssetId(assetId);
    setError(null);
    try {
      await saveAssetDraft(assetId);
      setAssetSyncState(assetId, {
        phase: "analyzing",
        message: "AI 优化图片中…",
      });

      const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "enhance_images",
          assetId,
          prompt: draft.userNote.trim(),
        }),
      });
      const data = (await response.json()) as HotelAssetPanelResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "AI 优化图片失败");
      }
      applyAssets(data.assets ?? []);
      setAssetSyncState(assetId, {
        phase: "updated",
        message: "AI 优化图片已生成",
      });
    } catch (enhanceError) {
      setError(enhanceError instanceof Error ? enhanceError.message : "AI 优化图片失败");
      setAssetSyncState(assetId, {
        phase: "error",
        message: "AI 优化失败",
      });
    } finally {
      setEnhancingAssetId("");
    }
  }

  function moveAsset(assetId: string, targetAssetId: string) {
    if (!assetId || assetId === targetAssetId) {
      return;
    }
    const currentIndex = assets.findIndex((asset) => asset.assetId === assetId);
    const targetIndex = assets.findIndex((asset) => asset.assetId === targetAssetId);
    if (currentIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextAssets = [...assets];
    const [movedAsset] = nextAssets.splice(currentIndex, 1);
    nextAssets.splice(targetIndex, 0, movedAsset);
    void handleReorderAssets(nextAssets);
  }

  if (!supportsCapturedMaterialAssets) {
    return null;
  }

  return (
    <section className="composer-card hotel-asset-panel-shell">
      <div className="hotel-asset-panel-heading">酒店实拍图片</div>

        <div className="hotel-asset-panel-stack">
          {error ? <div className="task-module-empty">{error}</div> : null}

          {taskId && loadStatus === "loading" ? <div className="task-module-empty">酒店素材加载中…</div> : null}

          <section className="task-visual-shot-strip-card hotel-asset-strip-card">
            <div className="task-visual-shot-strip-head">
              <strong className="task-visual-section-title">图片上传</strong>
            </div>
            <div className="task-visual-shot-strip-list hotel-asset-strip-list">
              {assets.map((asset, index) => {
                const draft = assetDrafts[asset.assetId] ?? buildFallbackDraft(asset, index);
                const isActive = activeAsset?.assetId === asset.assetId;

                return (
                  <article
                    key={asset.assetId}
                    className={`task-visual-shot-strip-item hotel-asset-strip-item${isActive ? " active" : ""}${draggingAssetId === asset.assetId ? " dragging" : ""}`}
                    draggable
                    onDragStart={(event) => {
                      setDraggingAssetId(asset.assetId);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", asset.assetId);
                    }}
                    onDragEnd={() => setDraggingAssetId("")}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceAssetId = event.dataTransfer.getData("text/plain");
                      setDraggingAssetId("");
                      moveAsset(sourceAssetId, asset.assetId);
                    }}
                  >
                    <div className="hotel-asset-strip-media-shell">
                      <button
                        className="task-visual-shot-strip-media hotel-asset-strip-media-button"
                        type="button"
                        onClick={() => setActiveAssetId(asset.assetId)}
                      >
                        <Image
                          src={asset.fileUrl}
                          alt={draft.displayName || asset.subjectSummary || asset.fileName}
                          width={900}
                          height={675}
                          unoptimized
                        />
                      </button>
                      <div className="hotel-asset-strip-overlay-actions">
                        <label
                          className={`hotel-asset-overlay-button${replacingAssetId === asset.assetId ? " disabled" : ""}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          重新上传
                          <input
                            ref={(node) => {
                              replaceInputRefs.current[asset.assetId] = node;
                            }}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            disabled={Boolean(replacingAssetId) || uploadStatus === "uploading"}
                            onChange={(event) =>
                              void handleUploadFiles(Array.from(event.target.files ?? []), asset.assetId)
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="hotel-asset-overlay-button danger"
                          disabled={deletingAssetId === asset.assetId}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteAsset(asset.assetId);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <input
                      className="setting-input hotel-asset-name-input"
                      value={draft.displayName}
                      maxLength={6}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const nextValue = sliceDisplayName(event.target.value);
                        setAssetDrafts((current) => ({
                          ...current,
                          [asset.assetId]: {
                            ...draft,
                            displayName: nextValue,
                          },
                        }));
                      }}
                      onBlur={() => {
                        void handleRenameAsset(asset.assetId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span className="hotel-asset-strip-caption">
                      {namingAssetId === asset.assetId
                        ? "保存中…"
                        : asset.reviewStatus === "pending"
                          ? "场景识别中…"
                          : sceneLabelMap[asset.sceneType]}
                    </span>
                  </article>
                );
              })}

              <label
                className={`task-visual-shot-strip-item hotel-asset-upload-tile${uploadStatus === "uploading" ? " uploading" : ""}`}
              >
                <div className="hotel-asset-upload-tile-plus">
                  <span />
                </div>
                <span className="hotel-asset-upload-tile-text">
                  {uploadStatus === "uploading" ? "上传中…" : hasPendingAssets ? "分析中…" : "点击上传图片"}
                </span>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  disabled={uploadStatus === "uploading" || Boolean(replacingAssetId)}
                  onChange={(event) => void handleUploadFiles(Array.from(event.target.files ?? []))}
                />
              </label>
            </div>
          </section>

          {activeAsset ? (
            <section className="hotel-asset-detail-card">
              <div className="hotel-asset-detail-preview">
                <button
                  type="button"
                  className="hotel-asset-detail-preview-button"
                  onClick={() => setPreviewAssetId(activeAsset.assetId)}
                >
                  <div className="hotel-asset-detail-preview-media">
                    <Image
                      src={activeAsset.fileUrl}
                      alt={
                        assetDrafts[activeAsset.assetId]?.displayName ||
                        activeAsset.subjectSummary ||
                        activeAsset.fileName
                      }
                      fill
                      sizes="(max-width: 1200px) 100vw, 300px"
                      style={{ objectFit: "cover" }}
                    />
                  </div>
                </button>
              </div>
              <div className="hotel-asset-detail-main">
                <div className="hotel-asset-chip-row">
                  <span className={`hotel-asset-review-chip ${getReviewTone(activeAsset.reviewStatus).tone}`}>
                    {getReviewTone(activeAsset.reviewStatus).label}
                  </span>
                  <span className="hotel-asset-metric-chip">{`质量 ${activeAsset.qualityScore}`}</span>
                  <span className="hotel-asset-metric-chip">{`商业 ${activeAsset.commercialScore}`}</span>
                  <span className="hotel-asset-metric-chip">
                    {activeAsset.canDirectI2V ? "可直接图生视频" : "建议先增强"}
                  </span>
                </div>

                <div className="hotel-asset-metadata hotel-asset-detail-metadata">
                  <strong>
                    {assetDrafts[activeAsset.assetId]?.displayName || activeAsset.displayName || activeAsset.fileName}
                  </strong>
                  <span className="hotel-asset-meta-line">{activeAsset.subjectSummary || "待补充主体说明"}</span>
                  <span className="hotel-asset-meta-line">
                    构图：{activeAsset.compositionType || "未识别"} · 推荐景别：{activeAsset.recommendedShotScale}
                  </span>
                  <span className="hotel-asset-meta-line">
                    标签：{activeAsset.tags.length ? activeAsset.tags.join(" / ") : "暂无"}
                  </span>
                </div>

                <div className="hotel-asset-detail-grid">
                  <div className="hotel-asset-detail-controls">
                    <label className="setting-field hotel-asset-card-field hotel-asset-scene-field">
                      <span>场景归类</span>
                      <select
                        className="setting-select hotel-asset-scene-select"
                        value={assetDrafts[activeAsset.assetId]?.sceneType ?? activeAsset.sceneType}
                        onChange={(event) =>
                          updateAssetDraft(
                            activeAsset.assetId,
                            {
                              sceneType: event.target.value as HotelAssetSceneType,
                            },
                            { flush: true },
                          )
                        }
                        onBlur={() => {
                          scheduleAssetAutoSync(activeAsset.assetId, { flush: true });
                        }}
                      >
                        {sceneOptions
                          .filter((option) => option.value)
                          .map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn-secondary small hotel-asset-ai-optimize-button"
                      disabled={enhancingAssetId === activeAsset.assetId}
                      onClick={() => void handleEnhanceAsset(activeAsset.assetId)}
                    >
                      {enhancingAssetId === activeAsset.assetId ? "优化中…" : "AI 优化图片"}
                    </button>
                  </div>
                  <label className="setting-field hotel-asset-card-field hotel-asset-detail-note-field">
                    <span>图片优化提示词输入</span>
                    <textarea
                      className="prompt-box compact task-editor-textarea"
                      value={assetDrafts[activeAsset.assetId]?.userNote ?? activeAsset.userNote}
                      onChange={(event) =>
                        updateAssetDraft(activeAsset.assetId, {
                          userNote: event.target.value,
                        })
                      }
                      onBlur={() => {
                        scheduleAssetAutoSync(activeAsset.assetId, { flush: true });
                      }}
                      placeholder="可写想优化的方向，例如提高清晰度、增强自然光、保持真实酒店空间，不改变主体结构。"
                    />
                  </label>
                </div>

                {getAssetSyncMessage(activeAsset.assetId) ? (
                  <div
                    className={`hotel-asset-auto-sync-status hotel-asset-auto-sync-status--${assetSyncStates[activeAsset.assetId]?.phase ?? "idle"}`}
                  >
                    {getAssetSyncMessage(activeAsset.assetId)}
                  </div>
                ) : null}
              </div>
              <aside className="hotel-asset-enhancement-panel">
                <div className="hotel-asset-enhancement-head">
                  <strong>AI 优化结果</strong>
                  <span>{activeEnhancedAssets.length ? `${activeEnhancedAssets.length}/4 张` : "待生成"}</span>
                </div>
                {activeEnhancedAssets.length ? (
                  <div className="hotel-asset-enhancement-grid">
                    {activeEnhancedAssets.map((asset, index) => (
                      <button
                        key={asset.assetId}
                        type="button"
                        className="hotel-asset-enhancement-card"
                        onClick={() => setActiveAssetId(asset.assetId)}
                      >
                        <span className="hotel-asset-enhancement-media">
                          <Image
                            src={asset.fileUrl}
                            alt={asset.displayName || `优化图${index + 1}`}
                            width={900}
                            height={675}
                            unoptimized
                          />
                        </span>
                        <span>{asset.displayName || `优化图${index + 1}`}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="hotel-asset-enhancement-empty">点击 AI 优化图片后显示 4 张优化图</div>
                )}
              </aside>
            </section>
          ) : null}
        </div>

      {previewAsset ? (
        <div className="modal-overlay" role="presentation" onClick={() => setPreviewAssetId("")}>
          <div
            className="modal-panel hotel-asset-preview-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h3>{assetDrafts[previewAsset.assetId]?.displayName || previewAsset.displayName || previewAsset.fileName}</h3>
                <p className="modal-head-subtitle">
                  {previewAsset.reviewStatus === "pending"
                    ? "场景识别中…"
                    : `${sceneLabelMap[previewAsset.sceneType]} · ${previewAsset.subjectSummary || "酒店实拍素材"}`}
                </p>
              </div>
              <button className="btn-secondary small" type="button" onClick={() => setPreviewAssetId("")}>
                关闭
              </button>
            </div>
            <div className="modal-body hotel-asset-preview-modal-body">
              <div className="hotel-asset-preview-stage">
                <Image
                  src={previewAsset.fileUrl}
                  alt={
                    assetDrafts[previewAsset.assetId]?.displayName ||
                    previewAsset.subjectSummary ||
                    previewAsset.fileName
                  }
                  width={1800}
                  height={1800}
                  unoptimized
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
