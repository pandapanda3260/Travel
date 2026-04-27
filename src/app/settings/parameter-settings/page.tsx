"use client";

import { useEffect, useMemo, useState } from "react";

import { PageBrandTitle } from "../../_components/page-brand-title";
import {
  imageGuidanceOptions,
  videoCameraControlOptions,
  videoCfgScaleOptions,
  videoModeOptions,
} from "../../../lib/task-creation-parameters";
import {
  getDefaultParameterSettingsState,
  parameterSettingsStorageKey,
  readParameterSettingsState,
  serializeParameterSettingsState,
} from "../../../lib/parameter-settings";
import { ModuleTitle } from "../../studio/task-creation/_components/task-ui";

function formatSavedTime(date: Date | null) {
  if (!date) {
    return "未保存";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ParameterSettingsPage() {
  const defaultSettings = getDefaultParameterSettingsState();
  const [imageGuidanceScale, setImageGuidanceScale] = useState(defaultSettings.imageGuidanceScale);
  const [imageSeedMode, setImageSeedMode] = useState(defaultSettings.imageSeedMode);
  const [imageSeedValue, setImageSeedValue] = useState(defaultSettings.imageSeedValue);
  const [videoMode, setVideoMode] = useState(defaultSettings.videoMode);
  const [videoCfgScale, setVideoCfgScale] = useState(defaultSettings.videoCfgScale);
  const [videoCameraControl, setVideoCameraControl] = useState(defaultSettings.videoCameraControl);
  const [videoNegativePrompt, setVideoNegativePrompt] = useState(defaultSettings.videoNegativePrompt);
  const [showVideoNegativePrompt, setShowVideoNegativePrompt] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    const settings = readParameterSettingsState(window.localStorage);
    const frameId = window.requestAnimationFrame(() => {
      setImageGuidanceScale(settings.imageGuidanceScale);
      setImageSeedMode(settings.imageSeedMode);
      setImageSeedValue(settings.imageSeedValue);
      setVideoMode(settings.videoMode);
      setVideoCfgScale(settings.videoCfgScale);
      setVideoCameraControl(settings.videoCameraControl);
      setVideoNegativePrompt(settings.videoNegativePrompt);
      setShowVideoNegativePrompt(Boolean(settings.videoNegativePrompt.trim()));
      setIsHydrated(true);
      setLastSavedAt(new Date());
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(
      parameterSettingsStorageKey,
      serializeParameterSettingsState({
        imageGuidanceScale,
        imageSeedMode,
        imageSeedValue,
        videoMode,
        videoCfgScale,
        videoCameraControl,
        videoNegativePrompt,
      }),
    );
    const frameId = window.requestAnimationFrame(() => {
      setLastSavedAt(new Date());
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    imageGuidanceScale,
    imageSeedMode,
    imageSeedValue,
    isHydrated,
    videoCameraControl,
    videoCfgScale,
    videoMode,
    videoNegativePrompt,
  ]);

  const summaryItems = useMemo(
    () => [
      {
        label: "图片默认",
        value: "2 项",
        meta: "细节 · 种子",
      },
      {
        label: "视频默认",
        value: "4 项",
        meta: "画质 · 运镜",
      },
      {
        label: "作用范围",
        value: "新建任务",
        meta: "字幕请在工作流汇总调整",
      },
    ],
    [],
  );

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Parameter Settings" />
              <div className="topbar-actions compact">
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={() => {
                    const defaults = getDefaultParameterSettingsState();
                    setImageGuidanceScale(defaults.imageGuidanceScale);
                    setImageSeedMode(defaults.imageSeedMode);
                    setImageSeedValue(defaults.imageSeedValue);
                    setVideoMode(defaults.videoMode);
                    setVideoCfgScale(defaults.videoCfgScale);
                    setVideoCameraControl(defaults.videoCameraControl);
                    setVideoNegativePrompt(defaults.videoNegativePrompt);
                    setShowVideoNegativePrompt(Boolean(defaults.videoNegativePrompt.trim()));
                  }}
                >
                  恢复默认
                </button>
              </div>
            </div>
          </header>
        </section>

        <section className="voice-page-stack parameter-settings-page-stack">
          <section className="panel parameter-settings-panel">
            <ModuleTitle
              title="参数设置"
              eyebrow="系统设置"
              level="primary"
              action={<span className="table-meta">自动保存 · {formatSavedTime(lastSavedAt)}</span>}
            />

            <div className="parameter-settings-hero">
              <div className="module-page-grid parameter-settings-grid">
                {summaryItems.map((item) => (
                  <div key={item.label} className="module-page-card parameter-settings-summary-card">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.meta}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="task-create-parameter-stack parameter-settings-stack">
              <section className="task-inline-parameter-group">
                <div className="parameter-settings-section-head">
                  <div className="task-inline-parameter-label">图片高级参数</div>
                  <span className="parameter-settings-section-meta">细节引导 · 随机种子</span>
                </div>
                <div className="task-inline-parameter-row parameter-settings-row">
                  <div className="composer-settings-grid task-create-grid task-inline-parameter-grid">
                    <label className="setting-field">
                      <span>细节引导</span>
                      <select
                        className="setting-select"
                        value={imageGuidanceScale}
                        onChange={(event) =>
                          setImageGuidanceScale(
                            Number(event.target.value) as (typeof imageGuidanceOptions)[number]["value"],
                          )
                        }
                      >
                        {imageGuidanceOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="setting-field">
                      <span>随机种子</span>
                      <select
                        className="setting-select"
                        value={imageSeedMode}
                        onChange={(event) => setImageSeedMode(event.target.value as "random" | "fixed")}
                      >
                        <option value="random">系统随机</option>
                        <option value="fixed">固定种子（预留）</option>
                      </select>
                    </label>
                  </div>

                  {imageSeedMode === "fixed" ? (
                    <div className="image-seed-row task-inline-seed-row">
                      <input
                        className="image-seed-input"
                        value={imageSeedValue}
                        onChange={(event) => setImageSeedValue(event.target.value.replace(/[^\d-]/g, ""))}
                        placeholder="输入整数种子"
                      />
                      <span className="table-meta">当前图片生成链路仍未启用 seed 控制，这里先作为后续接入预留位。</span>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="task-inline-parameter-group">
                <div className="parameter-settings-section-head">
                  <div className="task-inline-parameter-label">视频高级参数</div>
                  <span className="parameter-settings-section-meta">画质 · 相关性 · 运镜 · 负向</span>
                </div>
                <div className="task-inline-parameter-row parameter-settings-row">
                  <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-advanced-grid">
                    <label className="setting-field">
                      <span>输出画质</span>
                      <select
                        className="setting-select"
                        value={videoMode}
                        onChange={(event) =>
                          setVideoMode(event.target.value as (typeof videoModeOptions)[number]["value"])
                        }
                      >
                        {videoModeOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="setting-field">
                      <span>提示词相关性</span>
                      <select
                        className="setting-select"
                        value={videoCfgScale}
                        onChange={(event) =>
                          setVideoCfgScale(Number(event.target.value) as (typeof videoCfgScaleOptions)[number])
                        }
                      >
                        {videoCfgScaleOptions.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="setting-field">
                      <span>预设运镜</span>
                      <select
                        className="setting-select"
                        value={videoCameraControl}
                        onChange={(event) =>
                          setVideoCameraControl(
                            event.target.value as (typeof videoCameraControlOptions)[number]["value"],
                          )
                        }
                      >
                        {videoCameraControlOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="setting-field">
                      <span>负向约束</span>
                      <button
                        className={`setting-select task-inline-negative-toggle ${showVideoNegativePrompt ? "active" : ""}`}
                        type="button"
                        onClick={() => setShowVideoNegativePrompt((current) => !current)}
                      >
                        {showVideoNegativePrompt ? "收起详情" : videoNegativePrompt.trim() ? "已添加" : "点击配置"}
                      </button>
                    </div>
                  </div>

                  {showVideoNegativePrompt ? (
                    <div className="setting-advanced-panel task-inline-negative-panel">
                      <textarea
                        className="setting-textarea"
                        rows={5}
                        value={videoNegativePrompt}
                        onChange={(event) => setVideoNegativePrompt(event.target.value)}
                        placeholder="例如：watermark, blurry, low resolution"
                      />
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
