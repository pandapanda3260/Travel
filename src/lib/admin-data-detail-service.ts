import {
  formatDateTime,
  formatLoginType,
  formatUserSecurityAction,
  formatUserStatus,
} from "./auth-display";
import { listAdminActionLogs, listAuthUsers, listRiskBlockEntries, type AdminRole } from "./auth-store";
import { getUserDetailForAdmin, listUsersForAdmin } from "./auth-service";
import type { AdminDataPanel, AdminDataStat, AdminMetricCard } from "./admin-data-service";
import { db } from "./db";
import { listMaterialLibraryItems } from "./material-library-store";
import { listNarrationResults } from "./narration-result-store";
import { getProductArchive, listProductArchives } from "./product-archive-store";
import { getTaskClipNarrationResult, listTaskClipShots } from "./task-clip-store";
import { listTaskVisualImageShots } from "./task-visual-image-store";
import { getVideoComposition, listTaskVideoCompositions, listVideoCompositions } from "./video-composition-store";
import { getVideoJob, listVideoJobs } from "./video-job-store";
import { getMaterialDisplayName, getMaterialStatusMeta, getVideoMaterial, listVideoMaterials } from "./video-material-store";
import { getVideoTask, listVideoTasks } from "./video-task-store";
import { getClonedVoice, listClonedVoices } from "./voice-management-store";

const PAGE_SIZE = 12;
export const ADMIN_DATA_EXPORT_MAX_ROWS = 50000;

export type AdminDataDetailDomain = "users" | "tasks" | "assets" | "system";
export type AdminDataDetailTimeRange = "7d" | "30d" | "90d" | "all";
export type AdminDataDetailLoginType = "all" | "password" | "sms";
export type AdminDataDetailAssetType = "all" | "archive" | "material" | "library" | "voice";
export type AdminDataDetailSystemType = "all" | "job" | "material" | "action" | "risk" | "api" | "provider" | "stage";
export type AdminDataBadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

export type AdminDataDetailFilters = {
  domain: AdminDataDetailDomain;
  keyword: string;
  timeRange: AdminDataDetailTimeRange;
  page: number;
  focus?: string;
  status: string;
  loginType: AdminDataDetailLoginType;
  assetType: AdminDataDetailAssetType;
  systemType: AdminDataDetailSystemType;
};

export type AdminDataFilterOption = {
  value: string;
  label: string;
};

export type AdminDataFilterField = {
  key: "loginType" | "assetType" | "systemType";
  label: string;
  options: AdminDataFilterOption[];
};

export type AdminDataDetailBadge = {
  label: string;
  tone?: AdminDataBadgeTone;
};

export type AdminDataDetailRow = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  badges: AdminDataDetailBadge[];
  sideValue: string;
  sideMeta: string;
  href?: string;
};

export type AdminDataFocusedProfileAction = {
  label: string;
  href: string;
};

export type AdminDataFocusedProfileSectionItem = {
  label: string;
  value: string;
  meta?: string;
  href?: string;
};

export type AdminDataFocusedProfileSection = {
  title: string;
  items: AdminDataFocusedProfileSectionItem[];
};

export type AdminDataFocusedProfile = {
  title: string;
  subtitle: string;
  description: string;
  badges: AdminDataDetailBadge[];
  stats: AdminMetricCard[];
  sections: AdminDataFocusedProfileSection[];
  actions?: AdminDataFocusedProfileAction[];
};

type AdminDataExportRow = Record<string, string | number>;

type DomainRowResult = {
  domainLabel: string;
  resultHint: string;
  rows: Array<{
    timestamp: number;
    display: AdminDataDetailRow;
    exportRow: AdminDataExportRow;
  }>;
  statusOptions: AdminDataFilterOption[];
  secondaryField?: AdminDataFilterField;
  exportHeaders: string[];
};

export type AdminDataDetailSnapshot = {
  filters: AdminDataDetailFilters;
  domainLabel: string;
  stats: AdminDataStat[];
  panels: AdminDataPanel[];
  rows: AdminDataDetailRow[];
  focusedProfile: AdminDataFocusedProfile | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rangeLabel: string;
  statusOptions: AdminDataFilterOption[];
  secondaryField?: AdminDataFilterField;
  summaryText: string;
  exportPageHref: string;
  directExportHref: string;
  exceedsExportLimit: boolean;
};

export type AdminDataExportPayload = {
  filters: AdminDataDetailFilters;
  domainLabel: string;
  fileName: string;
  headers: string[];
  rows: AdminDataExportRow[];
};

function readSearchValue(
  source:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | undefined,
  key: string,
) {
  if (!source) {
    return undefined;
  }
  if (source instanceof URLSearchParams) {
    return source.get(key) ?? undefined;
  }
  const value = source[key];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeDomain(value: string | undefined): AdminDataDetailDomain {
  return value === "users" || value === "assets" || value === "system" ? value : "tasks";
}

function normalizeTimeRange(value: string | undefined): AdminDataDetailTimeRange {
  return value === "7d" || value === "90d" || value === "all" ? value : "30d";
}

function normalizePage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function normalizeLoginType(value: string | undefined): AdminDataDetailLoginType {
  return value === "password" || value === "sms" ? value : "all";
}

function normalizeAssetType(value: string | undefined): AdminDataDetailAssetType {
  return value === "archive" || value === "material" || value === "library" || value === "voice" ? value : "all";
}

function normalizeSystemType(value: string | undefined): AdminDataDetailSystemType {
  return value === "job" ||
    value === "material" ||
    value === "action" ||
    value === "risk" ||
    value === "api" ||
    value === "provider" ||
    value === "stage"
    ? value
    : "all";
}

export function parseAdminDataDetailFilters(
  source?: URLSearchParams | Record<string, string | string[] | undefined>,
): AdminDataDetailFilters {
  return {
    domain: normalizeDomain(readSearchValue(source, "domain")),
    keyword: readSearchValue(source, "keyword")?.trim() ?? "",
    timeRange: normalizeTimeRange(readSearchValue(source, "timeRange")),
    page: normalizePage(readSearchValue(source, "page")),
    focus: readSearchValue(source, "focus")?.trim() || undefined,
    status: readSearchValue(source, "status")?.trim() || "all",
    loginType: normalizeLoginType(readSearchValue(source, "loginType")),
    assetType: normalizeAssetType(readSearchValue(source, "assetType")),
    systemType: normalizeSystemType(readSearchValue(source, "systemType")),
  };
}

export function buildAdminDataDetailsQueryString(
  filters: AdminDataDetailFilters,
  overrides?: Partial<AdminDataDetailFilters>,
) {
  const nextFilters = {
    ...filters,
    ...overrides,
  };
  const params = new URLSearchParams();
  params.set("domain", nextFilters.domain);
  params.set("timeRange", nextFilters.timeRange);
  params.set("page", `${nextFilters.page}`);
  if (nextFilters.focus) {
    params.set("focus", nextFilters.focus);
  }
  if (nextFilters.keyword) {
    params.set("keyword", nextFilters.keyword);
  }
  if (nextFilters.status !== "all") {
    params.set("status", nextFilters.status);
  }
  if (nextFilters.loginType !== "all") {
    params.set("loginType", nextFilters.loginType);
  }
  if (nextFilters.assetType !== "all") {
    params.set("assetType", nextFilters.assetType);
  }
  if (nextFilters.systemType !== "all") {
    params.set("systemType", nextFilters.systemType);
  }
  return params.toString();
}

function isAdminDataDetailFilters(value: unknown): value is AdminDataDetailFilters {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AdminDataDetailFilters>;
  return (
      typeof candidate.domain === "string" &&
      typeof candidate.keyword === "string" &&
      typeof candidate.timeRange === "string" &&
      typeof candidate.page === "number" &&
      (candidate.focus === undefined || typeof candidate.focus === "string") &&
      typeof candidate.status === "string" &&
      typeof candidate.loginType === "string" &&
      typeof candidate.assetType === "string" &&
    typeof candidate.systemType === "string"
  );
}

function resolveAdminDataDetailFilters(
  input?: URLSearchParams | Record<string, string | string[] | undefined> | AdminDataDetailFilters,
) {
  if (isAdminDataDetailFilters(input)) {
    return input;
  }
  return parseAdminDataDetailFilters(
    input as URLSearchParams | Record<string, string | string[] | undefined> | undefined,
  );
}

function buildHref(pathname: string, filters: AdminDataDetailFilters, overrides?: Partial<AdminDataDetailFilters>) {
  return `${pathname}?${buildAdminDataDetailsQueryString(filters, overrides)}`;
}

function buildDetailsFocusHref(filters: AdminDataDetailFilters, focus: string) {
  return buildHref("/admin/data/details", filters, {
    focus,
  });
}

function getTimeRangeLabel(range: AdminDataDetailTimeRange) {
  switch (range) {
    case "7d":
      return "近 7 天";
    case "90d":
      return "近 90 天";
    case "all":
      return "全部时间";
    default:
      return "近 30 天";
  }
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

type ApiRequestLogRow = {
  requestId: string;
  routePath: string;
  method: string;
  actorType: string;
  actorId: string | null;
  statusCode: number;
  durationMs: number;
  createdAt: string;
};

type ProviderCallLogRow = {
  callId: string;
  serviceName: string;
  provider: string | null;
  modelId: string | null;
  objectType: string | null;
  objectId: string | null;
  success: number;
  durationMs: number | null;
  errorCode: string | null;
  createdAt: string;
};

type TaskStageRunRow = {
  runId: string;
  taskId: string;
  stageKey: string;
  status: string;
  provider: string | null;
  modelId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
};

function formatDurationMs(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "耗时未知";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }
  return `${Math.round(value)}ms`;
}

function listApiRequestLogs() {
  return db
    .prepare(
      `
        SELECT
          request_id AS requestId,
          route_path AS routePath,
          method AS method,
          actor_type AS actorType,
          actor_id AS actorId,
          status_code AS statusCode,
          duration_ms AS durationMs,
          created_at AS createdAt
        FROM analytics_api_request_log
        ORDER BY created_at DESC
      `,
    )
    .all() as ApiRequestLogRow[];
}

function listProviderCallLogs() {
  return db
    .prepare(
      `
        SELECT
          call_id AS callId,
          service_name AS serviceName,
          provider AS provider,
          model_id AS modelId,
          object_type AS objectType,
          object_id AS objectId,
          success AS success,
          duration_ms AS durationMs,
          error_code AS errorCode,
          created_at AS createdAt
        FROM analytics_provider_call_log
        ORDER BY created_at DESC
      `,
    )
    .all() as ProviderCallLogRow[];
}

function listTaskStageRuns() {
  return db
    .prepare(
      `
        SELECT
          run_id AS runId,
          task_id AS taskId,
          stage_key AS stageKey,
          status AS status,
          provider AS provider,
          model_id AS modelId,
          started_at AS startedAt,
          finished_at AS finishedAt,
          duration_ms AS durationMs,
          error_message AS errorMessage
        FROM analytics_task_stage_run
        ORDER BY COALESCE(finished_at, started_at) DESC
      `,
    )
    .all() as TaskStageRunRow[];
}

function isWithinTimeRange(value: string | null | undefined, range: AdminDataDetailTimeRange) {
  if (range === "all") {
    return true;
  }
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return false;
  }
  const now = Date.now();
  const days = range === "7d" ? 7 : 90;
  const rangeDays = range === "30d" ? 30 : days;
  return now - timestamp <= rangeDays * 24 * 60 * 60 * 1000;
}

function includesKeyword(haystacks: Array<string | null | undefined>, keyword: string) {
  if (!keyword) {
    return true;
  }
  const normalizedKeyword = keyword.toLowerCase();
  return haystacks.some((item) => item?.toLowerCase().includes(normalizedKeyword));
}

function buildStatusTone(value: string): AdminDataBadgeTone {
  if (
    value.includes("失败") ||
    value.includes("FAILED") ||
    value.includes("error") ||
    value.includes("异常") ||
    value.includes("封禁")
  ) {
    return "danger";
  }
  if (
    value.includes("待") ||
    value.includes("处理中") ||
    value.includes("PENDING") ||
    value.includes("TRAINING") ||
    value.includes("QUEUED")
  ) {
    return "warning";
  }
  if (
    value.includes("完成") ||
    value.includes("READY") ||
    value.includes("SUCCESS") ||
    value.includes("ACTIVE") ||
    value.includes("正常")
  ) {
    return "success";
  }
  if (value.includes("短信") || value.includes("password") || value.includes("system")) {
    return "info";
  }
  return "neutral";
}

function buildGenericStats(
  filters: AdminDataDetailFilters,
  domainLabel: string,
  total: number,
  totalPages: number,
  exceedsExportLimit: boolean,
): AdminDataStat[] {
  return [
    {
      label: "当前数据域",
      value: domainLabel,
      meta: "统一明细查询入口",
      tone: "primary",
    },
    {
      label: "匹配记录",
      value: `${total}`,
      meta: `当前筛选下共 ${total} 条`,
      tone: "success",
    },
    {
      label: "时间范围",
      value: getTimeRangeLabel(filters.timeRange),
      meta: "默认按最近时间倒序",
      tone: "neutral",
    },
    {
      label: "导出状态",
      value: exceedsExportLimit ? "需缩小范围" : "可导出",
      meta: exceedsExportLimit ? `超出 ${ADMIN_DATA_EXPORT_MAX_ROWS} 行上限` : `共 ${totalPages} 页结果`,
      tone: exceedsExportLimit ? "warning" : "success",
    },
  ];
}

function buildGenericPanels(
  filters: AdminDataDetailFilters,
  domainLabel: string,
  resultHint: string,
  total: number,
  totalPages: number,
  exceedsExportLimit: boolean,
): AdminDataPanel[] {
  const keywordLabel = filters.keyword || "未设置";
  return [
    {
      title: "筛选摘要",
      hint: "当前查询条件",
      items: [
        { label: "数据域", value: domainLabel, meta: "统一明细页承接" },
        { label: "关键词", value: keywordLabel, meta: "支持按核心标识与名称匹配" },
        { label: "时间范围", value: getTimeRangeLabel(filters.timeRange), meta: resultHint },
        { label: "状态条件", value: filters.status === "all" ? "全部" : filters.status, meta: "按当前域口径解析" },
      ],
    },
    {
      title: "导出与分页",
      hint: "P0 规则",
      items: [
        { label: "匹配记录", value: `${total} 条`, meta: `分页后共 ${totalPages} 页` },
        { label: "单次导出", value: `${ADMIN_DATA_EXPORT_MAX_ROWS} 行`, meta: exceedsExportLimit ? "当前结果已超上限" : "当前结果可直接导出" },
        { label: "脱敏策略", value: "默认开启", meta: "手机号 / IP / 原始内容保持克制" },
        { label: "导出留痕", value: "已记录", meta: "导出中心可回看历史任务" },
      ],
    },
  ];
}

function formatTextValue(value: string | number | boolean | null | undefined, fallback = "--") {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  const text = String(value).trim();
  return text ? text : fallback;
}

function truncateText(value: string | null | undefined, maxLength = 88) {
  const text = value?.trim() ?? "";
  if (!text) {
    return "暂无";
  }
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}…` : chars.join("");
}

function canViewSensitiveAdminData(role: AdminRole) {
  return role === "super_admin";
}

function maskIpAddress(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!text) {
    return "暂无";
  }

  if (text.includes(".")) {
    const parts = text.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.***.***`;
    }
  }

  if (text.includes(":")) {
    const parts = text.split(":").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}:*:*`;
    }
  }

  const chars = Array.from(text);
  if (chars.length <= 6) {
    return `${chars.slice(0, 2).join("")}***`;
  }
  return `${chars.slice(0, 3).join("")}***${chars.slice(-2).join("")}`;
}

function maskPhoneNumber(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!text) {
    return "暂无";
  }
  if (text.length < 7) {
    return `${text.slice(0, 2)}***`;
  }
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function maskSensitiveText(value: string | null | undefined, role: AdminRole, kind: "ip" | "phone") {
  if (canViewSensitiveAdminData(role)) {
    return formatTextValue(value);
  }
  return kind === "phone" ? maskPhoneNumber(value) : maskIpAddress(value);
}

function maskRiskValue(value: string, type: "phone" | "ip", role: AdminRole) {
  if (canViewSensitiveAdminData(role)) {
    return value;
  }
  return type === "phone" ? maskPhoneNumber(value) : maskIpAddress(value);
}

function sanitizeRestrictedText(
  value: string | null | undefined,
  role: AdminRole,
  options: {
    hiddenText: string;
    emptyText?: string;
    maxLength?: number;
  },
) {
  const text = value?.trim() ?? "";
  if (!text) {
    return options.emptyText ?? "暂无";
  }
  if (canViewSensitiveAdminData(role)) {
    return truncateText(text, options.maxLength ?? 88);
  }
  return options.hiddenText;
}

function sanitizeRestrictedError(value: string | null | undefined, role: AdminRole, emptyText = "运行正常") {
  return sanitizeRestrictedText(value, role, {
    hiddenText: "错误详情已隐藏",
    emptyText,
    maxLength: 72,
  });
}

function sanitizeRestrictedPrompt(value: string | null | undefined, role: AdminRole, emptyText = "暂无") {
  return sanitizeRestrictedText(value, role, {
    hiddenText: "仅超级管理员可查看提示词",
    emptyText,
    maxLength: 96,
  });
}

function sanitizeRestrictedContent(value: string | null | undefined, role: AdminRole, emptyText = "暂无") {
  return sanitizeRestrictedText(value, role, {
    hiddenText: "仅超级管理员可查看原文",
    emptyText,
    maxLength: 80,
  });
}

function buildFocusedUserProfile(userId: string, role: AdminRole): AdminDataFocusedProfile | null {
  try {
    const detail = getUserDetailForAdmin(userId);
    const loginSummary =
      detail.summary.loginMethods.length > 0 ? detail.summary.loginMethods.map(formatLoginType).join(" / ") : "暂无登录方式";
    return {
      title: detail.summary.nickname,
      subtitle: `用户画像 · ${detail.summary.userId}`,
      description: `${detail.summary.maskedPhone ?? "未绑定手机号"} · ${loginSummary}`,
      badges: [
        { label: formatUserStatus(detail.summary.status), tone: buildStatusTone(formatUserStatus(detail.summary.status)) },
        ...detail.summary.loginMethods.map((item) => ({
          label: formatLoginType(item),
          tone: "info" as const,
        })),
      ],
      actions: [
        { label: "查看运营详情", href: `/admin/users/${detail.summary.userId}` },
      ],
      stats: [
        {
          label: "活跃会话",
          value: `${detail.sessions.length}`,
          meta: detail.sessions[0] ? `最近 ${formatDateTime(detail.sessions[0].lastSeenAt ?? detail.sessions[0].createdAt)}` : "当前无有效会话",
          tone: detail.sessions.length > 0 ? "success" : "neutral",
        },
        {
          label: "登录记录",
          value: `${detail.recentLogins.length}`,
          meta: detail.recentLogins[0] ? `${formatLoginType(detail.recentLogins[0].loginType)} · ${formatDateTime(detail.recentLogins[0].createdAt)}` : "暂无登录记录",
          tone: "primary",
        },
        {
          label: "安全操作",
          value: `${detail.securityLogs.length}`,
          meta: detail.securityLogs[0] ? `${formatUserSecurityAction(detail.securityLogs[0].actionType)} · ${formatDateTime(detail.securityLogs[0].createdAt)}` : "暂无安全记录",
          tone: "warning",
        },
        {
          label: "绑定情况",
          value: `${detail.accounts.length} 账号 / ${detail.phones.length} 手机`,
          meta: detail.summary.hasPassword ? "已设置密码" : "尚未设置密码",
          tone: "neutral",
        },
      ],
      sections: [
        {
          title: "基础信息",
          items: [
            { label: "注册时间", value: formatDateTime(detail.summary.createdAt) },
            { label: "最近登录", value: formatDateTime(detail.summary.lastLoginAt) },
            { label: "最近 IP", value: maskSensitiveText(detail.summary.lastLoginIp, role, "ip") },
            { label: "计划等级", value: formatTextValue(detail.summary.planLevel) },
            { label: "配额范围", value: formatTextValue(detail.summary.quotaScope) },
            { label: "认证标签", value: formatTextValue(detail.summary.certificationLabel) },
          ],
        },
        {
          title: "最近登录",
          items: detail.recentLogins.slice(0, 4).map((item) => ({
            label: formatLoginType(item.loginType),
            value: item.success ? "成功" : "失败",
            meta: `${formatDateTime(item.createdAt)} · ${maskSensitiveText(item.ip, role, "ip")} · ${truncateText(item.detail, 42)}`,
          })),
        },
        {
          title: "安全动作",
          items: detail.securityLogs.slice(0, 4).map((item) => ({
            label: formatUserSecurityAction(item.actionType),
            value: formatDateTime(item.createdAt),
            meta: `${maskSensitiveText(item.ip, role, "ip")} · ${truncateText(item.detail, 42)}`,
          })),
        },
      ],
    };
  } catch {
    return null;
  }
}

function buildFocusedTaskProfile(taskId: string, role: AdminRole): AdminDataFocusedProfile | null {
  const task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  const jobs = listVideoJobs().filter((item) => item.sourceTaskId === taskId);
  const failedJobs = jobs.filter((item) => item.status === "FAILED");
  const clipShots = listTaskClipShots(taskId);
  const visualShots = listTaskVisualImageShots(taskId);
  const narrationResult = getTaskClipNarrationResult(taskId, task);
  const narrationRecords = listNarrationResults().filter((item) => item.taskId === taskId);
  const compositions = listTaskVideoCompositions(taskId);
  const selectedVisualCount = visualShots.filter((item) => Boolean(item.selectedCandidateId)).length;
  const lipSyncCount = clipShots.filter((item) => Boolean(item.lipSyncJobId)).length;

  return {
    title: task.title,
    subtitle: `任务画像 · ${task.taskId}`,
    description: `${task.parameters.video.videoType} · ${task.status} · ${task.source.productInfoTitle || task.source.videoMaterialName || "未绑定来源"}`,
    badges: [
      { label: task.status, tone: buildStatusTone(task.status) },
      { label: task.parameters.video.videoType, tone: "info" },
    ],
    actions: [
      { label: "打开创作页", href: `/studio/task-creation?taskId=${encodeURIComponent(task.taskId)}` },
      { label: "查看镜头详情", href: `/studio/task-creation/${encodeURIComponent(task.taskId)}/shot-plan` },
    ],
    stats: [
      {
        label: "片段记录",
        value: `${clipShots.length}`,
        meta: lipSyncCount > 0 ? `其中口型同步 ${lipSyncCount}` : "当前无口型同步片段",
        tone: "primary",
      },
      {
        label: "视觉镜头",
        value: `${visualShots.length}`,
        meta: `已选中 ${selectedVisualCount}`,
        tone: "success",
      },
      {
        label: "运行作业",
        value: `${jobs.length}`,
        meta: failedJobs.length > 0 ? `失败 ${failedJobs.length}` : "当前无失败作业",
        tone: failedJobs.length > 0 ? "warning" : "neutral",
      },
      {
        label: "成片项目",
        value: `${compositions.length}`,
        meta: compositions[0] ? `最新 ${compositions[0].status}` : "尚未发起合成",
        tone: compositions.some((item) => item.status === "COMPLETED") ? "success" : "neutral",
      },
    ],
    sections: [
      {
        title: "任务信息",
        items: [
          { label: "创建时间", value: formatDateTime(task.createdAt) },
          { label: "更新时间", value: formatDateTime(task.updatedAt) },
          { label: "归属用户", value: formatTextValue(task.ownerUserId) },
          { label: "目标片段数", value: `${task.parameters.video.segmentCount}` },
          { label: "来源商品", value: formatTextValue(task.source.productInfoTitle) },
          { label: "来源素材", value: formatTextValue(task.source.videoMaterialName) },
        ],
      },
      {
        title: "阶段产物",
        items: [
          { label: "解说结果", value: `${narrationRecords.length}`, meta: narrationResult ? `总时长 ${narrationResult.totalDurationSeconds}s` : "尚未生成解说" },
          { label: "视觉镜头", value: `${visualShots.length}`, meta: `已选 ${selectedVisualCount}` },
          { label: "片段记录", value: `${clipShots.length}`, meta: lipSyncCount > 0 ? `口型 ${lipSyncCount}` : "未触发口型" },
          {
            label: "合成项目",
            value: `${compositions.length}`,
            meta: compositions[0] ? sanitizeRestrictedError(compositions[0].error, role, "暂无异常") : "暂无合成记录",
          },
        ],
      },
      {
        title: "最近作业",
        items: jobs.slice(0, 4).map((item) => ({
          label: item.taskName || item.jobId,
          value: item.status,
          meta: `${item.provider ?? item.mode} · ${formatDateTime(item.updatedAt || item.submittedAt)}`,
        })),
      },
    ],
  };
}

function buildFocusedAssetProfile(focus: string, role: AdminRole): AdminDataFocusedProfile | null {
  if (focus.startsWith("archive:")) {
    const archiveId = focus.replace(/^archive:/, "");
    const archive = getProductArchive(archiveId);
    if (!archive) {
      return null;
    }
    return {
      title: archive.title,
      subtitle: `商品档案 · ${archive.archiveId}`,
      description: archive.parsedText.trim() ? sanitizeRestrictedContent(archive.parsedText, role, "尚未完成结构化解析") : "尚未完成结构化解析",
      badges: [
        { label: "商品档案", tone: "info" },
        { label: archive.parsedText.trim() ? "已解析" : "待解析", tone: archive.parsedText.trim() ? "success" : "warning" },
      ],
      actions: [{ label: "商品信息页", href: "/assets/product-info" }],
      stats: [
        { label: "标签数", value: `${archive.parsedData.tags.length}`, meta: "结构化标签", tone: "primary" },
        { label: "卖点数", value: `${archive.parsedData.sellingPoints.length}`, meta: "卖点提炼", tone: "success" },
        { label: "商品图", value: archive.sourceImageUrl ? "已上传" : "未上传", meta: formatTextValue(archive.sourceImageFileName), tone: "neutral" },
        { label: "归属用户", value: formatTextValue(archive.ownerUserId), meta: `创建 ${formatDateTime(archive.createdAt)}`, tone: "warning" },
      ],
      sections: [
        {
          title: "解析结果",
          items: [
            { label: "摘要标题", value: formatTextValue(archive.parsedData.summaryTitle) },
            { label: "商品名称", value: formatTextValue(archive.keyInfo.productName) },
            { label: "套餐人数", value: formatTextValue(archive.keyInfo.packagePersonCount) },
            { label: "更新时间", value: formatDateTime(archive.updatedAt) },
          ],
        },
        {
          title: "内容概览",
          items: [
            { label: "标签", value: archive.parsedData.tags.join(" / ") || "暂无" },
            { label: "卖点", value: archive.parsedData.sellingPoints.join(" / ") || "暂无" },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("material:")) {
    const materialId = focus.replace(/^material:/, "");
    const material = getVideoMaterial(materialId);
    if (!material) {
      return null;
    }
    return {
      title: getMaterialDisplayName(material),
      subtitle: `视频素材 · ${material.materialId}`,
      description: sanitizeRestrictedError(material.statusMessage, role, "暂无状态说明"),
      badges: [
        { label: "视频素材", tone: "info" },
        { label: getMaterialStatusMeta(material.status).label, tone: buildStatusTone(getMaterialStatusMeta(material.status).label) },
      ],
      actions: [{ label: "素材页", href: "/assets/video-materials" }],
      stats: [
        { label: "处理模式", value: material.processingMode, meta: `状态 ${material.status}`, tone: "primary" },
        { label: "关键帧数量", value: `${material.framesExtracted}`, meta: formatTextValue(material.videoAnalysisCompletedAt ? "分析完成" : "待分析"), tone: "success" },
        { label: "字幕摘要", value: `${Array.from(material.subtitle || "").length}`, meta: "字幕字符数", tone: "neutral" },
        { label: "归属用户", value: formatTextValue(material.ownerUserId), meta: `创建 ${formatDateTime(material.createdAt)}`, tone: "warning" },
      ],
      sections: [
        {
          title: "素材信息",
          items: [
            { label: "视频文件", value: formatTextValue(material.videoFileName) },
            { label: "音频文件", value: formatTextValue(material.audioFileName) },
            { label: "原始转写", value: sanitizeRestrictedContent(material.rawTranscript, role) },
            { label: "反推脚本", value: sanitizeRestrictedContent(material.contentScript, role) },
          ],
        },
        {
          title: "处理产物",
          items: [
            { label: "视频分析", value: sanitizeRestrictedContent(material.videoAnalysis, role) },
            { label: "模板提示词", value: sanitizeRestrictedPrompt(material.videoTemplatePrompt, role) },
            { label: "reverse prompt", value: sanitizeRestrictedPrompt(material.reversePrompt, role) },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("library:")) {
    const libraryId = focus.replace(/^library:/, "");
    const item = listMaterialLibraryItems().find((record) => record.materialId === libraryId);
    if (!item) {
      return null;
    }
    return {
      title: item.title,
      subtitle: `素材归档 · ${item.materialId}`,
      description: sanitizeRestrictedPrompt(item.prompt, role, "暂无提示词"),
      badges: [
        { label: "素材归档", tone: "info" },
        { label: item.type, tone: "neutral" },
      ],
      actions: [{ label: "素材页", href: "/admin/data/assets" }],
      stats: [
        { label: "来源", value: item.sourceLabel, meta: item.source, tone: "primary" },
        { label: "比例", value: formatTextValue(item.aspectRatio), meta: `${formatTextValue(item.width)} × ${formatTextValue(item.height)}`, tone: "success" },
        { label: "时长", value: item.durationSeconds ? `${item.durationSeconds}s` : "—", meta: item.type === "video" ? "视频素材" : "图片素材", tone: "neutral" },
        { label: "标签数", value: `${item.tags.length}`, meta: `入库 ${formatDateTime(item.addedAt)}`, tone: "warning" },
      ],
      sections: [
        {
          title: "归档信息",
          items: [
            { label: "预览链接", value: truncateText(item.previewUrl, 52) },
            { label: "资源链接", value: truncateText(item.assetUrl, 52) },
            { label: "Source Session", value: item.sourceSessionId },
          ],
        },
        {
          title: "标签与提示词",
          items: [
            { label: "标签", value: item.tags.join(" / ") || "暂无" },
            { label: "提示词", value: sanitizeRestrictedPrompt(item.prompt, role) },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("voice:")) {
    const cloneId = focus.replace(/^voice:/, "");
    const voice = getClonedVoice(cloneId);
    if (!voice) {
      return null;
    }
    return {
      title: voice.title,
      subtitle: `克隆音色 · ${voice.cloneId}`,
      description: `${voice.speakerId} · ${voice.language.toUpperCase()} · ${sanitizeRestrictedError(voice.error, role, "状态正常")}`,
      badges: [
        { label: "克隆音色", tone: "info" },
        { label: voice.status, tone: buildStatusTone(voice.status) },
      ],
      actions: [{ label: "音色页", href: "/assets/voice-management" }],
      stats: [
        { label: "模型版本", value: `v${voice.modelType}`, meta: voice.trainingVersion || "训练版本未标注", tone: "primary" },
        { label: "语言", value: voice.language.toUpperCase(), meta: voice.sourceFormat.toUpperCase(), tone: "success" },
        { label: "试听音频", value: voice.demoAudioUrl ? "已生成" : "暂无", meta: formatDateTime(voice.updatedAt), tone: "neutral" },
        { label: "归属用户", value: formatTextValue(voice.ownerUserId), meta: voice.alias || "未设置别名", tone: "warning" },
      ],
      sections: [
        {
          title: "音色信息",
          items: [
            { label: "Speaker ID", value: voice.speakerId },
            { label: "创建时间", value: formatDateTime(voice.createdAt) },
            { label: "更新时间", value: formatDateTime(voice.updatedAt) },
            { label: "错误信息", value: sanitizeRestrictedError(voice.error, role, "状态正常") },
          ],
        },
      ],
    };
  }

  return null;
}

function buildFocusedSystemProfile(focus: string, role: AdminRole): AdminDataFocusedProfile | null {
  if (focus.startsWith("api:")) {
    const requestId = focus.replace(/^api:/, "");
    const requestLog = listApiRequestLogs().find((item) => item.requestId === requestId);
    if (!requestLog) {
      return null;
    }
    return {
      title: `${requestLog.method} ${requestLog.routePath}`,
      subtitle: `API 请求 · ${requestLog.requestId}`,
      description: `${requestLog.actorType}${requestLog.actorId ? ` · ${requestLog.actorId}` : ""}`,
      badges: [
        { label: "API 请求", tone: "info" },
        { label: `${requestLog.statusCode}`, tone: requestLog.statusCode >= 400 ? "danger" : "success" },
      ],
      stats: [
        { label: "状态码", value: `${requestLog.statusCode}`, meta: formatDateTime(requestLog.createdAt), tone: requestLog.statusCode >= 400 ? "warning" : "success" },
        { label: "耗时", value: formatDurationMs(requestLog.durationMs), meta: requestLog.method, tone: "primary" },
        { label: "身份类型", value: requestLog.actorType, meta: formatTextValue(requestLog.actorId), tone: "neutral" },
      ],
      sections: [
        {
          title: "请求信息",
          items: [
            { label: "Request ID", value: requestLog.requestId },
            { label: "路由", value: requestLog.routePath },
            { label: "发生时间", value: formatDateTime(requestLog.createdAt) },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("job:")) {
    const jobId = focus.replace(/^job:/, "");
    const job = getVideoJob(jobId);
    if (!job) {
      return null;
    }
    return {
      title: job.taskName || job.jobId,
      subtitle: `视频作业 · ${job.jobId}`,
      description: `${job.provider ?? job.mode} · ${job.modelId ?? "unknown-model"} · ${sanitizeRestrictedError(job.error, role, "运行正常")}`,
      badges: [
        { label: "作业", tone: "info" },
        { label: job.status, tone: buildStatusTone(job.status) },
      ],
      actions: job.sourceTaskId ? [{ label: "查看任务画像", href: buildDetailsFocusHref({ domain: "tasks", keyword: "", timeRange: "30d", page: 1, status: "all", loginType: "all", assetType: "all", systemType: "all" }, job.sourceTaskId) }] : undefined,
      stats: [
        { label: "提交时间", value: formatDateTime(job.submittedAt), meta: job.mode, tone: "primary" },
        { label: "更新时间", value: formatDateTime(job.updatedAt), meta: job.provider ?? "unknown-provider", tone: "success" },
        { label: "来源任务", value: formatTextValue(job.sourceTaskId), meta: job.modelId ?? "unknown-model", tone: "neutral" },
      ],
      sections: [
        {
          title: "作业详情",
          items: [
            { label: "Job ID", value: job.jobId },
            { label: "错误信息", value: sanitizeRestrictedError(job.error, role, "运行正常") },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("provider:")) {
    const callId = focus.replace(/^provider:/, "");
    const providerCall = listProviderCallLogs().find((item) => item.callId === callId);
    if (!providerCall) {
      return null;
    }
    return {
      title: providerCall.serviceName,
      subtitle: `Provider 调用 · ${providerCall.callId}`,
      description: `${providerCall.provider ?? "provider"} · ${providerCall.modelId ?? "unknown-model"}`,
      badges: [
        { label: "Provider", tone: "info" },
        { label: providerCall.success === 1 ? "SUCCESS" : "FAILED", tone: providerCall.success === 1 ? "success" : "danger" },
      ],
      stats: [
        { label: "耗时", value: providerCall.success === 1 ? formatDurationMs(providerCall.durationMs) : "失败", meta: formatDateTime(providerCall.createdAt), tone: "primary" },
        { label: "对象类型", value: formatTextValue(providerCall.objectType), meta: formatTextValue(providerCall.objectId), tone: "neutral" },
        { label: "错误码", value: formatTextValue(providerCall.errorCode), meta: providerCall.provider ?? "provider", tone: "warning" },
      ],
      sections: [
        {
          title: "调用详情",
          items: [
            { label: "Call ID", value: providerCall.callId },
            { label: "模型", value: formatTextValue(providerCall.modelId) },
            { label: "发生时间", value: formatDateTime(providerCall.createdAt) },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("stage:")) {
    const runId = focus.replace(/^stage:/, "");
    const stageRun = listTaskStageRuns().find((item) => item.runId === runId);
    if (!stageRun) {
      return null;
    }
    return {
      title: stageRun.stageKey,
      subtitle: `阶段运行 · ${stageRun.taskId}`,
      description: `${stageRun.provider ?? "provider"} · ${stageRun.modelId ?? "unknown-model"}`,
      badges: [
        { label: "Stage Run", tone: "info" },
        { label: stageRun.status, tone: buildStatusTone(stageRun.status) },
      ],
      actions: [
        { label: "查看任务画像", href: buildDetailsFocusHref({ domain: "tasks", keyword: "", timeRange: "30d", page: 1, status: "all", loginType: "all", assetType: "all", systemType: "all" }, stageRun.taskId) },
      ],
      stats: [
        { label: "开始时间", value: formatDateTime(stageRun.startedAt), meta: formatTextValue(stageRun.provider), tone: "primary" },
        { label: "结束时间", value: formatDateTime(stageRun.finishedAt), meta: formatDurationMs(stageRun.durationMs), tone: "success" },
        { label: "错误", value: sanitizeRestrictedError(stageRun.errorMessage, role, "暂无异常"), meta: formatTextValue(stageRun.modelId), tone: "warning" },
      ],
      sections: [
        {
          title: "阶段详情",
          items: [
            { label: "Run ID", value: stageRun.runId },
            { label: "任务 ID", value: stageRun.taskId },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("material-error:")) {
    return buildFocusedAssetProfile(focus.replace(/^material-error:/, "material:"), role);
  }

  if (focus.startsWith("action:")) {
    const logId = focus.replace(/^action:/, "");
    const action = listAdminActionLogs().find((item) => item.logId === logId);
    if (!action) {
      return null;
    }
    return {
      title: action.detail,
      subtitle: `后台操作 · ${action.actionType}`,
      description: `${action.targetType}${action.targetId ? ` · ${action.targetId}` : ""} · admin ${action.adminId}`,
      badges: [
        { label: "后台操作", tone: "info" },
        { label: action.targetType, tone: "neutral" },
      ],
      stats: [
        { label: "操作人", value: action.adminId, meta: formatDateTime(action.createdAt), tone: "primary" },
        { label: "目标类型", value: action.targetType, meta: formatTextValue(action.targetId), tone: "neutral" },
      ],
      sections: [
        {
          title: "操作详情",
          items: [
            { label: "Log ID", value: action.logId },
            { label: "动作类型", value: action.actionType },
            { label: "IP", value: maskSensitiveText(action.ip, role, "ip") },
          ],
        },
      ],
    };
  }

  if (focus.startsWith("risk:")) {
    const blockId = focus.replace(/^risk:/, "");
    const block = listRiskBlockEntries().find((item) => item.blockId === blockId);
    if (!block) {
      return null;
    }
    return {
      title: block.reason,
      subtitle: `风控限制 · ${block.type}`,
      description: maskRiskValue(block.value, block.type, role),
      badges: [
        { label: "风控限制", tone: "warning" },
        { label: block.type.toUpperCase(), tone: "neutral" },
      ],
      stats: [
        { label: "创建时间", value: formatDateTime(block.createdAt), meta: block.blockId, tone: "primary" },
      ],
      sections: [
        {
          title: "限制详情",
          items: [
            { label: "Block ID", value: block.blockId },
            { label: "类型", value: block.type },
            { label: "目标值", value: maskRiskValue(block.value, block.type, role) },
          ],
        },
      ],
    };
  }

  return null;
}

function buildFocusedProfile(filters: AdminDataDetailFilters, role: AdminRole) {
  if (!filters.focus) {
    return null;
  }

  switch (filters.domain) {
    case "users":
      return buildFocusedUserProfile(filters.focus, role);
    case "assets":
      return buildFocusedAssetProfile(filters.focus, role);
    case "system":
      return buildFocusedSystemProfile(filters.focus, role);
    default:
      return buildFocusedTaskProfile(filters.focus, role);
  }
}

function buildUserRows(filters: AdminDataDetailFilters): DomainRowResult {
  const authUserMap = new Map(listAuthUsers().map((item) => [item.userId, item]));
  const users = listUsersForAdmin({
    keyword: filters.keyword,
    loginMethod: filters.loginType,
    passwordState: "all",
  })
    .filter((item) => (filters.status === "all" ? true : item.status === filters.status))
    .filter((item) => isWithinTimeRange(item.lastLoginAt || item.createdAt, filters.timeRange))
    .map((item) => {
      const user = authUserMap.get(item.userId);
      const loginSummary = item.loginMethods.length > 0 ? item.loginMethods.map(formatLoginType).join(" / ") : "暂无登录";
      const timestamp = toTimestamp(item.lastLoginAt || item.createdAt);
      return {
        timestamp,
        display: {
          id: item.userId,
          title: item.nickname,
          subtitle: item.userId,
          description: `${item.maskedPhone ?? "未绑定手机号"} · ${loginSummary} · 在线会话 ${item.activeSessionCount}`,
          badges: [
            { label: formatUserStatus(item.status), tone: buildStatusTone(formatUserStatus(item.status)) },
            ...item.loginMethods.map((loginType) => ({
              label: formatLoginType(loginType),
              tone: "info" as const,
            })),
          ],
          sideValue: formatDateTime(item.lastLoginAt || item.createdAt),
          sideMeta: `注册 ${formatDateTime(item.createdAt)}`,
          href: buildDetailsFocusHref(filters, item.userId),
        },
        exportRow: {
          user_id: item.userId,
          nickname: item.nickname,
          status: formatUserStatus(item.status),
          masked_phone: item.maskedPhone ?? "",
          login_methods: loginSummary,
          active_sessions: item.activeSessionCount,
          plan_level: user?.planLevel ?? "",
          quota_scope: user?.quotaScope ?? "",
          certification_label: user?.certificationLabel ?? "",
          created_at: item.createdAt,
          last_login_at: item.lastLoginAt ?? "",
        },
      };
    });

  return {
    domainLabel: "用户明细",
    resultHint: "时间按最近登录或注册时间筛选",
    rows: users,
    statusOptions: [
      { value: "all", label: "全部状态" },
      { value: "normal", label: "正常" },
      { value: "banned", label: "已封禁" },
    ],
    secondaryField: {
      key: "loginType",
      label: "登录方式",
      options: [
        { value: "all", label: "全部" },
        { value: "password", label: "手机号密码" },
        { value: "sms", label: "短信验证码" },
      ],
    },
    exportHeaders: [
      "user_id",
      "nickname",
      "status",
      "masked_phone",
      "login_methods",
      "active_sessions",
      "plan_level",
      "quota_scope",
      "certification_label",
      "created_at",
      "last_login_at",
    ],
  };
}

function buildTaskRows(filters: AdminDataDetailFilters): DomainRowResult {
  const jobs = listVideoJobs();
  const compositions = listVideoCompositions();
  const jobsByTask = new Map<string, number>();
  const failedJobsByTask = new Map<string, number>();
  const compositionByTask = new Map<string, string>();

  for (const job of jobs) {
    if (!job.sourceTaskId) {
      continue;
    }
    jobsByTask.set(job.sourceTaskId, (jobsByTask.get(job.sourceTaskId) ?? 0) + 1);
    if (job.status === "FAILED") {
      failedJobsByTask.set(job.sourceTaskId, (failedJobsByTask.get(job.sourceTaskId) ?? 0) + 1);
    }
  }

  for (const composition of compositions) {
    if (composition.taskId) {
      compositionByTask.set(composition.taskId, composition.status);
    }
  }

  const tasks = listVideoTasks()
    .filter((item) =>
      includesKeyword(
        [
          item.taskId,
          item.title,
          item.parameters.video.videoType,
          item.source.productInfoTitle,
          item.source.videoMaterialName,
        ],
        filters.keyword,
      ),
    )
    .filter((item) => (filters.status === "all" ? true : item.status === filters.status))
    .filter((item) => isWithinTimeRange(item.updatedAt || item.createdAt, filters.timeRange))
    .map((item) => {
      const compositionStatus = compositionByTask.get(item.taskId) ?? "未合成";
      const jobsCount = jobsByTask.get(item.taskId) ?? 0;
      const failedJobs = failedJobsByTask.get(item.taskId) ?? 0;
      const segmentCount =
        item.directorPlan?.renderSegments?.length ?? item.parameters.video.segmentCount ?? item.shotPlan?.shots?.length ?? 0;
      return {
        timestamp: toTimestamp(item.updatedAt || item.createdAt),
        display: {
          id: item.taskId,
          title: item.title,
          subtitle: `${item.taskId} · ${item.parameters.video.videoType}`,
          description: `片段 ${segmentCount} · 作业 ${jobsCount} · 失败 ${failedJobs} · 合成 ${compositionStatus}`,
          badges: [
            { label: item.status, tone: buildStatusTone(item.status) },
            { label: item.parameters.video.videoType, tone: "info" as const },
            { label: compositionStatus, tone: buildStatusTone(compositionStatus) },
          ],
          sideValue: formatDateTime(item.updatedAt || item.createdAt),
          sideMeta: `创建 ${formatDateTime(item.createdAt)}`,
          href: buildDetailsFocusHref(filters, item.taskId),
        },
        exportRow: {
          task_id: item.taskId,
          title: item.title,
          status: item.status,
          video_type: item.parameters.video.videoType,
          segment_count: segmentCount,
          job_count: jobsCount,
          failed_job_count: failedJobs,
          composition_status: compositionStatus,
          created_at: item.createdAt,
          updated_at: item.updatedAt,
        },
      };
    });

  const statusValues = Array.from(new Set(listVideoTasks().map((item) => item.status))).sort();
  return {
    domainLabel: "任务明细",
    resultHint: "时间按任务更新时间筛选",
    rows: tasks,
    statusOptions: [{ value: "all", label: "全部状态" }, ...statusValues.map((value) => ({ value, label: value }))],
    exportHeaders: [
      "task_id",
      "title",
      "status",
      "video_type",
      "segment_count",
      "job_count",
      "failed_job_count",
      "composition_status",
      "created_at",
      "updated_at",
    ],
  };
}

function buildAssetRows(filters: AdminDataDetailFilters, role: AdminRole): DomainRowResult {
  const rows: DomainRowResult["rows"] = [];
  const assetTypeOptions: AdminDataFilterOption[] = [
    { value: "all", label: "全部资产" },
    { value: "archive", label: "商品档案" },
    { value: "material", label: "视频素材" },
    { value: "library", label: "素材归档" },
    { value: "voice", label: "克隆音色" },
  ];

  if (filters.assetType === "all" || filters.assetType === "archive") {
    for (const archive of listProductArchives()) {
      const parsedStatus = archive.parsedText.trim() ? "已解析" : "待解析";
      if (!includesKeyword([archive.archiveId, archive.title, archive.parsedData.summaryTitle], filters.keyword)) {
        continue;
      }
      if (filters.status !== "all" && filters.status !== parsedStatus) {
        continue;
      }
      if (!isWithinTimeRange(archive.updatedAt || archive.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(archive.updatedAt || archive.createdAt),
        display: {
          id: `archive:${archive.archiveId}`,
          title: archive.title,
          subtitle: `商品档案 · ${archive.archiveId}`,
          description: `标签 ${archive.parsedData.tags.length} · 卖点 ${archive.parsedData.sellingPoints.length} · 商品图 ${archive.sourceImageUrl ? "已上传" : "未上传"}`,
          badges: [
            { label: "商品档案", tone: "info" },
            { label: parsedStatus, tone: buildStatusTone(parsedStatus) },
          ],
          sideValue: formatDateTime(archive.updatedAt || archive.createdAt),
          sideMeta: `创建 ${formatDateTime(archive.createdAt)}`,
          href: buildDetailsFocusHref(filters, `archive:${archive.archiveId}`),
        },
        exportRow: {
          asset_type: "archive",
          object_id: archive.archiveId,
          title: archive.title,
          status: parsedStatus,
          detail_1: `标签 ${archive.parsedData.tags.length}`,
          detail_2: `卖点 ${archive.parsedData.sellingPoints.length}`,
          created_at: archive.createdAt,
          updated_at: archive.updatedAt,
        },
      });
    }
  }

  if (filters.assetType === "all" || filters.assetType === "material") {
    for (const material of listVideoMaterials()) {
      const statusLabel = getMaterialStatusMeta(material.status).label;
      if (!includesKeyword([material.materialId, material.name, material.subtitle, material.videoFileName], filters.keyword)) {
        continue;
      }
      if (filters.status !== "all" && filters.status !== material.status && filters.status !== statusLabel) {
        continue;
      }
      if (!isWithinTimeRange(material.updatedAt || material.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(material.updatedAt || material.createdAt),
        display: {
          id: `material:${material.materialId}`,
          title: material.name || material.materialId,
          subtitle: `视频素材 · ${material.materialId}`,
          description: `${material.processingMode} · 关键帧 ${material.framesExtracted} · ${sanitizeRestrictedError(material.statusMessage, role, "处理中")}`,
          badges: [
            { label: "视频素材", tone: "info" },
            { label: statusLabel, tone: buildStatusTone(statusLabel) },
          ],
          sideValue: formatDateTime(material.updatedAt || material.createdAt),
          sideMeta: `创建 ${formatDateTime(material.createdAt)}`,
          href: buildDetailsFocusHref(filters, `material:${material.materialId}`),
        },
        exportRow: {
          asset_type: "material",
          object_id: material.materialId,
          title: material.name || material.materialId,
          status: material.status,
          detail_1: material.processingMode,
          detail_2: sanitizeRestrictedError(material.statusMessage, role, ""),
          created_at: material.createdAt,
          updated_at: material.updatedAt,
        },
      });
    }
  }

  if (filters.assetType === "all" || filters.assetType === "library") {
    for (const item of listMaterialLibraryItems()) {
      if (!includesKeyword([item.materialId, item.title, item.sourceLabel], filters.keyword)) {
        continue;
      }
      if (filters.status !== "all" && filters.status !== item.type) {
        continue;
      }
      if (!isWithinTimeRange(item.addedAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(item.addedAt),
        display: {
          id: `library:${item.materialId}`,
          title: item.title,
          subtitle: `素材归档 · ${item.materialId}`,
          description: `${item.sourceLabel} · ${item.type} · ${item.aspectRatio ?? "未知比例"}`,
          badges: [
            { label: "素材归档", tone: "info" },
            { label: item.type, tone: "neutral" },
          ],
          sideValue: formatDateTime(item.addedAt),
          sideMeta: `${item.width ?? "--"} × ${item.height ?? "--"}`,
          href: buildDetailsFocusHref(filters, `library:${item.materialId}`),
        },
        exportRow: {
          asset_type: "library",
          object_id: item.materialId,
          title: item.title,
          status: item.type,
          detail_1: item.sourceLabel,
          detail_2: item.aspectRatio ?? "",
          created_at: item.addedAt,
          updated_at: item.addedAt,
        },
      });
    }
  }

  if (filters.assetType === "all" || filters.assetType === "voice") {
    for (const voice of listClonedVoices()) {
      if (!includesKeyword([voice.cloneId, voice.title, voice.alias, voice.speakerId], filters.keyword)) {
        continue;
      }
      if (filters.status !== "all" && filters.status !== voice.status) {
        continue;
      }
      if (!isWithinTimeRange(voice.updatedAt || voice.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(voice.updatedAt || voice.createdAt),
        display: {
          id: `voice:${voice.cloneId}`,
          title: voice.title,
          subtitle: `克隆音色 · ${voice.cloneId}`,
          description: `${voice.speakerId} · ${voice.language.toUpperCase()} · v${voice.modelType} · ${sanitizeRestrictedError(voice.error, role, "状态正常")}`,
          badges: [
            { label: "克隆音色", tone: "info" },
            { label: voice.status, tone: buildStatusTone(voice.status) },
          ],
          sideValue: formatDateTime(voice.updatedAt || voice.createdAt),
          sideMeta: `创建 ${formatDateTime(voice.createdAt)}`,
          href: buildDetailsFocusHref(filters, `voice:${voice.cloneId}`),
        },
        exportRow: {
          asset_type: "voice",
          object_id: voice.cloneId,
          title: voice.title,
          status: voice.status,
          detail_1: voice.speakerId,
          detail_2: sanitizeRestrictedError(voice.error, role, ""),
          created_at: voice.createdAt,
          updated_at: voice.updatedAt,
        },
      });
    }
  }

  const rowsSorted = rows.sort((left, right) => right.timestamp - left.timestamp);
  return {
    domainLabel: "素材明细",
    resultHint: "时间按对象最近更新时间筛选",
    rows: rowsSorted,
    statusOptions: [
      { value: "all", label: "全部状态" },
      { value: "已解析", label: "已解析档案" },
      { value: "待解析", label: "待解析档案" },
      { value: "ready", label: "素材已就绪" },
      { value: "error", label: "素材异常" },
      { value: "SUCCESS", label: "音色成功" },
      { value: "FAILED", label: "音色失败" },
      { value: "image", label: "归档图片" },
      { value: "video", label: "归档视频" },
    ],
    secondaryField: {
      key: "assetType",
      label: "资产类型",
      options: assetTypeOptions,
    },
    exportHeaders: ["asset_type", "object_id", "title", "status", "detail_1", "detail_2", "created_at", "updated_at"],
  };
}

function buildSystemRows(filters: AdminDataDetailFilters, role: AdminRole): DomainRowResult {
  const rows: DomainRowResult["rows"] = [];

  if (filters.systemType === "all" || filters.systemType === "api") {
    for (const requestLog of listApiRequestLogs()) {
      if (
        !includesKeyword(
          [requestLog.requestId, requestLog.routePath, requestLog.method, requestLog.actorType, requestLog.actorId],
          filters.keyword,
        )
      ) {
        continue;
      }
      if (filters.status === "failed" && requestLog.statusCode < 400) {
        continue;
      }
      if (filters.status === "success" && requestLog.statusCode >= 400) {
        continue;
      }
      if (!isWithinTimeRange(requestLog.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(requestLog.createdAt),
        display: {
          id: `api:${requestLog.requestId}`,
          title: `${requestLog.method} ${requestLog.routePath}`,
          subtitle: `API 请求 · ${requestLog.requestId}`,
          description: `${requestLog.actorType}${requestLog.actorId ? ` · ${requestLog.actorId}` : ""} · ${formatDurationMs(requestLog.durationMs)}`,
          badges: [
            { label: "API 请求", tone: "info" },
            { label: `${requestLog.statusCode}`, tone: requestLog.statusCode >= 400 ? "danger" : "success" },
          ],
          sideValue: formatDateTime(requestLog.createdAt),
          sideMeta: `${requestLog.actorType} / ${formatDurationMs(requestLog.durationMs)}`,
          href: buildDetailsFocusHref(filters, `api:${requestLog.requestId}`),
        },
        exportRow: {
          system_type: "api",
          object_id: requestLog.requestId,
          title: `${requestLog.method} ${requestLog.routePath}`,
          status: `${requestLog.statusCode}`,
          detail_1: requestLog.actorType,
          detail_2: requestLog.actorId ?? "",
          created_at: requestLog.createdAt,
          updated_at: requestLog.createdAt,
        },
      });
    }
  }

  if (filters.systemType === "all" || filters.systemType === "job") {
    for (const job of listVideoJobs()) {
      if (!includesKeyword([job.jobId, job.taskName, job.provider, job.modelId, job.error], filters.keyword)) {
        continue;
      }
      if (filters.status === "failed" && job.status !== "FAILED") {
        continue;
      }
      if (filters.status === "pending" && job.status !== "QUEUED" && job.status !== "IN_PROGRESS") {
        continue;
      }
      if (!isWithinTimeRange(job.updatedAt || job.submittedAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(job.updatedAt || job.submittedAt),
        display: {
          id: `job:${job.jobId}`,
          title: job.taskName || job.jobId,
          subtitle: `视频作业 · ${job.jobId}`,
          description: `${job.provider ?? job.mode} · ${job.modelId ?? "unknown-model"} · ${sanitizeRestrictedError(job.error, role, "运行正常")}`,
          badges: [
            { label: "作业", tone: "info" },
            { label: job.status, tone: buildStatusTone(job.status) },
          ],
          sideValue: formatDateTime(job.updatedAt || job.submittedAt),
          sideMeta: `提交 ${formatDateTime(job.submittedAt)}`,
          href: buildDetailsFocusHref(filters, `job:${job.jobId}`),
        },
        exportRow: {
          system_type: "job",
          object_id: job.jobId,
          title: job.taskName || job.jobId,
          status: job.status,
          detail_1: job.provider ?? job.mode,
          detail_2: sanitizeRestrictedError(job.error, role, ""),
          created_at: job.submittedAt,
          updated_at: job.updatedAt,
        },
      });
    }
  }

  if (filters.systemType === "all" || filters.systemType === "provider") {
    for (const providerCall of listProviderCallLogs()) {
      if (
        !includesKeyword(
          [
            providerCall.callId,
            providerCall.serviceName,
            providerCall.provider,
            providerCall.modelId,
            providerCall.objectType,
            providerCall.objectId,
            providerCall.errorCode,
          ],
          filters.keyword,
        )
      ) {
        continue;
      }
      if (filters.status === "failed" && providerCall.success !== 0) {
        continue;
      }
      if (filters.status === "success" && providerCall.success !== 1) {
        continue;
      }
      if (!isWithinTimeRange(providerCall.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(providerCall.createdAt),
        display: {
          id: `provider:${providerCall.callId}`,
          title: providerCall.serviceName,
          subtitle: `Provider 调用 · ${providerCall.callId}`,
          description: `${providerCall.provider ?? "provider"} · ${providerCall.modelId ?? "unknown-model"} · ${providerCall.objectType ?? "object"} ${providerCall.objectId ?? ""}`.trim(),
          badges: [
            { label: "Provider", tone: "info" },
            { label: providerCall.success === 1 ? "SUCCESS" : "FAILED", tone: providerCall.success === 1 ? "success" : "danger" },
          ],
          sideValue: formatDateTime(providerCall.createdAt),
          sideMeta: providerCall.success === 1
            ? formatDurationMs(providerCall.durationMs)
            : providerCall.errorCode ?? "调用失败",
          href: buildDetailsFocusHref(filters, `provider:${providerCall.callId}`),
        },
        exportRow: {
          system_type: "provider",
          object_id: providerCall.callId,
          title: providerCall.serviceName,
          status: providerCall.success === 1 ? "SUCCESS" : "FAILED",
          detail_1: providerCall.provider ?? "",
          detail_2: providerCall.errorCode ?? providerCall.objectId ?? "",
          created_at: providerCall.createdAt,
          updated_at: providerCall.createdAt,
        },
      });
    }
  }

  if (filters.systemType === "all" || filters.systemType === "material") {
    for (const material of listVideoMaterials().filter((item) => item.status === "error")) {
      if (!includesKeyword([material.materialId, material.name, material.statusMessage], filters.keyword)) {
        continue;
      }
      if (filters.status !== "all" && filters.status !== "failed") {
        continue;
      }
      if (!isWithinTimeRange(material.updatedAt || material.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(material.updatedAt || material.createdAt),
        display: {
          id: `material-error:${material.materialId}`,
          title: material.name || material.materialId,
          subtitle: `素材异常 · ${material.materialId}`,
          description: sanitizeRestrictedError(material.statusMessage, role, "处理失败"),
          badges: [
            { label: "素材异常", tone: "warning" },
            { label: "FAILED", tone: "danger" },
          ],
          sideValue: formatDateTime(material.updatedAt || material.createdAt),
          sideMeta: `创建 ${formatDateTime(material.createdAt)}`,
          href: buildDetailsFocusHref(filters, `material-error:${material.materialId}`),
        },
        exportRow: {
          system_type: "material",
          object_id: material.materialId,
          title: material.name || material.materialId,
          status: material.status,
          detail_1: material.processingMode,
          detail_2: sanitizeRestrictedError(material.statusMessage, role, ""),
          created_at: material.createdAt,
          updated_at: material.updatedAt,
        },
      });
    }
  }

  if (filters.systemType === "all" || filters.systemType === "stage") {
    for (const stageRun of listTaskStageRuns()) {
      if (
        !includesKeyword(
          [stageRun.runId, stageRun.taskId, stageRun.stageKey, stageRun.provider, stageRun.modelId, stageRun.errorMessage],
          filters.keyword,
        )
      ) {
        continue;
      }
      if (filters.status === "failed" && stageRun.status !== "FAILED") {
        continue;
      }
      if (filters.status === "pending" && stageRun.status !== "QUEUED" && stageRun.status !== "IN_PROGRESS") {
        continue;
      }
      if (filters.status === "success" && stageRun.status !== "COMPLETED") {
        continue;
      }
      if (!isWithinTimeRange(stageRun.finishedAt || stageRun.startedAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(stageRun.finishedAt || stageRun.startedAt),
        display: {
          id: `stage:${stageRun.runId}`,
          title: stageRun.stageKey,
          subtitle: `阶段运行 · ${stageRun.taskId}`,
          description: `${stageRun.provider ?? "provider"} · ${stageRun.modelId ?? "unknown-model"} · ${
            stageRun.errorMessage ? sanitizeRestrictedError(stageRun.errorMessage, role, "") : formatDurationMs(stageRun.durationMs)
          }`,
          badges: [
            { label: "Stage Run", tone: "info" },
            { label: stageRun.status, tone: buildStatusTone(stageRun.status) },
          ],
          sideValue: formatDateTime(stageRun.finishedAt || stageRun.startedAt),
          sideMeta: `开始 ${formatDateTime(stageRun.startedAt)}`,
          href: buildDetailsFocusHref(filters, `stage:${stageRun.runId}`),
        },
        exportRow: {
          system_type: "stage",
          object_id: stageRun.runId,
          title: `${stageRun.stageKey}:${stageRun.taskId}`,
          status: stageRun.status,
          detail_1: stageRun.provider ?? "",
          detail_2: sanitizeRestrictedError(stageRun.errorMessage, role, ""),
          created_at: stageRun.startedAt,
          updated_at: stageRun.finishedAt ?? stageRun.startedAt,
        },
      });
    }
  }

  if (filters.systemType === "all" || filters.systemType === "action") {
    for (const action of listAdminActionLogs()) {
      if (!includesKeyword([action.adminId, action.actionType, action.detail, action.targetType, action.targetId], filters.keyword)) {
        continue;
      }
      if (filters.status !== "all" && filters.status !== "action") {
        continue;
      }
      if (!isWithinTimeRange(action.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(action.createdAt),
        display: {
          id: `action:${action.logId}`,
          title: action.detail,
          subtitle: `后台操作 · ${action.actionType}`,
          description: `${action.targetType}${action.targetId ? ` · ${action.targetId}` : ""} · admin ${action.adminId}`,
          badges: [
            { label: "后台操作", tone: "info" },
            { label: action.targetType, tone: "neutral" },
          ],
          sideValue: formatDateTime(action.createdAt),
          sideMeta: `admin ${action.adminId}`,
          href: buildDetailsFocusHref(filters, `action:${action.logId}`),
        },
        exportRow: {
          system_type: "action",
          object_id: action.logId,
          title: action.detail,
          status: action.actionType,
          detail_1: action.targetType,
          detail_2: action.targetId ?? "",
          created_at: action.createdAt,
          updated_at: action.createdAt,
        },
      });
    }
  }

  if (filters.systemType === "all" || filters.systemType === "risk") {
    for (const block of listRiskBlockEntries()) {
      if (!includesKeyword([block.blockId, block.type, block.value, block.reason], filters.keyword)) {
        continue;
      }
      if (filters.status !== "all" && filters.status !== "failed") {
        continue;
      }
      if (!isWithinTimeRange(block.createdAt, filters.timeRange)) {
        continue;
      }
      rows.push({
        timestamp: toTimestamp(block.createdAt),
        display: {
          id: `risk:${block.blockId}`,
          title: block.reason,
          subtitle: `风控限制 · ${block.type}`,
          description: maskRiskValue(block.value, block.type, role),
          badges: [
            { label: "风控限制", tone: "warning" },
            { label: block.type.toUpperCase(), tone: "neutral" },
          ],
          sideValue: formatDateTime(block.createdAt),
          sideMeta: block.blockId,
          href: buildDetailsFocusHref(filters, `risk:${block.blockId}`),
        },
        exportRow: {
          system_type: "risk",
          object_id: block.blockId,
          title: block.reason,
          status: block.type,
          detail_1: maskRiskValue(block.value, block.type, role),
          detail_2: "",
          created_at: block.createdAt,
          updated_at: block.createdAt,
        },
      });
    }
  }

  return {
    domainLabel: "系统明细",
    resultHint: "时间按日志产生时间或对象更新时间筛选",
    rows: rows.sort((left, right) => right.timestamp - left.timestamp),
    statusOptions: [
      { value: "all", label: "全部状态" },
      { value: "failed", label: "失败 / 异常" },
      { value: "success", label: "成功 / 完成" },
      { value: "pending", label: "排队 / 处理中" },
      { value: "action", label: "后台操作" },
    ],
    secondaryField: {
      key: "systemType",
      label: "系统类型",
      options: [
        { value: "all", label: "全部" },
        { value: "api", label: "API 请求" },
        { value: "job", label: "作业" },
        { value: "provider", label: "Provider 调用" },
        { value: "stage", label: "阶段运行" },
        { value: "material", label: "素材异常" },
        { value: "action", label: "后台操作" },
        { value: "risk", label: "风控限制" },
      ],
    },
    exportHeaders: ["system_type", "object_id", "title", "status", "detail_1", "detail_2", "created_at", "updated_at"],
  };
}

function buildDomainRows(filters: AdminDataDetailFilters, role: AdminRole): DomainRowResult {
  switch (filters.domain) {
    case "users":
      return buildUserRows(filters);
    case "assets":
      return buildAssetRows(filters, role);
    case "system":
      return buildSystemRows(filters, role);
    default:
      return buildTaskRows(filters);
  }
}

export function getAdminDataDetailSnapshot(
  input?: URLSearchParams | Record<string, string | string[] | undefined> | AdminDataDetailFilters,
  role: AdminRole = "super_admin",
): AdminDataDetailSnapshot {
  const filters = resolveAdminDataDetailFilters(input);
  const result = buildDomainRows(filters, role);
  const total = result.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const pageRows = result.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => item.display);
  const nextFilters = { ...filters, page };
  const exceedsExportLimit = total > ADMIN_DATA_EXPORT_MAX_ROWS;

  return {
    filters: nextFilters,
    domainLabel: result.domainLabel,
    stats: buildGenericStats(nextFilters, result.domainLabel, total, totalPages, exceedsExportLimit),
    panels: buildGenericPanels(nextFilters, result.domainLabel, result.resultHint, total, totalPages, exceedsExportLimit),
    rows: pageRows,
    focusedProfile: buildFocusedProfile(nextFilters, role),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages,
    rangeLabel: getTimeRangeLabel(nextFilters.timeRange),
    statusOptions: result.statusOptions,
    secondaryField: result.secondaryField,
    summaryText: result.resultHint,
    exportPageHref: buildHref("/admin/data/exports", nextFilters, { focus: "" }),
    directExportHref: buildHref("/api/admin/data/export", nextFilters, { focus: "" }),
    exceedsExportLimit,
  };
}

export function buildAdminDataExportPayload(
  input?: URLSearchParams | Record<string, string | string[] | undefined> | AdminDataDetailFilters,
  role: AdminRole = "super_admin",
): AdminDataExportPayload {
  const filters = resolveAdminDataDetailFilters(input);
  const normalizedFilters = { ...filters, page: 1, focus: undefined };
  const result = buildDomainRows(normalizedFilters, role);
  const rows = result.rows.map((item) => item.exportRow);
  const datePart = new Date().toISOString().slice(0, 10);

  return {
    filters: normalizedFilters,
    domainLabel: result.domainLabel,
    fileName: `admin-data-${normalizedFilters.domain}-${datePart}.csv`,
    headers: result.exportHeaders,
    rows,
  };
}
