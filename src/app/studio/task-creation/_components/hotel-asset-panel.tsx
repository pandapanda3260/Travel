"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bath,
  BedDouble,
  Building2,
  Coffee,
  Dumbbell,
  Hotel,
  MapPin,
  Sparkles,
  Utensils,
  Waves,
  type LucideIcon,
} from "lucide-react";

import { getHotelAssetDisplayOrder } from "../../../../lib/hotel-asset-ordering";
import {
  buildTaskHotelAssetAnalysisStats,
  type TaskHotelAssetAnalysisStats,
} from "../../../../lib/task-hotel-asset-analysis-stats";
import type { TaskHotelAssetOptimizationState } from "../../../../lib/task-hotel-asset-optimization-store";
import type { TaskHotelAssetRecord } from "../../../../lib/task-hotel-asset-store";
import {
  usesCapturedMaterialFirstWorkflow,
  type HotelAssetSceneType,
  type VideoTaskRecord,
  type VideoTaskVideoType,
} from "../../../../lib/video-task-schema";

import { parseApiResponse } from "./api-response";

type HotelAssetPanelResponse = {
  task?: VideoTaskRecord | null;
  assets?: TaskHotelAssetRecord[];
  analysisStats?: TaskHotelAssetAnalysisStats;
  optimizationStates?: TaskHotelAssetOptimizationState[];
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
  onTaskChange?: (task: VideoTaskRecord) => void;
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

const hotelAssetSceneIconMap: Record<HotelAssetSceneType, LucideIcon> = {
  exterior: Building2,
  lobby: Hotel,
  room: BedDouble,
  bathroom: Bath,
  dining: Utensils,
  food: Coffee,
  facility: Dumbbell,
  neighborhood: MapPin,
  service_detail: Sparkles,
  atmosphere: Waves,
  other: Sparkles,
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

function formatRecommendedPosition(position: TaskHotelAssetRecord["recommendedPosition"]) {
  switch (position) {
    case "opening":
      return "推荐用于开头";
    case "selling_point":
      return "推荐用于卖点展示";
    case "transition":
      return "推荐用于转场";
    case "ending":
      return "推荐用于结尾";
    case "atmosphere":
      return "推荐用于氛围镜头";
    default:
      return "待分配";
  }
}

function sliceDisplayName(value: string) {
  return Array.from(value.trim()).slice(0, 6).join("");
}

function getDefaultDisplayName(index: number) {
  return `图片${index + 1}`;
}

function isAssetMustUse(asset: Pick<TaskHotelAssetRecord, "mustUse" | "forbidden">) {
  return !asset.forbidden && asset.mustUse !== false;
}

function isRootHotelAssetRecord(asset: TaskHotelAssetRecord) {
  return asset.sourceType === "user_upload" && !asset.enhancedFromAssetId;
}

function buildFallbackDraft(asset: TaskHotelAssetRecord, index: number): AssetDraftState {
  return {
    displayName: sliceDisplayName(asset.displayName || getDefaultDisplayName(index)),
    sceneType: asset.sceneType,
    userNote: asset.userNote,
  };
}

export function HotelAssetPanel({ taskId, videoType, ensureTaskId, onAssetCountChange, onTaskChange }: HotelAssetPanelProps) {
  const supportsCapturedMaterialAssets = usesCapturedMaterialFirstWorkflow(videoType);
  const [assets, setAssets] = useState<TaskHotelAssetRecord[]>([]);
  const [serverAnalysisStats, setServerAnalysisStats] = useState<TaskHotelAssetAnalysisStats | null>(null);
  const [optimizationStates, setOptimizationStates] = useState<TaskHotelAssetOptimizationState[]>([]);
  const [assetDrafts, setAssetDrafts] = useState<Record<string, AssetDraftState>>({});
  const [assetSyncStates, setAssetSyncStates] = useState<Record<string, AssetSyncState>>({});
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading">("idle");
  const [replacingAssetId, setReplacingAssetId] = useState("");
  const [deletingAssetId, setDeletingAssetId] = useState("");
  const [enhancingAssetId, setEnhancingAssetId] = useState("");
  const [selectingAssetId, setSelectingAssetId] = useState("");
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
	      const orderedAssets = getHotelAssetDisplayOrder(nextAssets);
	      const orderedRootAssets = orderedAssets.filter(isRootHotelAssetRecord);
	      setAssets(orderedAssets);
	      onAssetCountChange?.(orderedRootAssets.length);
      setAssetDrafts((currentDrafts) => {
        const nextDrafts = buildAssetDrafts(orderedAssets);
        for (const asset of orderedAssets) {
          const currentDraft = currentDrafts[asset.assetId];
          const currentSyncState = assetSyncStatesRef.current[asset.assetId];
          if (currentDraft && (currentSyncState?.phase === "scheduled" || currentSyncState?.phase === "saving")) {
            nextDrafts[asset.assetId] = currentDraft;
          }
        }
        return nextDrafts;
      });
	      setActiveAssetId((current) => {
	        if (orderedRootAssets.length === 0) {
	          return "";
	        }
	        return orderedRootAssets.some((asset) => asset.assetId === current)
	          ? current
	          : (orderedRootAssets[0]?.assetId ?? "");
	      });
	    },
	    [buildAssetDrafts, onAssetCountChange],
	  );

	  const applyHotelAssetResponse = useCallback(
	    (data: HotelAssetPanelResponse) => {
	      applyAssets(data.assets ?? []);
	      setServerAnalysisStats(data.analysisStats ?? null);
	      setOptimizationStates(data.optimizationStates ?? []);
	      if (data.task) {
	        onTaskChange?.(data.task);
	      }
	    },
	    [applyAssets, onTaskChange],
	  );

  useEffect(() => {
	    if (!supportsCapturedMaterialAssets || !taskId) {
	      setAssets([]);
	      setServerAnalysisStats(null);
	      setOptimizationStates([]);
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
        const data = await parseApiResponse<HotelAssetPanelResponse>(response);
        if (!response.ok) {
          throw new Error(data.error ?? "酒店素材加载失败");
        }
        if (cancelled) {
          return;
        }
	        applyHotelAssetResponse(data);
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
	  }, [applyHotelAssetResponse, onAssetCountChange, supportsCapturedMaterialAssets, taskId]);

	  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.assetId, asset])), [assets]);
	  const rootAssets = useMemo(() => assets.filter(isRootHotelAssetRecord), [assets]);
	  const optimizationStateByRootId = useMemo(
	    () => new Map(optimizationStates.map((state) => [state.rootAssetId, state])),
	    [optimizationStates],
	  );
	  const getCurrentAssetForRoot = useCallback(
	    (rootAsset: TaskHotelAssetRecord) => {
	      const state = optimizationStateByRootId.get(rootAsset.assetId);
	      return (state?.currentAssetId ? assetById.get(state.currentAssetId) : null) ?? rootAsset;
	    },
	    [assetById, optimizationStateByRootId],
	  );
  const computedAnalysisStats = useMemo(() => buildTaskHotelAssetAnalysisStats(assets), [assets]);
  const analysisStats = serverAnalysisStats ?? computedAnalysisStats;
  const analysisStatsHelpText = useMemo(() => {
    const notes = analysisStats.skippedReasons.map((item) => `${item.reason}：${item.count} 张`);
    if (analysisStats.warning > 0) {
      notes.push(`解析完成但建议增强：${analysisStats.warning} 张`);
    }
    if (analysisStats.rejected > 0) {
      notes.push(`解析完成但不建议使用：${analysisStats.rejected} 张`);
    }
    return notes.join("；");
  }, [analysisStats]);
	  const activeRootAsset = useMemo(
	    () => rootAssets.find((asset) => asset.assetId === activeAssetId) ?? rootAssets[0] ?? null,
	    [activeAssetId, rootAssets],
	  );
	  const activeAsset = useMemo(
	    () => (activeRootAsset ? getCurrentAssetForRoot(activeRootAsset) : null),
	    [activeRootAsset, getCurrentAssetForRoot],
	  );
	  const activeOptimizationState = activeRootAsset ? optimizationStateByRootId.get(activeRootAsset.assetId) ?? null : null;
	  const previewAsset = useMemo(
	    () => assets.find((asset) => asset.assetId === previewAssetId) ?? null,
	    [assets, previewAssetId],
	  );
	  const activeEnhancementItems = useMemo(() => {
	    if (!activeRootAsset || !activeOptimizationState) {
	      return [];
	    }

	    const seen = new Set<string>();
	    const currentRound = activeOptimizationState.currentRoundCandidateIds
	      .map((assetId, index) => {
	        const asset = assetById.get(assetId);
	        if (!asset || seen.has(asset.assetId)) {
	          return null;
	        }
	        seen.add(asset.assetId);
	        return {
	          kind: "optimized" as const,
	          asset,
	          label: asset.displayName || `优化图${index + 1}`,
	          buttonLabel: "选择并替换",
	        };
	      })
	      .filter((item): item is NonNullable<typeof item> => Boolean(item));

	    const history = activeOptimizationState.historyAssetIds
	      .map((assetId, index) => {
	        const asset = assetById.get(assetId);
	        if (!asset || seen.has(asset.assetId)) {
	          return null;
	        }
	        seen.add(asset.assetId);
	        return {
	          kind: "history" as const,
	          asset,
	          label: `原图 ${index + 1}`,
	          buttonLabel: "选择并替换现有图片",
	        };
	      })
	      .filter((item): item is NonNullable<typeof item> => Boolean(item));

	    return [...currentRound, ...history];
		  }, [activeOptimizationState, activeRootAsset, assetById]);
	  const hasPendingAssets = analysisStats.pending > 0;
	  const hasAssetOperationInFlight =
	    uploadStatus === "uploading" ||
	    Boolean(replacingAssetId || deletingAssetId || enhancingAssetId || selectingAssetId);
	  const isActiveRootOperationInFlight = Boolean(
	    activeRootAsset &&
	      (replacingAssetId === activeRootAsset.assetId ||
	        deletingAssetId === activeRootAsset.assetId ||
	        enhancingAssetId === activeRootAsset.assetId),
	  ) || uploadStatus === "uploading" || Boolean(selectingAssetId);

  const refreshAssets = useCallback(async () => {
    if (!taskId) {
      return;
    }

    const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets`, {
      cache: "no-store",
    });
    const data = await parseApiResponse<HotelAssetPanelResponse>(response);
    if (!response.ok) {
      throw new Error(data.error ?? "酒店素材刷新失败");
    }
	    applyHotelAssetResponse(data);
	  }, [applyHotelAssetResponse, taskId]);

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
      const data = await parseApiResponse<HotelAssetPanelResponse>(response);
      if (!response.ok) {
        throw new Error(data.error ?? fallbackMessage);
      }
	      applyHotelAssetResponse(data);
	    },
	    [applyHotelAssetResponse, taskId],
	  );

  const handleAssetPreferenceChange = useCallback(
    async (assetId: string, updates: Pick<TaskHotelAssetRecord, "mustUse" | "forbidden">) => {
      if (!taskId || hasAssetOperationInFlight) {
        return;
      }
      setError(null);
      setAssetSyncState(assetId, {
        phase: "saving",
        message: "正在保存使用规则…",
      });
      try {
        await patchAsset(
          {
            assetId,
            ...updates,
          },
          "素材使用规则保存失败",
        );
        setAssetSyncState(assetId, {
          phase: "saved",
          message: "使用规则已保存",
        });
      } catch (preferenceError) {
        setError(preferenceError instanceof Error ? preferenceError.message : "素材使用规则保存失败");
        setAssetSyncState(assetId, {
          phase: "error",
          message: "保存失败",
        });
      }
    },
    [hasAssetOperationInFlight, patchAsset, setAssetSyncState, taskId],
  );

  const handleReorderRootAsset = useCallback(
    async (sourceAssetId: string, targetAssetId: string) => {
      if (!taskId || sourceAssetId === targetAssetId || hasAssetOperationInFlight) {
        return;
      }
      const sourceIndex = rootAssets.findIndex((asset) => asset.assetId === sourceAssetId);
      const targetIndex = rootAssets.findIndex((asset) => asset.assetId === targetAssetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return;
      }

      const previousAssets = assetsRef.current;
      const reorderedRootAssets = [...rootAssets];
      const [movedAsset] = reorderedRootAssets.splice(sourceIndex, 1);
      reorderedRootAssets.splice(targetIndex, 0, movedAsset);
      const rootOrderMap = new Map(reorderedRootAssets.map((asset, index) => [asset.assetId, index]));
      const assetOrders = reorderedRootAssets.map((asset, index) => ({
        assetId: asset.assetId,
        sortOrder: index,
      }));

      setError(null);
      setDraggingAssetId("");
      setAssets((currentAssets) =>
        getHotelAssetDisplayOrder(
          currentAssets.map((asset) => {
            const nextSortOrder = rootOrderMap.get(asset.assetId);
            return nextSortOrder == null ? asset : { ...asset, sortOrder: nextSortOrder };
          }),
        ),
      );

      try {
        await patchAsset(
          {
            assetOrders,
          },
          "图片排序保存失败",
        );
      } catch (reorderError) {
        setAssets(previousAssets);
        setError(reorderError instanceof Error ? reorderError.message : "图片排序保存失败");
      }
    },
    [hasAssetOperationInFlight, patchAsset, rootAssets, taskId],
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
    if (hasAssetOperationInFlight) {
      setError("请等待当前图片操作完成后再继续");
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
		      let nextDataFromServer: HotelAssetPanelResponse | null = null;
		      const uploadFailures: string[] = [];
		      for (const file of filesToUpload) {
		        const formData = new FormData();
		        formData.append("file", file);
		        if (replaceAssetId) {
		          formData.append("replaceAssetId", replaceAssetId);
		        }

		        try {
		          const response = await fetch(`/api/video-tasks/${targetTaskId}/hotel-assets`, {
		            method: "POST",
		            body: formData,
		          });
		          const data = await parseApiResponse<HotelAssetPanelResponse>(response);
		          if (!response.ok) {
		            throw new Error(data.error ?? `上传 ${file.name} 失败`);
		          }
		          nextDataFromServer = data;
		          applyHotelAssetResponse(data);
		        } catch (fileUploadError) {
		          if (replaceAssetId) {
		            throw fileUploadError;
		          }
		          const message = fileUploadError instanceof Error ? fileUploadError.message : "上传失败";
		          uploadFailures.push(`${file.name}：${message}`);
		        }
		      }

      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      if (replaceAssetId && replaceInputRefs.current[replaceAssetId]) {
        replaceInputRefs.current[replaceAssetId]!.value = "";
      }
		      if (!nextDataFromServer) {
	        await refreshAssets();
	      }
		      if (uploadFailures.length > 0) {
		        setError(`部分图片未进入解析队列：${uploadFailures.join("；")}`);
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

  async function handleDeleteAsset(assetId: string) {
    if (!taskId) {
      return;
    }
    if (hasAssetOperationInFlight) {
      setError("请等待当前图片操作完成后再继续");
      return;
    }

    clearAssetTimers(assetId);
    setDeletingAssetId(assetId);
    setError(null);
    try {
      const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets?assetId=${encodeURIComponent(assetId)}`, {
        method: "DELETE",
      });
      const data = await parseApiResponse<HotelAssetPanelResponse>(response);
      if (!response.ok) {
        throw new Error(data.error ?? "酒店素材删除失败");
      }
	      applyHotelAssetResponse(data);
	      setAssetSyncState(assetId, null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "酒店素材删除失败");
    } finally {
      setDeletingAssetId("");
    }
  }

		  async function handleEnhanceAsset(rootAssetId: string) {
		    if (hasAssetOperationInFlight) {
		      setError("请等待当前图片操作完成后再继续");
		      return;
		    }
		    const rootAsset = getAssetById(rootAssetId);
	    const optimizationState = optimizationStates.find((state) => state.rootAssetId === rootAssetId) ?? null;
	    const sourceAsset = optimizationState?.currentAssetId
	      ? (getAssetById(optimizationState.currentAssetId) ?? rootAsset)
	      : rootAsset;
	    const draft = sourceAsset ? assetDraftsRef.current[sourceAsset.assetId] : null;
	    if (!taskId || !rootAsset || !sourceAsset || !draft) {
	      return;
	    }

	    setEnhancingAssetId(rootAssetId);
	    setError(null);
	    try {
	      await saveAssetDraft(sourceAsset.assetId);
	      setAssetSyncState(sourceAsset.assetId, {
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
	          rootAssetId,
	          assetId: sourceAsset.assetId,
	          prompt: draft.userNote.trim(),
	        }),
      });
      const data = await parseApiResponse<HotelAssetPanelResponse>(response);
      if (!response.ok) {
        throw new Error(data.error ?? "AI 优化图片失败");
      }
	      applyHotelAssetResponse(data);
	      setAssetSyncState(sourceAsset.assetId, {
	        phase: "updated",
	        message: "AI 优化图片已生成",
      });
    } catch (enhanceError) {
      const errorMessage =
        enhanceError instanceof Error && enhanceError.message.trim() ? enhanceError.message : "AI 优化图片失败";
      setError(errorMessage);
	      setAssetSyncState(sourceAsset.assetId, {
	        phase: "error",
	        message: errorMessage,
      });
    } finally {
	      setEnhancingAssetId("");
	    }
	  }

		  async function handleSelectAssetVariant(rootAssetId: string, assetId: string) {
		    if (!taskId) {
		      return;
		    }
		    if (hasAssetOperationInFlight) {
		      setError("请等待当前图片操作完成后再继续");
		      return;
		    }

		    setError(null);
		    setSelectingAssetId(assetId);
		    try {
	      const response = await fetch(`/api/video-tasks/${taskId}/hotel-assets`, {
	        method: "PATCH",
	        headers: {
	          "Content-Type": "application/json",
	        },
	        body: JSON.stringify({
	          action: "select_asset_variant",
	          rootAssetId,
	          assetId,
	        }),
	      });
	      const data = await parseApiResponse<HotelAssetPanelResponse>(response);
	      if (!response.ok) {
	        throw new Error(data.error ?? "图片选择失败");
	      }
	      applyHotelAssetResponse(data);
	      setActiveAssetId(rootAssetId);
		    } catch (selectError) {
		      setError(selectError instanceof Error ? selectError.message : "图片选择失败");
		    } finally {
		      setSelectingAssetId("");
		    }
		  }

  if (!supportsCapturedMaterialAssets) {
    return null;
  }

  const ActiveAssetSceneIcon = activeAsset
    ? hotelAssetSceneIconMap[assetDrafts[activeAsset.assetId]?.sceneType ?? activeAsset.sceneType]
    : Sparkles;

  return (
    <section className="composer-card hotel-asset-panel-shell">
      <div className="hotel-asset-panel-heading">酒店实拍图片</div>

      <div className="hotel-asset-panel-stack">
        {error ? <div className="task-module-empty">{error}</div> : null}

        {taskId && loadStatus === "loading" ? <div className="task-module-empty">酒店素材加载中…</div> : null}

        <section className="task-visual-shot-strip-card hotel-asset-strip-card">
	          <div className="task-visual-shot-strip-head">
	            <strong className="task-visual-section-title">图片上传</strong>
		            <span className="hotel-asset-strip-count" title={analysisStatsHelpText || undefined}>
		              {`共 ${analysisStats.total} 张图片  已解析 ${analysisStats.completed} / ${analysisStats.total} 张图片`}
		            </span>
	          </div>
	          <div className="task-visual-shot-strip-list hotel-asset-strip-list">
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
                disabled={hasAssetOperationInFlight}
                onChange={(event) => void handleUploadFiles(Array.from(event.target.files ?? []))}
              />
            </label>

	            {rootAssets.map((asset, index) => {
	              const currentAsset = getCurrentAssetForRoot(asset);
	              const draft = assetDrafts[currentAsset.assetId] ?? buildFallbackDraft(currentAsset, index);
	              const isActive = activeRootAsset?.assetId === asset.assetId;

              return (
                <article
                  key={asset.assetId}
                  className={`task-visual-shot-strip-item hotel-asset-strip-item${isActive ? " active" : ""}${
                    draggingAssetId === asset.assetId ? " dragging" : ""
                  }`}
                  onDragOver={(event) => {
                    if (draggingAssetId && draggingAssetId !== asset.assetId) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleReorderRootAsset(draggingAssetId, asset.assetId);
                  }}
                >
                  <div className="hotel-asset-strip-media-shell">
                    <span
                      className="hotel-asset-drag-handle"
                      draggable
                      title="拖拽调整图片顺序"
                      onDragEnd={() => setDraggingAssetId("")}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", asset.assetId);
                        setDraggingAssetId(asset.assetId);
                      }}
                    >
                      ⠿
                    </span>
                    <button
                      className="task-visual-shot-strip-media hotel-asset-strip-media-button"
                      type="button"
	                      onClick={() => setActiveAssetId(asset.assetId)}
	                    >
	                      <Image
	                        src={currentAsset.fileUrl}
	                        alt={draft.displayName || currentAsset.subjectSummary || currentAsset.fileName}
                        width={900}
                        height={675}
                        unoptimized
                      />
                    </button>
	                    <div className="hotel-asset-strip-overlay-actions">
	                      <label
	                        className={`hotel-asset-overlay-button${
	                          hasAssetOperationInFlight || replacingAssetId === asset.assetId ? " disabled" : ""
	                        }`}
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
	                          disabled={hasAssetOperationInFlight}
	                          onChange={(event) =>
                            void handleUploadFiles(Array.from(event.target.files ?? []), asset.assetId)
                          }
                        />
                      </label>
	                      <button
	                        type="button"
	                        className="hotel-asset-overlay-button danger"
	                        disabled={hasAssetOperationInFlight || deletingAssetId === asset.assetId}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteAsset(asset.assetId);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
		                  <span className="hotel-asset-sequence-label">{`图片${index + 1}`}</span>
		                  <span className="hotel-asset-strip-caption">
		                    {sceneLabelMap[currentAsset.sceneType]}
		                  </span>
	                </article>
              );
            })}
          </div>
        </section>

        {activeAsset ? (
          <section className="hotel-asset-detail-card">
            <div className="hotel-asset-original-card">
              <div className="hotel-asset-original-head">
                <strong>原图预览</strong>
                <span title="当前选中的酒店实拍素材">i</span>
              </div>
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

            <div className="hotel-asset-workspace">
              <div className="hotel-asset-info-card">
                <div className="hotel-asset-info-head">
                  <span className="hotel-asset-info-icon" aria-hidden="true">
                    <ActiveAssetSceneIcon size={20} strokeWidth={2.1} />
                  </span>
                  <div className="hotel-asset-info-copy">
                    <strong>
                      {assetDrafts[activeAsset.assetId]?.displayName || activeAsset.displayName || activeAsset.fileName}
                    </strong>
                    <span>{activeAsset.subjectSummary || "待补充主体说明"}</span>
                  </div>
                </div>
                <div className="hotel-asset-insight-list">
                  <div className="hotel-asset-insight-row">
                    <span>构图</span>
                    <strong>{`${activeAsset.compositionType || "未识别"} · 推荐景别：${
                      activeAsset.recommendedShotScale
                    }`}</strong>
                  </div>
                  <div className="hotel-asset-insight-row">
                    <span>标签</span>
                    <strong>{activeAsset.tags.length ? activeAsset.tags.join(" / ") : "暂无标签"}</strong>
                  </div>
                </div>
              </div>

              <div className="hotel-asset-optimization-layout">
                <div className="hotel-asset-optimization-card">
                  <div className="hotel-asset-section-title-row">
                    <div>
                      <span className="hotel-asset-section-kicker">优化设置</span>
                      <strong className="hotel-asset-section-title">调整场景与优化方向</strong>
                    </div>
                    {getAssetSyncMessage(activeAsset.assetId) ? (
                      <span
                        className={`hotel-asset-status-pill hotel-asset-status-pill--${
                          assetSyncStates[activeAsset.assetId]?.phase ?? "idle"
                        }`}
                      >
                        {getAssetSyncMessage(activeAsset.assetId)}
                      </span>
                    ) : null}
                  </div>
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
                  <div className="hotel-asset-usage-controls" aria-label="素材使用规则">
                    <span className="hotel-asset-position-tag">
                      {formatRecommendedPosition(activeAsset.recommendedPosition)}
                    </span>
                    <label className={`hotel-asset-toggle${isAssetMustUse(activeAsset) ? " active" : ""}`}>
                      <input
                        checked={isAssetMustUse(activeAsset)}
                        disabled={hasAssetOperationInFlight}
                        type="checkbox"
                        onChange={() =>
                          void handleAssetPreferenceChange(activeAsset.assetId, {
                            mustUse: !isAssetMustUse(activeAsset),
                            forbidden: false,
                          })
                        }
                      />
                      <span>必须使用</span>
                    </label>
                    <label className={`hotel-asset-toggle danger${activeAsset.forbidden ? " active" : ""}`}>
                      <input
                        checked={activeAsset.forbidden}
                        disabled={hasAssetOperationInFlight}
                        type="checkbox"
                        onChange={() =>
                          void handleAssetPreferenceChange(activeAsset.assetId, {
                            mustUse: activeAsset.forbidden,
                            forbidden: !activeAsset.forbidden,
                          })
                        }
                      />
                      <span>禁止使用</span>
                    </label>
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
	                  <button
	                    type="button"
	                    className="btn-secondary small hotel-asset-ai-optimize-button"
	                    disabled={isActiveRootOperationInFlight}
	                    onClick={() => activeRootAsset && void handleEnhanceAsset(activeRootAsset.assetId)}
	                  >
                    {activeRootAsset && enhancingAssetId === activeRootAsset.assetId ? "优化中…" : "AI 优化图片"}
                  </button>
                </div>

                <aside className="hotel-asset-enhancement-panel">
                  <div className="hotel-asset-enhancement-head">
                    <div>
                      <span className="hotel-asset-section-kicker">AI 优化结果</span>
                      <strong className="hotel-asset-section-title">新生成的优化图片</strong>
                    </div>
                    <span className="hotel-asset-section-meta">
                      {activeRootAsset && enhancingAssetId === activeRootAsset.assetId
                        ? "生成中"
                        : activeOptimizationState?.currentRoundCandidateIds.length
                          ? `${activeOptimizationState.currentRoundCandidateIds.length}/4 张`
                          : "待生成"}
                    </span>
                  </div>
                  {activeEnhancementItems.length && activeRootAsset ? (
                    <div className="hotel-asset-enhancement-grid">
                      {activeEnhancementItems.map((item) => (
                        <article
                          key={`${item.kind}-${item.asset.assetId}`}
                          className={`hotel-asset-enhancement-card${
                            item.asset.assetId === activeAsset.assetId ? " active" : ""
                          }`}
                        >
                          <button
                            type="button"
                            className="hotel-asset-enhancement-media"
                            onClick={() => setPreviewAssetId(item.asset.assetId)}
                          >
                            <Image
                              src={item.asset.fileUrl}
                              alt={item.asset.displayName || item.label}
                              width={900}
                              height={675}
                              unoptimized
                            />
                          </button>
                          <span className="hotel-asset-enhancement-label">
                            <span>{item.label}</span>
                            {item.asset.assetId !== activeAsset.assetId && item.kind === "history" ? (
                              <em>历史原图</em>
                            ) : null}
                          </span>
	                          <button
	                            type="button"
	                            className="hotel-asset-enhancement-action"
	                            disabled={isActiveRootOperationInFlight || item.asset.assetId === activeAsset.assetId}
	                            onClick={() => void handleSelectAssetVariant(activeRootAsset.assetId, item.asset.assetId)}
	                          >
	                            {selectingAssetId === item.asset.assetId
	                              ? "选择中…"
	                              : item.asset.assetId === activeAsset.assetId
	                                ? "已选择"
	                                : item.buttonLabel}
	                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="hotel-asset-enhancement-empty">
                      <span className="hotel-asset-enhancement-empty-icon">AI</span>
                      <strong>暂无优化图</strong>
                      <span>点击“AI 优化图片”后，这里会生成 4 张可替换图片。</span>
                    </div>
                  )}
                </aside>
              </div>
            </div>
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
                <h3>
                  {assetDrafts[previewAsset.assetId]?.displayName || previewAsset.displayName || previewAsset.fileName}
                </h3>
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
