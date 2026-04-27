"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  convertSubtitleFontSizeDisplayToRatio,
  getDefaultSubtitleConfig,
  getSubtitleFontSizeDisplayValue,
  getSubtitleFontSizeInputRange,
  getSubtitleOutputTypographyMetrics,
  normalizeSubtitleHexColor,
  subtitleDisplayModeOptions,
  subtitleFontFamilyOptions,
  subtitleHorizontalPositionRatioRange,
  subtitleMaxCharsOptions,
  subtitleOutlineColorSwatches,
  subtitleOutlineWidthRange,
  subtitlePositionOffsetRatioRange,
  subtitleStylePresetOptions,
  subtitleTextColorSwatches,
  type SubtitleRenderAspectRatio,
  type SubtitleConfig,
} from "../../../../lib/subtitle-style-config";
import { normalizeMediaSourceInput } from "../../../../lib/media-source-input";
import {
  compositionBackgroundMusicVolumeOptions,
  normalizeCompositionBackgroundMusicVolume,
  type CompositionBackgroundMusicVolumeLevel,
} from "../../../../lib/task-creation-parameters";

type SubtitleColorTarget = "text" | "outline";

type SubtitleCustomColorsState = {
  text: string[];
  outline: string[];
};

const subtitleCustomColorsStorageKey = "composition-subtitle-custom-colors";

function getSystemDefaultSubtitleConfig() {
  return getDefaultSubtitleConfig();
}

function normalizeStoredSubtitleCustomColors(rawValue: unknown): SubtitleCustomColorsState {
  const input = typeof rawValue === "object" && rawValue ? (rawValue as Partial<SubtitleCustomColorsState>) : {};
  const normalizeList = (value: unknown, fallback: string) =>
    Array.isArray(value)
      ? value
          .map((item) => normalizeSubtitleHexColor(item, fallback))
          .filter((item, index, source) => source.indexOf(item) === index)
          .slice(-3)
      : [];

  return {
    text: normalizeList(input.text, "#FFFFFF"),
    outline: normalizeList(input.outline, "#000000"),
  };
}

function readSubtitleCustomColors(storage: Pick<Storage, "getItem">): SubtitleCustomColorsState {
  try {
    const rawValue = storage.getItem(subtitleCustomColorsStorageKey);
    return rawValue ? normalizeStoredSubtitleCustomColors(JSON.parse(rawValue)) : { text: [], outline: [] };
  } catch {
    return { text: [], outline: [] };
  }
}

function pushCustomSubtitleColor(colors: string[], nextColor: string) {
  if (colors.includes(nextColor)) {
    return colors;
  }

  return [...colors, nextColor].slice(-3);
}

function clampNumeric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ratioToPercent(ratio: number) {
  return Math.round(ratio * 100);
}

function percentToRatio(value: number, range: { min: number; max: number }) {
  return clampNumeric(Number((Math.round(value) / 100).toFixed(4)), range.min, range.max);
}

export function CompositionSettingsPanel({
  includeBackgroundMusic,
  backgroundMusicUrl,
  backgroundMusicVolume,
  subtitleConfig,
  onIncludeBackgroundMusicChange,
  onBackgroundMusicUrlChange,
  onBackgroundMusicVolumeChange,
  onSubtitleConfigChange,
  title = "字幕与背景音设置",
  compact = false,
  subtitleAspectRatio = "9:16",
  previewSlot,
}: {
  includeBackgroundMusic: boolean;
  backgroundMusicUrl: string;
  backgroundMusicVolume: number;
  subtitleConfig: SubtitleConfig;
  onIncludeBackgroundMusicChange: (value: boolean) => void;
  onBackgroundMusicUrlChange: (value: string) => void;
  onBackgroundMusicVolumeChange: (value: CompositionBackgroundMusicVolumeLevel) => void;
  onSubtitleConfigChange: (value: SubtitleConfig) => void;
  title?: string;
  compact?: boolean;
  subtitleAspectRatio?: SubtitleRenderAspectRatio;
  previewSlot?: ReactNode;
}) {
  const [customColors, setCustomColors] = useState<SubtitleCustomColorsState>({ text: [], outline: [] });
  const [isColorPanelOpen, setIsColorPanelOpen] = useState(false);
  const [isBgmVolumeMenuOpen, setIsBgmVolumeMenuOpen] = useState(false);
  const [activeCustomColorTarget, setActiveCustomColorTarget] = useState<SubtitleColorTarget | null>(null);
  const [pendingCustomColor, setPendingCustomColor] = useState("#FFFFFF");
  const colorPanelRef = useRef<HTMLDivElement | null>(null);
  const bgmVolumeMenuRef = useRef<HTMLDivElement | null>(null);

  const subtitleTextColorOptions = useMemo(
    () => [
      ...subtitleTextColorSwatches,
      ...customColors.text.filter((color) => !(subtitleTextColorSwatches as readonly string[]).includes(color)),
    ],
    [customColors.text],
  );
  const subtitleOutlineColorOptions = useMemo(
    () => [
      ...subtitleOutlineColorSwatches,
      ...customColors.outline.filter((color) => !(subtitleOutlineColorSwatches as readonly string[]).includes(color)),
    ],
    [customColors.outline],
  );
  const subtitleOffsetPercent = ratioToPercent(subtitleConfig.positionOffsetRatio);
  const subtitleHorizontalPercent = ratioToPercent(subtitleConfig.horizontalPositionRatio);
  const subtitleOutputTypography = getSubtitleOutputTypographyMetrics(subtitleConfig, subtitleAspectRatio);
  const subtitleDisplayFontSize = getSubtitleFontSizeDisplayValue(subtitleOutputTypography.fontSizePx);
  const normalizedBgmVolume = normalizeCompositionBackgroundMusicVolume(backgroundMusicVolume);
  const subtitleFontSizeRange = useMemo(
    () => getSubtitleFontSizeInputRange(subtitleAspectRatio),
    [subtitleAspectRatio],
  );
  const subtitleOutputFontSizeRange = useMemo(() => {
    const minMetrics = getSubtitleOutputTypographyMetrics(
      {
        ...subtitleConfig,
        fontSizeRatio: convertSubtitleFontSizeDisplayToRatio(subtitleFontSizeRange.min, subtitleAspectRatio),
      },
      subtitleAspectRatio,
    );
    const maxMetrics = getSubtitleOutputTypographyMetrics(
      {
        ...subtitleConfig,
        fontSizeRatio: convertSubtitleFontSizeDisplayToRatio(subtitleFontSizeRange.max, subtitleAspectRatio),
      },
      subtitleAspectRatio,
    );
    return {
      min: minMetrics.fontSizePx,
      max: maxMetrics.fontSizePx,
    };
  }, [subtitleAspectRatio, subtitleConfig, subtitleFontSizeRange.max, subtitleFontSizeRange.min]);
  const [subtitleFontSizeDraft, setSubtitleFontSizeDraft] = useState(() => String(subtitleDisplayFontSize));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setCustomColors(readSubtitleCustomColors(window.localStorage));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(subtitleCustomColorsStorageKey, JSON.stringify(customColors));
  }, [customColors]);

  useEffect(() => {
    setSubtitleFontSizeDraft(String(subtitleDisplayFontSize));
  }, [subtitleDisplayFontSize]);

  useEffect(() => {
    if (!isColorPanelOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!colorPanelRef.current?.contains(event.target as Node)) {
        setIsColorPanelOpen(false);
        setActiveCustomColorTarget(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isColorPanelOpen]);

  useEffect(() => {
    if (!isBgmVolumeMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!bgmVolumeMenuRef.current?.contains(event.target as Node)) {
        setIsBgmVolumeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isBgmVolumeMenuOpen]);

  function updateSubtitleColor(target: SubtitleColorTarget, color: string) {
    onSubtitleConfigChange({
      ...subtitleConfig,
      ...(target === "text" ? { textColor: color } : { outlineColor: color }),
    });
  }

  function commitSubtitleFontSizeDraft(rawValue: string, mode: "change" | "blur") {
    setSubtitleFontSizeDraft(rawValue);
    const trimmed = rawValue.trim();

    if (!trimmed) {
      if (mode === "blur") {
        setSubtitleFontSizeDraft(String(subtitleDisplayFontSize));
      }
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      if (mode === "blur") {
        setSubtitleFontSizeDraft(String(subtitleDisplayFontSize));
      }
      return;
    }

    const rounded = Math.round(parsed);
    const withinRange = rounded >= subtitleFontSizeRange.min && rounded <= subtitleFontSizeRange.max;

    if (mode === "change" && !withinRange) {
      return;
    }

    const nextDisplayFontSize = clampNumeric(rounded, subtitleFontSizeRange.min, subtitleFontSizeRange.max);
    onSubtitleConfigChange({
      ...subtitleConfig,
      fontSizeRatio: convertSubtitleFontSizeDisplayToRatio(nextDisplayFontSize, subtitleAspectRatio),
    });
    setSubtitleFontSizeDraft(String(nextDisplayFontSize));
  }

  function adjustSubtitleFontSize(delta: number) {
    const draftValue = Number(subtitleFontSizeDraft.trim());
    const baseValue = Number.isFinite(draftValue) ? Math.round(draftValue) : subtitleDisplayFontSize;
    const nextValue = clampNumeric(baseValue + delta, subtitleFontSizeRange.min, subtitleFontSizeRange.max);
    commitSubtitleFontSizeDraft(String(nextValue), "change");
  }

  function handleOpenColorPanel() {
    setIsColorPanelOpen((current) => !current);
    setActiveCustomColorTarget(null);
  }

  function handleStartCustomColor(target: SubtitleColorTarget) {
    setActiveCustomColorTarget(target);
    setPendingCustomColor(target === "text" ? subtitleConfig.textColor : subtitleConfig.outlineColor);
  }

  function handleConfirmCustomColor() {
    if (!activeCustomColorTarget) {
      return;
    }

    const fallback = activeCustomColorTarget === "text" ? subtitleConfig.textColor : subtitleConfig.outlineColor;
    const normalizedColor = normalizeSubtitleHexColor(pendingCustomColor, fallback);
    updateSubtitleColor(activeCustomColorTarget, normalizedColor);
    setCustomColors((current) => ({
      ...current,
      [activeCustomColorTarget]: pushCustomSubtitleColor(current[activeCustomColorTarget], normalizedColor),
    }));
    setActiveCustomColorTarget(null);
  }

  return (
    <section className={`task-composition-av-settings${compact ? " task-composition-av-settings--compact" : ""}`}>
      <div className="task-composition-av-shell">
        <div className="task-composition-av-controls">
          <div className="task-composition-av-panel">
            <div className="task-composition-av-toolbar">
              <strong>{title}</strong>
              <button
                className="btn-secondary small task-subtitle-reset-button"
                type="button"
                onClick={() => onSubtitleConfigChange(getSystemDefaultSubtitleConfig())}
              >
                恢复系统默认
              </button>
            </div>

            <div className="task-composition-av-group">
              <div className="task-composition-bgm-row">
                <div className="task-subtitle-setting-field task-composition-bgm-toggle-field">
                  <span>背景音乐</span>
                  <div className="task-composition-bgm-toggle" role="group" aria-label="是否加入背景音乐">
                    <button
                      className={`task-composition-bgm-toggle-button ${!includeBackgroundMusic ? "active" : ""}`}
                      type="button"
                      onClick={() => onIncludeBackgroundMusicChange(false)}
                    >
                      不加入
                    </button>
                    <button
                      className={`task-composition-bgm-toggle-button ${includeBackgroundMusic ? "active" : ""}`}
                      type="button"
                      onClick={() => onIncludeBackgroundMusicChange(true)}
                    >
                      加入
                    </button>
                  </div>
                </div>
                {includeBackgroundMusic ? (
                  <div className="task-subtitle-setting-field task-composition-bgm-volume-field">
                    <span>BGM 音量</span>
                    <div className="task-composition-bgm-volume-menu" ref={bgmVolumeMenuRef}>
                      <button
                        className={`task-composition-bgm-volume-trigger ${isBgmVolumeMenuOpen ? "active" : ""}`}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={isBgmVolumeMenuOpen}
                        onClick={() => setIsBgmVolumeMenuOpen((current) => !current)}
                      >
                        {normalizedBgmVolume === 6 ? "6（推荐）" : normalizedBgmVolume}
                        <span aria-hidden="true">⌄</span>
                      </button>
                      {isBgmVolumeMenuOpen ? (
                        <div className="task-composition-bgm-volume-dropdown" role="menu">
                          {compositionBackgroundMusicVolumeOptions.map((volume) => (
                            <button
                              key={volume}
                              className={`task-composition-bgm-volume-option ${
                                volume === normalizedBgmVolume ? "active" : ""
                              }`}
                              type="button"
                              role="menuitemradio"
                              aria-checked={volume === normalizedBgmVolume}
                              onClick={() => {
                                onBackgroundMusicVolumeChange(volume);
                                setIsBgmVolumeMenuOpen(false);
                              }}
                            >
                              {volume === 6 ? "6（推荐）" : volume}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {includeBackgroundMusic ? (
                  <div className="task-composition-bgm-input-field">
                    <input
                      aria-label="本地路径或在线MP3链接地址"
                      value={backgroundMusicUrl}
                      onChange={(event) => onBackgroundMusicUrlChange(event.target.value)}
                      onBlur={() => {
                        const normalized = normalizeMediaSourceInput(backgroundMusicUrl);
                        if (normalized !== backgroundMusicUrl) {
                          onBackgroundMusicUrlChange(normalized);
                        }
                      }}
                      placeholder="本地路径或在线MP3链接地址"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="task-composition-av-group">
              <div className="task-subtitle-settings-grid">
                <div className="task-subtitle-setting-field">
                  <span>字幕开关</span>
                  <div className="task-composition-bgm-toggle" role="group" aria-label="字幕开关">
                    <button
                      className={`task-composition-bgm-toggle-button ${subtitleConfig.enabled ? "active" : ""}`}
                      type="button"
                      onClick={() => onSubtitleConfigChange({ ...subtitleConfig, enabled: true })}
                    >
                      开启
                    </button>
                    <button
                      className={`task-composition-bgm-toggle-button ${!subtitleConfig.enabled ? "active" : ""}`}
                      type="button"
                      onClick={() => onSubtitleConfigChange({ ...subtitleConfig, enabled: false })}
                    >
                      关闭
                    </button>
                  </div>
                </div>
                <label className="task-subtitle-setting-field">
                  <span>样式预设</span>
                  <select
                    value={subtitleConfig.stylePreset}
                    onChange={(event) =>
                      onSubtitleConfigChange({
                        ...subtitleConfig,
                        stylePreset: event.target.value as SubtitleConfig["stylePreset"],
                      })
                    }
                  >
                    {subtitleStylePresetOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="task-subtitle-setting-field">
                  <span>字体</span>
                  <select
                    value={subtitleConfig.fontFamily}
                    onChange={(event) =>
                      onSubtitleConfigChange({
                        ...subtitleConfig,
                        fontFamily: event.target.value as SubtitleConfig["fontFamily"],
                      })
                    }
                  >
                    {subtitleFontFamilyOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="task-subtitle-setting-field">
                  <span>显示方式</span>
                  <select
                    value={subtitleConfig.displayMode}
                    onChange={(event) =>
                      onSubtitleConfigChange({
                        ...subtitleConfig,
                        displayMode: event.target.value as SubtitleConfig["displayMode"],
                      })
                    }
                  >
                    {subtitleDisplayModeOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="task-subtitle-setting-field">
                  <span>字号</span>
                  <div className="task-subtitle-font-size-wrap">
                    <div className="task-subtitle-number-field task-subtitle-number-field--stepper">
                      <button
                        className="task-subtitle-stepper-button"
                        type="button"
                        aria-label="减小字幕字号"
                        onClick={() => adjustSubtitleFontSize(-subtitleFontSizeRange.step)}
                        disabled={subtitleDisplayFontSize <= subtitleFontSizeRange.min}
                      >
                        -
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label="字幕字号"
                        value={subtitleFontSizeDraft}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) =>
                          commitSubtitleFontSizeDraft(event.target.value.replace(/[^\d]/g, ""), "change")
                        }
                        onBlur={(event) => commitSubtitleFontSizeDraft(event.target.value, "blur")}
                      />
                      <span className="task-subtitle-stepper-unit">号</span>
                      <button
                        className="task-subtitle-stepper-button"
                        type="button"
                        aria-label="增大字幕字号"
                        onClick={() => adjustSubtitleFontSize(subtitleFontSizeRange.step)}
                        disabled={subtitleDisplayFontSize >= subtitleFontSizeRange.max}
                      >
                        +
                      </button>
                    </div>
                    <small className="task-subtitle-number-hint">{`前端字号 ${subtitleFontSizeRange.min}-${subtitleFontSizeRange.max}，成片约 ${subtitleOutputFontSizeRange.min}-${subtitleOutputFontSizeRange.max}px，当前约 ${subtitleOutputTypography.fontSizePx}px`}</small>
                  </div>
                </label>
                <label className="task-subtitle-setting-field">
                  <span>描边宽度</span>
                  <div className="task-subtitle-number-field">
                    <input
                      type="number"
                      min={subtitleOutlineWidthRange.min}
                      max={subtitleOutlineWidthRange.max}
                      step={subtitleOutlineWidthRange.step}
                      value={subtitleConfig.outlineWidth}
                      onChange={(event) =>
                        onSubtitleConfigChange({
                          ...subtitleConfig,
                          outlineWidth: clampNumeric(
                            Number(event.target.value),
                            subtitleOutlineWidthRange.min,
                            subtitleOutlineWidthRange.max,
                          ),
                        })
                      }
                    />
                    <small>px</small>
                  </div>
                </label>
                <label className="task-subtitle-setting-field">
                  <span>字幕左右位置</span>
                  <div className="task-subtitle-number-field">
                    <input
                      type="number"
                      min={ratioToPercent(subtitleHorizontalPositionRatioRange.min)}
                      max={ratioToPercent(subtitleHorizontalPositionRatioRange.max)}
                      step="1"
                      value={subtitleHorizontalPercent}
                      onChange={(event) =>
                        onSubtitleConfigChange({
                          ...subtitleConfig,
                          horizontalPositionRatio: percentToRatio(
                            Number(event.target.value),
                            subtitleHorizontalPositionRatioRange,
                          ),
                        })
                      }
                    />
                    <small>% 距左边</small>
                  </div>
                </label>
                <label className="task-subtitle-setting-field">
                  <span>字幕上下位置</span>
                  <div className="task-subtitle-number-field">
                    <input
                      type="number"
                      min={ratioToPercent(subtitlePositionOffsetRatioRange.min)}
                      max={ratioToPercent(subtitlePositionOffsetRatioRange.max)}
                      step="1"
                      value={subtitleOffsetPercent}
                      onChange={(event) =>
                        onSubtitleConfigChange({
                          ...subtitleConfig,
                          position: "bottom",
                          positionOffsetRatio: percentToRatio(
                            Number(event.target.value),
                            subtitlePositionOffsetRatioRange,
                          ),
                        })
                      }
                    />
                    <small>% 距底部</small>
                  </div>
                </label>
                <label className="task-subtitle-setting-field">
                  <span>每行字数</span>
                  <select
                    value={subtitleConfig.maxCharsPerLine}
                    onChange={(event) =>
                      onSubtitleConfigChange({
                        ...subtitleConfig,
                        maxCharsPerLine: Number(event.target.value) as SubtitleConfig["maxCharsPerLine"],
                      })
                    }
                  >
                    {subtitleMaxCharsOptions.map((item) => (
                      <option key={item} value={item}>
                        {`${item} 字`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="task-subtitle-setting-field task-subtitle-setting-field-wide">
                  <span>颜色</span>
                  <div
                    className={`task-subtitle-color-trigger-wrap ${isColorPanelOpen ? "active" : ""}`}
                    ref={colorPanelRef}
                  >
                    <button
                      className={`task-subtitle-color-trigger ${isColorPanelOpen ? "active" : ""}`}
                      type="button"
                      onClick={handleOpenColorPanel}
                    >
                      <span>颜色设置</span>
                      <span className="task-subtitle-color-trigger-samples" aria-hidden="true">
                        <span
                          className="task-subtitle-color-sample task-subtitle-color-sample--text"
                          style={{ color: subtitleConfig.textColor }}
                        >
                          A
                        </span>
                        <span
                          className="task-subtitle-color-sample task-subtitle-color-sample--outline"
                          style={{ backgroundColor: subtitleConfig.outlineColor }}
                        />
                      </span>
                    </button>
                    {isColorPanelOpen ? (
                      <div className="task-subtitle-color-panel">
                        <div className="task-subtitle-color-panel-section">
                          <span className="task-subtitle-color-panel-title">文字颜色</span>
                          <div className="task-subtitle-swatch-group" role="group" aria-label="字幕文字颜色">
                            {subtitleTextColorOptions.map((color) => (
                              <button
                                key={color}
                                className={`task-subtitle-swatch-button ${subtitleConfig.textColor === color ? "active" : ""}`}
                                type="button"
                                style={{ color }}
                                onClick={() => updateSubtitleColor("text", color)}
                              >
                                A
                              </button>
                            ))}
                            <button
                              className="task-subtitle-swatch-button task-subtitle-swatch-button--add"
                              type="button"
                              onClick={() => handleStartCustomColor("text")}
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <div className="task-subtitle-color-panel-section">
                          <span className="task-subtitle-color-panel-title">描边颜色</span>
                          <div className="task-subtitle-swatch-group" role="group" aria-label="字幕描边颜色">
                            {subtitleOutlineColorOptions.map((color) => (
                              <button
                                key={color}
                                className={`task-subtitle-swatch-button task-subtitle-swatch-button--fill ${subtitleConfig.outlineColor === color ? "active" : ""}`}
                                type="button"
                                style={{ backgroundColor: color }}
                                onClick={() => updateSubtitleColor("outline", color)}
                              />
                            ))}
                            <button
                              className="task-subtitle-swatch-button task-subtitle-swatch-button--add"
                              type="button"
                              onClick={() => handleStartCustomColor("outline")}
                            >
                              +
                            </button>
                          </div>
                        </div>
                        {activeCustomColorTarget ? (
                          <div className="task-subtitle-custom-picker">
                            <input
                              type="color"
                              value={pendingCustomColor}
                              onChange={(event) => setPendingCustomColor(event.target.value.toUpperCase())}
                            />
                            <div className="task-subtitle-custom-picker-actions">
                              <button className="btn-pill small" type="button" onClick={handleConfirmCustomColor}>
                                确定
                              </button>
                              <button
                                className="btn-secondary small"
                                type="button"
                                onClick={() => setActiveCustomColorTarget(null)}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {previewSlot}
      </div>
    </section>
  );
}
