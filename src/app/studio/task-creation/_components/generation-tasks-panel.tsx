"use client";

import { useMemo, useState } from "react";
import { formatDurationSecondsLabel } from "../../../../lib/duration-format";
import { defaultVideoNegativePrompt } from "../../../../lib/prompt";
import { useVideoTimecode } from "../../../_components/use-video-timecode";
import {
  getVideoTaskStatusMeta,
  type VideoTaskGeneratedVideoRecord,
  type VideoTaskRecord,
} from "../../../../lib/video-task-schema";
import { parseApiResponse } from "./api-response";
import { ModuleTitle } from "./task-ui";

type GenerationSettings = {
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  shotType: string;
  generateAudio: boolean;
  negativePrompt: string;
};

const defaultGenerationSettings: GenerationSettings = {
  durationSeconds: 15,
  aspectRatio: "9:16",
  shotType: "customize",
  generateAudio: false,
  negativePrompt: defaultVideoNegativePrompt,
};

function getGenerationSettings(settings?: GenerationSettings | null): GenerationSettings {
  return settings ?? defaultGenerationSettings;
}

function toCssAspectRatio(aspectRatio: GenerationSettings["aspectRatio"]) {
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

type TaskListRow = {
  taskId: string;
  taskTitle: string;
  createdAt: string;
  typeLabel: string;
  typeTone: "composition" | "live" | "pending";
  statusLabel: string;
  statusTone: "default" | "warning" | "pending";
  videoJobId: string | null;
};

type DeleteTaskResponse = {
  ok?: boolean;
  deletedTaskId?: string;
  error?: string;
  code?: string;
  redirectTo?: string;
};

function formatSecondsLabel(seconds: number | null) {
  return formatDurationSecondsLabel(seconds);
}

function getTaskDurationLabel(task: VideoTaskRecord | null) {
  if (!task) {
    return null;
  }

  const totalDurationSeconds =
    task.directorPlan?.totalDurationSeconds ??
    task.shotPlan?.totalDurationSeconds ??
    task.directorPlan?.storyShots?.reduce((total, shot) => total + Math.max(0, shot.durationSeconds || 0), 0) ??
    null;

  return formatSecondsLabel(totalDurationSeconds);
}

function getStatusLabel(status: VideoTaskGeneratedVideoRecord["status"]) {
  return status === "FAILED" ? "生成失败" : "生成完成";
}

function getTypeLabel(type: VideoTaskGeneratedVideoRecord["type"], generatedTypeLabel: string) {
  return type === "DIRECTOR" ? generatedTypeLabel : "自动生成";
}

function getDisplayTaskTitle(title: string) {
  const characters = Array.from(title.trim());
  if (characters.length <= 8) {
    return title.trim();
  }

  return `${characters.slice(0, 8).join("")}…`;
}

export function GenerationTasksPanel({
  tasks,
  generatedVideos,
  highlightedTaskId,
  draftMode,
  selectedTaskId,
  taskListTitle = "任务列表",
  taskListEyebrow = "任务创建",
  generatedTypeLabel = "工作流生成",
  previewTitle = "预览与参数",
  previewEyebrow = "结果预览",
  emptyPreviewLabel = "视频预览",
  onSelectTask,
  onDeleteTask,
  onError,
}: {
  tasks: VideoTaskRecord[];
  generatedVideos: VideoTaskGeneratedVideoRecord[];
  highlightedTaskId: string;
  draftMode?: boolean;
  selectedTaskId: string;
  taskListTitle?: string;
  taskListEyebrow?: string;
  generatedTypeLabel?: string;
  previewTitle?: string;
  previewEyebrow?: string;
  emptyPreviewLabel?: string;
  onSelectTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onError?: (message: string | null) => void;
}) {
  const [manualActiveTaskId, setManualActiveTaskId] = useState("");
  const [deletingTaskId, setDeletingTaskId] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const activeTaskId = draftMode
    ? ""
    : ((selectedTaskId && tasks.some((task) => task.taskId === selectedTaskId)
        ? selectedTaskId
        : manualActiveTaskId && tasks.some((task) => task.taskId === manualActiveTaskId)
          ? manualActiveTaskId
          : tasks[0]?.taskId) ?? "");

  const generatedVideoMap = useMemo(
    () => new Map(generatedVideos.map((record) => [record.taskId, record])),
    [generatedVideos],
  );

  const rows = useMemo<TaskListRow[]>(
    () =>
      tasks.map((task) => {
        const generatedVideo = generatedVideoMap.get(task.taskId);

        if (!generatedVideo) {
          const taskStatusMeta = getVideoTaskStatusMeta(task.status);

          return {
            taskId: task.taskId,
            taskTitle: task.title,
            createdAt: task.createdAt,
            typeLabel: "待生成",
            typeTone: "pending",
            statusLabel: taskStatusMeta.label,
            statusTone: "default",
            videoJobId: null,
          };
        }

        return {
          taskId: task.taskId,
          taskTitle: task.title,
          createdAt: task.createdAt,
          typeLabel: getTypeLabel(generatedVideo.type, generatedTypeLabel),
          typeTone: generatedVideo.type === "DIRECTOR" ? "composition" : "live",
          statusLabel: getStatusLabel(generatedVideo.status),
          statusTone: generatedVideo.status === "FAILED" ? "warning" : "default",
          videoJobId: generatedVideo.videoJobId,
        };
      }),
    [generatedTypeLabel, generatedVideoMap, tasks],
  );

  const activeRow = useMemo(() => generatedVideoMap.get(activeTaskId) ?? null, [activeTaskId, generatedVideoMap]);
  const activePreviewTimecode = useVideoTimecode(activeRow?.videoUrl ?? null);
  const activeTask = useMemo(() => tasks.find((task) => task.taskId === activeTaskId) ?? null, [activeTaskId, tasks]);
  const effectiveSettings = useMemo(
    () => getGenerationSettings(activeRow?.generationSettings ?? undefined),
    [activeRow?.generationSettings],
  );
  const resolvedVideoDurationLabel = useMemo(
    () => formatSecondsLabel(activeRow?.resolvedDurationSeconds ?? null),
    [activeRow?.resolvedDurationSeconds],
  );
  const taskDurationLabel = useMemo(() => getTaskDurationLabel(activeTask), [activeTask]);
  const videoParameters = useMemo(
    () => [
      {
        label: "时长",
        value:
          taskDurationLabel ??
          resolvedVideoDurationLabel ??
          formatDurationSecondsLabel(effectiveSettings.durationSeconds) ??
          "0 秒",
      },
      {
        label: "存储",
        value: activeRow?.videoUrl?.startsWith("/generated-videos/")
          ? "本地保存"
          : activeRow?.videoUrl
            ? "已生成"
            : "待生成",
      },
      {
        label: "比例",
        value: `${effectiveSettings.aspectRatio} ${effectiveSettings.aspectRatio === "9:16" ? "竖版" : effectiveSettings.aspectRatio === "16:9" ? "横版" : "方版"}`,
      },
      {
        label: "原生音频",
        value: effectiveSettings.generateAudio ? "开启" : "关闭",
      },
      {
        label: "Prompt",
        value: `${(activeRow?.originalPrompt ?? "").trim().length} 字`,
      },
    ],
    [activeRow?.originalPrompt, activeRow?.videoUrl, effectiveSettings, resolvedVideoDurationLabel, taskDurationLabel],
  );

  async function handleDeleteRow(row: TaskListRow) {
    if (deletingTaskId) {
      return;
    }

    setDeletingTaskId(row.taskId);
    setDeleteError(null);
    onError?.(null);

    try {
      const response = await fetch(`/api/video-tasks/${row.taskId}`, { method: "DELETE" });
      const data = await parseApiResponse<DeleteTaskResponse>(response);

      if (response.status === 404) {
        onDeleteTask(row.taskId);
        setManualActiveTaskId((current) => (current === row.taskId ? "" : current));
        if (selectedTaskId === row.taskId) {
          onSelectTask("");
        }
        return;
      }

      if (!response.ok || data.ok === false) {
        const message = data.error ?? `删除任务失败，状态码 ${response.status}`;
        if (response.status === 401 && data.redirectTo && typeof window !== "undefined") {
          setDeleteError(message);
          onError?.(message);
          window.location.assign(data.redirectTo);
          return;
        }
        throw new Error(message);
      }

      onDeleteTask(row.taskId);
      setManualActiveTaskId((current) => (current === row.taskId ? "" : current));
      if (selectedTaskId === row.taskId) {
        onSelectTask("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除任务失败";
      setDeleteError(message);
      onError?.(message);
    } finally {
      setDeletingTaskId("");
    }
  }

  return (
    <div className="dashboard-grid generation-tasks-grid">
      <div className="panel dashboard-list">
        <ModuleTitle
          title={taskListTitle}
          eyebrow={taskListEyebrow}
          level="primary"
          action={<span className="table-meta">{rows.length} 条记录</span>}
        />
        {deleteError ? <div className="error-box compact">{deleteError}</div> : null}

        <div className="table-wrap fixed-table-wrap">
          <table className="task-table jobs-table">
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
              {rows.map((row) => (
                <tr
                  key={row.taskId}
                  className={`${row.taskId === activeTaskId ? "task-table-row-active" : ""} ${row.taskId === highlightedTaskId ? "task-table-row-flash" : ""}`.trim()}
                >
                  <td>
                    <div className="job-id-cell">
                      <span>{row.taskId.slice(0, 8)}...</span>
                      <button
                        className="btn-copy"
                        type="button"
                        aria-label="复制任务 ID"
                        onClick={() => {
                          void navigator.clipboard.writeText(row.taskId);
                          alert("已复制任务 ID");
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
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="task-name-cell">{getDisplayTaskTitle(row.taskTitle)}</td>
                  <td>
                    <span className={`mode-pill ${row.typeTone}`}>{row.typeLabel}</span>
                  </td>
                  <td>
                    <span
                      className={`table-status${row.statusTone === "warning" ? " warning" : row.statusTone === "pending" ? " muted" : ""}`}
                    >
                      {row.statusLabel}
                    </span>
                  </td>
                  <td className="submitted-time-cell">
                    <span>{new Date(row.createdAt).toLocaleDateString("zh-CN")}</span>
                    <strong>{new Date(row.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}</strong>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-pill"
                        type="button"
                        onClick={() => {
                          setManualActiveTaskId(row.taskId);
                          onSelectTask(row.taskId);
                        }}
                      >
                        查看
                      </button>
                      <button
                        className="btn-pill btn-pill-danger"
                        type="button"
                        disabled={Boolean(deletingTaskId)}
                        onClick={() => void handleDeleteRow(row)}
                      >
                        {deletingTaskId === row.taskId ? "删除中..." : "删除"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel preview-panel dashboard-preview">
        <ModuleTitle
          title={previewTitle}
          eyebrow={previewEyebrow}
          level="primary"
          action={
            <div className="action-row">
              {activeRow?.videoUrl ? (
                <a className="btn-secondary small" href={activeRow.videoUrl} download target="_blank" rel="noreferrer">
                  下载视频
                </a>
              ) : null}
            </div>
          }
        />

        <div className="result-layout equal-height-columns">
          <div className="video-frame" style={{ aspectRatio: toCssAspectRatio(effectiveSettings.aspectRatio) }}>
            {activeRow?.videoUrl ? (
              <>
                <video
                  src={activeRow.videoUrl}
                  controls
                  playsInline
                  className="video-player"
                  {...activePreviewTimecode.videoTimecodeProps}
                />
                <div className="video-timecode-badge">{activePreviewTimecode.timecodeLabel}</div>
              </>
            ) : (
              <div className="video-placeholder">
                <span>{activeRow ? (activeRow.error ?? "该任务当前没有可播放视频") : emptyPreviewLabel}</span>
              </div>
            )}
          </div>

          <div className="video-params-panel">
            <div className="video-params-header">
              <p className="eyebrow">视频参数</p>
            </div>

            <div className="video-params-list">
              {videoParameters.map((item) => (
                <div key={item.label} className="video-param-row">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
