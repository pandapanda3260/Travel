"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PageBrandTitle } from "../../_components/page-brand-title";
import { RouteLoadingShell } from "../../_components/route-loading-shell";
import { ModuleStatusBadge, ModuleTitle } from "../../studio/task-creation/_components/task-ui";

type ProductArchiveKeyInfo = {
  productName: string;
  originalPrice: string;
  redeemPrice: string;
  packagePersonCount: string;
};

type ProductArchiveParsedData = {
  rawText: string;
  summaryTitle: string;
  packagePersonCount: string;
  tags: string[];
  sellingPoints: string[];
};

type ProductArchiveRecord = {
  archiveId: string;
  title: string;
  sourceImageUrl: string | null;
  sourceImageFileName: string | null;
  sourceImageUploadedAt: string | null;
  parsedText: string;
  parsedData: ProductArchiveParsedData;
  keyInfo: ProductArchiveKeyInfo;
  createdAt: string;
  updatedAt: string;
};

type ProductArchiveRuntime = {
  providerLabel: string;
  modelId: string;
  liveEnabled: boolean;
};

export type ProductArchivesPayload = {
  archives: ProductArchiveRecord[];
  runtime: ProductArchiveRuntime;
  error?: string;
};

const maxUploadFileSizeBytes = 50 * 1024 * 1024;

function sortArchivesByCreatedAtDesc(archives: ProductArchiveRecord[]) {
  return [...archives].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function getDisplayArchiveTitle(title: string) {
  const value = title.trim() || "未命名商品档案";
  const characters = Array.from(value);
  return characters.length <= 10 ? value : `${characters.slice(0, 10).join("")}…`;
}

function getArchiveListStatusMeta(archive: ProductArchiveRecord) {
  if (archive.sourceImageUrl && archive.parsedText.trim()) {
    return {
      label: "已就绪",
      className: "task-module-status created",
    };
  }

  if (archive.sourceImageUrl) {
    return {
      label: "待完善",
      className: "task-module-status editing",
    };
  }

  return {
    label: "未开始",
    className: "task-module-status idle",
  };
}

function getArchiveModuleStatusMeta(input: {
  hasArchive: boolean;
  hasImage?: boolean;
  hasParsedText?: boolean;
  isBusy?: boolean;
}) {
  if (input.isBusy) {
    return {
      label: "处理中",
      tone: "editing" as const,
    };
  }

  if (!input.hasArchive) {
    return {
      label: "未开始",
      tone: "idle" as const,
    };
  }

  if (input.hasImage && input.hasParsedText) {
    return {
      label: "已就绪",
      tone: "created" as const,
    };
  }

  return {
    label: "待完善",
    tone: "editing" as const,
  };
}

function validateImageUploadFile(file: File | null | undefined) {
  if (!file) {
    return null;
  }

  if (file.size > maxUploadFileSizeBytes) {
    window.alert("上传图片不能超过 50MB，请压缩后重试。");
    return null;
  }

  return file;
}

export default function ProductInfoPageClient({
  initialData,
  initialError = null,
  deferInitialLoad = false,
}: {
  initialData: ProductArchivesPayload;
  initialError?: string | null;
  deferInitialLoad?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createArchiveFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCreatedArchiveIdRef = useRef<string | null>(null);
  const pendingCreatedArchiveFileRef = useRef<File | null>(null);
  const pendingCreatedArchiveUploadRef = useRef(false);
  const saveTimerRef = useRef<Record<string, number>>({});
  const [archives, setArchives] = useState<ProductArchiveRecord[]>(() =>
    sortArchivesByCreatedAtDesc(initialData.archives ?? []),
  );
  const [runtime, setRuntime] = useState<ProductArchiveRuntime | null>(initialData.runtime ?? null);
  const [selectedArchiveId, setSelectedArchiveId] = useState("");
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">(() =>
    deferInitialLoad ? "loading" : initialError ? "error" : "success",
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingArchiveId, setDeletingArchiveId] = useState("");
  const [savingFieldKey, setSavingFieldKey] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const selectedArchive = archives.find((item) => item.archiveId === selectedArchiveId) ?? archives[0] ?? null;

  useEffect(() => {
    const activeTimers = saveTimerRef.current;

    return () => {
      Object.values(activeTimers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!deferInitialLoad) {
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    async function loadArchives() {
      setLoadingStatus("loading");
      setError(null);

      try {
        const response = await fetch("/api/product-archives", { cache: "no-store", signal: controller.signal });
        const data = (await response.json().catch(() => ({}))) as ProductArchivesPayload;
        if (!response.ok) {
          throw new Error(data.error ?? "商品信息页面加载失败");
        }
        if (!isActive) {
          return;
        }
        setArchives(sortArchivesByCreatedAtDesc(data.archives ?? []));
        if (data.runtime) {
          setRuntime(data.runtime);
        }
        setLoadingStatus("success");
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        if (!isActive) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "商品信息页面加载失败");
        setLoadingStatus("error");
      }
    }

    void loadArchives();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [deferInitialLoad]);

  useEffect(() => {
    if (!archives.length) {
      setSelectedArchiveId("");
      return;
    }

    setSelectedArchiveId((current) =>
      current && archives.some((item) => item.archiveId === current) ? current : archives[0].archiveId,
    );
  }, [archives]);

  const previewInfoRows = useMemo(
    () =>
      selectedArchive
        ? [
            { label: "商品名称", value: selectedArchive.keyInfo.productName || "待补充" },
            { label: "商品原价", value: selectedArchive.keyInfo.originalPrice || "待补充" },
            { label: "商品核销价", value: selectedArchive.keyInfo.redeemPrice || "待补充" },
            { label: "套餐人数", value: selectedArchive.keyInfo.packagePersonCount || "待补充" },
            { label: "图片状态", value: selectedArchive.sourceImageUrl ? "已上传" : "未上传" },
          ]
        : [],
    [selectedArchive],
  );
  const baseInfoStatusMeta = getArchiveModuleStatusMeta({
    hasArchive: Boolean(selectedArchive),
    hasImage: Boolean(selectedArchive?.sourceImageUrl),
    hasParsedText: Boolean(selectedArchive?.parsedText.trim()),
    isBusy: isUploading || Boolean(savingFieldKey),
  });
  const parsingStatusMeta = getArchiveModuleStatusMeta({
    hasArchive: Boolean(selectedArchive),
    hasImage: Boolean(selectedArchive?.sourceImageUrl),
    hasParsedText: Boolean(selectedArchive?.parsedText.trim()),
    isBusy: isUploading || savingFieldKey === `${selectedArchive?.archiveId}:parsedText`,
  });
  const insightStatusMeta = getArchiveModuleStatusMeta({
    hasArchive: Boolean(selectedArchive),
    hasImage: Boolean(selectedArchive?.sourceImageUrl),
    hasParsedText: Boolean(
      selectedArchive?.parsedData.tags.length ||
      selectedArchive?.parsedData.sellingPoints.length ||
      selectedArchive?.keyInfo.packagePersonCount,
    ),
  });

  function updateArchiveLocally(archiveId: string, updater: (current: ProductArchiveRecord) => ProductArchiveRecord) {
    setArchives((current) =>
      sortArchivesByCreatedAtDesc(current.map((item) => (item.archiveId === archiveId ? updater(item) : item))),
    );
  }

  function mergeArchiveLocally(archive: ProductArchiveRecord) {
    setArchives((current) =>
      sortArchivesByCreatedAtDesc([archive, ...current.filter((item) => item.archiveId !== archive.archiveId)]),
    );
  }

  function scheduleArchiveSave(
    archiveId: string,
    body: Record<string, unknown>,
    saveKey: string,
    revert?: { path: "title" | "parsedText" | "keyInfo"; previousValue: string | ProductArchiveKeyInfo },
  ) {
    const timerKey = `${archiveId}:${saveKey}`;
    if (saveTimerRef.current[timerKey]) {
      window.clearTimeout(saveTimerRef.current[timerKey]);
    }

    saveTimerRef.current[timerKey] = window.setTimeout(async () => {
      setSavingFieldKey(timerKey);
      try {
        const response = await fetch(`/api/product-archives/${archiveId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { archive?: ProductArchiveRecord; error?: string };
        if (!response.ok || !data.archive) {
          throw new Error(data.error ?? "商品档案保存失败");
        }
        updateArchiveLocally(archiveId, () => data.archive!);
      } catch (saveError) {
        if (revert) {
          updateArchiveLocally(archiveId, (current) => {
            if (revert.path === "keyInfo") {
              return { ...current, keyInfo: revert.previousValue as ProductArchiveKeyInfo };
            }
            return { ...current, [revert.path]: revert.previousValue as string };
          });
        }
        setError(saveError instanceof Error ? saveError.message : "商品档案保存失败");
      } finally {
        setSavingFieldKey((current) => (current === timerKey ? "" : current));
      }
    }, 450);
  }

  async function uploadImageToArchive(archiveId: string, file: File) {
    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/product-archives/${archiveId}/image`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { archive?: ProductArchiveRecord; error?: string };
      if (!response.ok || !data.archive) {
        throw new Error(data.error ?? "商品图片上传失败");
      }
      mergeArchiveLocally(data.archive);
      setSelectedArchiveId(data.archive.archiveId);
      return data.archive;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "商品图片上传失败");
      return null;
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (createArchiveFileInputRef.current) {
        createArchiveFileInputRef.current.value = "";
      }
    }
  }

  async function flushPendingCreatedArchiveUpload() {
    const archiveId = pendingCreatedArchiveIdRef.current;
    const file = pendingCreatedArchiveFileRef.current;
    if (!archiveId || !file || pendingCreatedArchiveUploadRef.current) {
      return;
    }

    pendingCreatedArchiveUploadRef.current = true;
    pendingCreatedArchiveFileRef.current = null;

    try {
      await uploadImageToArchive(archiveId, file);
    } finally {
      pendingCreatedArchiveUploadRef.current = false;
      pendingCreatedArchiveIdRef.current = null;
    }
  }

  async function handleCreateArchive() {
    pendingCreatedArchiveIdRef.current = null;
    pendingCreatedArchiveFileRef.current = null;
    if (createArchiveFileInputRef.current) {
      createArchiveFileInputRef.current.value = "";
      createArchiveFileInputRef.current.click();
    }

    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/product-archives", { method: "POST" });
      const data = (await response.json()) as { archive?: ProductArchiveRecord; error?: string };
      if (!response.ok || !data.archive) {
        throw new Error(data.error ?? "创建商品档案失败");
      }
      mergeArchiveLocally(data.archive);
      setSelectedArchiveId(data.archive.archiveId);
      pendingCreatedArchiveIdRef.current = data.archive.archiveId;
      await flushPendingCreatedArchiveUpload();
    } catch (createError) {
      pendingCreatedArchiveIdRef.current = null;
      pendingCreatedArchiveFileRef.current = null;
      setError(createError instanceof Error ? createError.message : "创建商品档案失败");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteArchive(archiveId: string) {
    setDeletingArchiveId(archiveId);
    setError(null);
    try {
      const response = await fetch(`/api/product-archives/${archiveId}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "删除商品档案失败");
      }
      setArchives((current) => current.filter((item) => item.archiveId !== archiveId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除商品档案失败");
    } finally {
      setDeletingArchiveId("");
    }
  }

  async function handleUploadImage(file: File) {
    if (!selectedArchive) {
      return;
    }

    await uploadImageToArchive(selectedArchive.archiveId, file);
  }

  if (loadingStatus === "loading" && !archives.length) {
    return (
      <RouteLoadingShell pageName="Product Info" title="商品档案创建" description="正在加载商品档案，稍后可创建新的商品档案。" />
    );
  }

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Product Info" />
              <div className="topbar-actions compact">
                <button className="toolbar-button" type="button">
                  查看 API Key
                </button>
                <button className="toolbar-button" type="button">
                  使用说明
                </button>
              </div>
            </div>
          </header>

          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>工作台说明</strong>
              <span>统一完成商品档案创建、图片识别、关键信息沉淀与实时保存，切换档案和刷新页面都不会丢失内容。</span>
            </div>
            <button
              className="task-workbench-create-btn"
              type="button"
              disabled={isCreating}
              onClick={() => void handleCreateArchive()}
            >
              <span className="task-workbench-create-btn-text">{isCreating ? "创建中…" : "创建新的商品档案"}</span>
            </button>
            <input
              ref={createArchiveFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const file = validateImageUploadFile(event.target.files?.[0]);
                if (!file) {
                  pendingCreatedArchiveFileRef.current = null;
                  event.target.value = "";
                  return;
                }

                pendingCreatedArchiveFileRef.current = file;
                void flushPendingCreatedArchiveUpload();
              }}
            />
          </section>
        </section>

        <section className="voice-page-stack">
          {error ? <div className="error-box">{error}</div> : null}

          <div className="dashboard-grid generation-tasks-grid product-archive-dashboard">
            <section className="panel dashboard-list product-archive-list-panel">
              <ModuleTitle
                title="商品档案列表"
                eyebrow="素材管理"
                level="primary"
                action={
                  <div className="action-row product-archive-header-actions">
                    <span className="table-meta">{archives.length} 条档案</span>
                  </div>
                }
              />
              <div className="table-wrap fixed-table-wrap product-archive-fixed-wrap">
                <table className="task-table jobs-table">
                  <thead>
                    <tr>
                      <th>档案 ID</th>
                      <th>商品名称</th>
                      <th>状态</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archives.map((archive) => {
                      const statusMeta = getArchiveListStatusMeta(archive);
                      return (
                        <tr
                          key={archive.archiveId}
                          className={archive.archiveId === selectedArchive?.archiveId ? "task-table-row-active" : ""}
                        >
                          <td>{archive.archiveId.slice(0, 8)}...</td>
                          <td className="task-name-cell">{getDisplayArchiveTitle(archive.title)}</td>
                          <td>
                            <span className={`table-status ${statusMeta.className}`.trim()}>{statusMeta.label}</span>
                          </td>
                          <td className="submitted-time-cell">
                            <span>{new Date(archive.createdAt).toLocaleDateString("zh-CN")}</span>
                            <strong>
                              {new Date(archive.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}
                            </strong>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button
                                className="btn-pill"
                                type="button"
                                onClick={() => setSelectedArchiveId(archive.archiveId)}
                              >
                                查看
                              </button>
                              <button
                                className="btn-pill btn-pill-danger"
                                type="button"
                                disabled={deletingArchiveId === archive.archiveId}
                                onClick={() => void handleDeleteArchive(archive.archiveId)}
                              >
                                {deletingArchiveId === archive.archiveId ? "删除中" : "删除"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!archives.length ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="product-archive-empty">
                            还没有商品档案，先点击右上角按钮创建一条新的商品档案。
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel preview-panel dashboard-preview product-archive-preview-panel">
              <ModuleTitle
                title="商品预览页"
                eyebrow="结果预览"
                level="primary"
                action={
                  <span className="table-meta">
                    {selectedArchive ? `当前档案：${getDisplayArchiveTitle(selectedArchive.title)}` : "未选择"}
                  </span>
                }
              />

              <div className="result-layout equal-height-columns product-archive-preview-layout">
                <div className="video-frame product-archive-effect-frame">
                  <div className="product-archive-effect-empty">
                    <span>这里先预留，后续接入自动生成逻辑。</span>
                  </div>
                </div>

                <div className="video-params-panel">
                  <div className="video-params-header">
                    <p className="eyebrow">关键信息</p>
                  </div>
                  <div className="video-params-list">
                    {previewInfoRows.map((item) => (
                      <div key={item.label} className="video-param-row">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="composer-card voice-section-card product-archive-detail-card">
            <ModuleTitle
              title="商品档案详情"
              eyebrow="档案详情"
              inner
              level="primary"
              action={
                <span className="table-meta">
                  {selectedArchive ? selectedArchive.archiveId.slice(0, 8) : "未选择"} ·{" "}
                  {runtime ? `${runtime.providerLabel} · ${runtime.liveEnabled ? "可调用" : "未启用"}` : "未加载"}
                </span>
              }
            />

            {selectedArchive ? (
              <div className="product-archive-detail-stack">
                <section className="composer-card voice-section-card inner-card">
                  <ModuleTitle
                    title="第一步：基础资料编辑"
                    inner
                    level="secondary"
                    action={<ModuleStatusBadge label={baseInfoStatusMeta.label} tone={baseInfoStatusMeta.tone} />}
                  />
                  <div className="task-create-layout single-column product-archive-module-layout">
                    <div className="task-create-main">
                      <div className="product-archive-upload-row">
                        <button
                          className="btn-primary task-next-step-button"
                          type="button"
                          disabled={isUploading}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {isUploading ? "上传解析中..." : selectedArchive.sourceImageUrl ? "重新上传" : "点击上传图片"}
                        </button>
                        <span className="table-meta">
                          {selectedArchive.sourceImageFileName
                            ? `当前图片：${selectedArchive.sourceImageFileName}`
                            : "支持上传 50MB 以内图片，支持 png / jpg / jpeg / webp，上传后会调用 doubao-1-5-vision-pro-32k-250115 进行识别；超长图会优先自动分块识别，必要时再缩放适配。"}
                        </span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          onChange={(event) => {
                            const file = validateImageUploadFile(event.target.files?.[0]);
                            if (!file) {
                              event.target.value = "";
                              return;
                            }
                            void handleUploadImage(file);
                          }}
                        />
                      </div>

                      <div className="composer-settings-grid task-create-grid product-archive-key-grid">
                        <label className="setting-field">
                          <span>商品名称</span>
                          <input
                            className="setting-input"
                            value={selectedArchive.keyInfo.productName}
                            onChange={(event) => {
                              const previousValue = selectedArchive.keyInfo.productName;
                              const nextValue = event.target.value;
                              updateArchiveLocally(selectedArchive.archiveId, (current) => ({
                                ...current,
                                title: nextValue.trim() || current.title,
                                keyInfo: {
                                  ...current.keyInfo,
                                  productName: nextValue,
                                },
                              }));
                              scheduleArchiveSave(
                                selectedArchive.archiveId,
                                {
                                  title: nextValue.trim() || selectedArchive.title,
                                  keyInfo: {
                                    productName: nextValue,
                                  },
                                },
                                "productName",
                                {
                                  path: "keyInfo",
                                  previousValue: {
                                    ...selectedArchive.keyInfo,
                                    productName: previousValue,
                                  },
                                },
                              );
                            }}
                            placeholder="默认取图片识别首行，可自行调整"
                          />
                        </label>
                        <label className="setting-field">
                          <span>商品原价</span>
                          <input
                            className="setting-input"
                            value={selectedArchive.keyInfo.originalPrice}
                            onChange={(event) => {
                              const nextKeyInfo = {
                                ...selectedArchive.keyInfo,
                                originalPrice: event.target.value,
                              };
                              updateArchiveLocally(selectedArchive.archiveId, (current) => ({
                                ...current,
                                keyInfo: nextKeyInfo,
                              }));
                              scheduleArchiveSave(
                                selectedArchive.archiveId,
                                { keyInfo: { originalPrice: event.target.value } },
                                "originalPrice",
                                { path: "keyInfo", previousValue: selectedArchive.keyInfo },
                              );
                            }}
                            placeholder="仅支持手动填写"
                          />
                        </label>
                        <label className="setting-field">
                          <span>商品核销价</span>
                          <input
                            className="setting-input"
                            value={selectedArchive.keyInfo.redeemPrice}
                            onChange={(event) => {
                              const nextKeyInfo = {
                                ...selectedArchive.keyInfo,
                                redeemPrice: event.target.value,
                              };
                              updateArchiveLocally(selectedArchive.archiveId, (current) => ({
                                ...current,
                                keyInfo: nextKeyInfo,
                              }));
                              scheduleArchiveSave(
                                selectedArchive.archiveId,
                                { keyInfo: { redeemPrice: event.target.value } },
                                "redeemPrice",
                                { path: "keyInfo", previousValue: selectedArchive.keyInfo },
                              );
                            }}
                            placeholder="仅支持手动填写"
                          />
                        </label>
                        <label className="setting-field">
                          <span>套餐包含人数</span>
                          <input
                            className="setting-input"
                            value={selectedArchive.keyInfo.packagePersonCount}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              const nextKeyInfo = {
                                ...selectedArchive.keyInfo,
                                packagePersonCount: nextValue,
                              };
                              updateArchiveLocally(selectedArchive.archiveId, (current) => ({
                                ...current,
                                keyInfo: nextKeyInfo,
                              }));
                              scheduleArchiveSave(
                                selectedArchive.archiveId,
                                { keyInfo: { packagePersonCount: nextValue } },
                                "packagePersonCount",
                                { path: "keyInfo", previousValue: selectedArchive.keyInfo },
                              );
                            }}
                            placeholder="自动识别后可继续修改"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="composer-card voice-section-card inner-card">
                  <ModuleTitle
                    title="第二步：图片文案解析"
                    inner
                    level="secondary"
                    action={<ModuleStatusBadge label={parsingStatusMeta.label} tone={parsingStatusMeta.tone} />}
                  />
                  <section className="composer-card task-editor-card plain">
                    <div className="task-editor-card-head">
                      <div>
                        <strong>解析编辑框</strong>
                        <span>图片上传后会自动识别文字，你也可以直接改，系统会实时保存。</span>
                      </div>
                      <span className="table-meta">
                        {savingFieldKey === `${selectedArchive.archiveId}:parsedText`
                          ? "保存中..."
                          : selectedArchive.sourceImageUploadedAt
                            ? `最近上传：${new Date(selectedArchive.sourceImageUploadedAt).toLocaleString("zh-CN")}`
                            : "未上传图片"}
                      </span>
                    </div>
                    <textarea
                      className="prompt-box compact task-editor-textarea product-archive-editor"
                      value={selectedArchive.parsedText}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateArchiveLocally(selectedArchive.archiveId, (current) => ({
                          ...current,
                          parsedText: nextValue,
                        }));
                        scheduleArchiveSave(selectedArchive.archiveId, { parsedText: nextValue }, "parsedText", {
                          path: "parsedText",
                          previousValue: selectedArchive.parsedText,
                        });
                      }}
                      placeholder="上传图片后，这里会展示识别出的商品信息文本，支持实时编辑与永久保存。"
                    />
                  </section>
                </section>

                <section className="composer-card voice-section-card inner-card">
                  <ModuleTitle
                    title="第三步：关键信息分模块"
                    inner
                    level="secondary"
                    action={<ModuleStatusBadge label={insightStatusMeta.label} tone={insightStatusMeta.tone} />}
                  />
                  <div className="module-page-grid product-archive-info-grid">
                    <div className="module-page-card product-archive-info-card">
                      <span>基础信息</span>
                      <strong>
                        {selectedArchive.keyInfo.productName || selectedArchive.parsedData.summaryTitle || "待识别"}
                      </strong>
                      <p>
                        {selectedArchive.parsedData.rawText
                          ? "已识别图片文案，可继续人工修订。"
                          : "上传图片后自动识别商品核心文案。"}
                      </p>
                    </div>
                    <div className="module-page-card product-archive-info-card">
                      <span>价格与人数</span>
                      <strong>{`${selectedArchive.keyInfo.originalPrice || "原价待填"} / ${selectedArchive.keyInfo.redeemPrice || "核销价待填"}`}</strong>
                      <p>{selectedArchive.keyInfo.packagePersonCount || "人数待识别或手动填写"}</p>
                    </div>
                    <div className="module-page-card product-archive-info-card">
                      <span>识别标签</span>
                      <strong>
                        {selectedArchive.parsedData.tags.length
                          ? `${selectedArchive.parsedData.tags.length} 个标签`
                          : "暂无标签"}
                      </strong>
                      <p>{selectedArchive.parsedData.tags.join(" / ") || "上传图片后自动生成标签。"}</p>
                    </div>
                    <div className="module-page-card product-archive-info-card">
                      <span>卖点摘要</span>
                      <strong>
                        {selectedArchive.parsedData.sellingPoints.length
                          ? `${selectedArchive.parsedData.sellingPoints.length} 条卖点`
                          : "暂无卖点"}
                      </strong>
                      <p>{selectedArchive.parsedData.sellingPoints.join("；") || "上传图片后自动整理卖点摘要。"}</p>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="product-archive-empty">请选择或先创建一条商品档案后，再查看和编辑详情。</div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
