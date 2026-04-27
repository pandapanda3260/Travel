"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { formatDateTime } from "../../../lib/auth-display";

type LevelCode = "L1" | "L2" | "L3" | "L4" | "L5";
type MemberStatus = "active" | "grace" | "frozen" | "merged";

type MemberUserListItem = {
  userId: string;
  nickname: string;
  maskedPhone: string | null;
  status: "normal" | "banned" | "merged";
  memberStatus: MemberStatus;
  currentLevelCode: LevelCode;
  currentLevelNumber: number;
  currentLevelName: string;
  effectiveGrowthValue: number;
  lifetimeGrowthValue: number;
  availablePoints: number;
  nextLevelGap: number;
  quotaScopeSnapshot: "limited" | "unlimited";
  excludeFromMetrics: boolean;
  lastLevelChangedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

type MemberUserPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type LevelRule = {
  levelCode: LevelCode;
  name: string;
  upgradeThreshold: number;
  retainThreshold: number;
  badgeLabel: string;
  enabled: boolean;
};

type GrowthRule = {
  ruleCode: string;
  name: string;
  growthValue: number;
  dailyLimit: number | null;
  enabled: boolean;
};

type PointRule = {
  ruleCode: string;
  name: string;
  pointValue: number;
  dailyLimit: number | null;
  enabled: boolean;
};

type BenefitDefinition = {
  benefitKey: string;
  name: string;
  valueType: "number" | "string" | "boolean";
  unit: string | null;
};

type LevelBenefitMap = {
  mapId: string;
  levelCode: LevelCode;
  benefitKey: string;
  benefitValue: string | number | boolean;
  enabled: boolean;
};

type MemberConfig = {
  memberCenterEnabled: boolean;
  memberGrowthEnabled: boolean;
  memberBenefitEnforcementEnabled: boolean;
  memberAdminEnabled: boolean;
  growthExpireDays: number;
  gracePeriodDays: number;
};

type PointsConfig = {
  pointsEnabled: boolean;
  defaultExpireDays: number | null;
};

type MemberCampaignTargetType = "all_metric_users" | "levels" | "user_ids";
type MemberCampaignGrantType = "growth" | "points" | "benefit" | "level";
type MemberExportLogType = "growth" | "points" | "benefit_grants" | "benefit_usage" | "campaign_results";

type MemberCampaignRecord = {
  campaignId: string;
  name: string;
  enabled: boolean;
  targetType: MemberCampaignTargetType;
  targetLevelCodes: LevelCode[];
  targetUserIds: string[];
  grantType: MemberCampaignGrantType;
  growthValue: number | null;
  pointsValue: number | null;
  benefitKey: string | null;
  benefitValue: string | null;
  levelCode: LevelCode | null;
  effectiveDays: number | null;
  remark: string;
  executionCount: number;
  lastExecutedAt: string | null;
  lastExecutedUserCount: number;
  createdAt: string;
  updatedAt: string;
};

type MemberUserDetail = {
  summary: MemberUserListItem;
  profile: {
    currentLevelCode: LevelCode;
    memberStatus: MemberStatus;
    effectiveGrowthValue: number;
    lifetimeGrowthValue: number;
    nextLevelGap: number;
    graceExpireAt: string | null;
    manualLevelCode: LevelCode | null;
    manualLevelExpireAt: string | null;
  };
  pointsAccount: {
    availablePoints: number;
    lifetimePoints: number;
    lastChangedAt: string | null;
  } | null;
  effectiveBenefits: Array<{
    benefitKey: string;
    name: string;
    unit: string | null;
    value: string | number | boolean;
    sourceType: "level" | "grant";
  }>;
  growthRecords: Array<{
    growthId: string;
    effectiveValue: number;
    remark: string | null;
    eventType: string;
    createdAt: string;
  }>;
  pointRecords: Array<{
    pointId: string;
    changeValue: number;
    remark: string | null;
    eventType: string;
    expireAt: string | null;
    createdAt: string;
  }>;
  levelChanges: Array<{
    changeId: string;
    fromLevelCode: string | null;
    toLevelCode: string;
    reasonDetail: string;
    createdAt: string;
  }>;
  grantedBenefits: Array<{
    grantId: string;
    benefitName: string;
    benefitValue: string;
    status: "active" | "expired" | "revoked";
    expireAt: string | null;
    remark: string | null;
    createdAt: string;
  }>;
  benefitUsageRecords: Array<{
    usageId: string;
    benefitKey: string;
    benefitName: string;
    sourceBizType: string | null;
    currentCount: number;
    nextCount: number;
    limitValue: string | null;
    resultStatus: "allowed" | "blocked";
    detail: string | null;
    createdAt: string;
  }>;
  operationLogs: Array<{
    operateId: string;
    actionType: string;
    detail: string;
    createdAt: string;
  }>;
};

type DashboardPayload = {
  dashboard: {
    overview: {
      totalUsers: number;
      metricUsers: number;
      memberPenetrationRate: number;
      highLevelUsers: number;
      frozenUsers: number;
      graceUsers: number;
      unlimitedUsers: number;
      totalAvailablePoints: number;
      upgradeUsers7d: number;
      downgradeUsers7d: number;
      benefitGrantCount7d: number;
      benefitGrantUsers7d: number;
      growthUsers30d: number;
      pointUsers30d: number;
      highLevelActiveUsers30d: number;
      highLevelActiveRate30d: number;
      campaignExecutions7d: number;
      totalBenefitHits30d: number;
      blockedBenefitHits30d: number;
      benefitUsedUsers30d: number;
    };
    distribution: Array<{ levelCode: string; levelName: string; userCount: number }>;
    recentCampaigns: Array<{
      campaignId: string;
      name: string;
      grantType: MemberCampaignGrantType;
      executionCount: number;
      lastExecutedAt: string | null;
      lastExecutedUserCount: number;
      enabled: boolean;
    }>;
    recentExecutions: Array<{
      batchId: string;
      campaignId: string;
      campaignName: string;
      grantType: MemberCampaignGrantType;
      targetSummary: string;
      plannedUserCount: number;
      successUserCount: number;
      failedUserCount: number;
      startedAt: string;
      finishedAt: string | null;
      createdAt: string;
    }>;
    recentExecutionResults: Array<{
      resultId: string;
      batchId: string;
      campaignId: string;
      campaignName: string;
      userId: string;
      status: "success" | "failed" | "skipped";
      detail: string;
      createdAt: string;
    }>;
    benefitUsage: Array<{
      benefitKey: string;
      benefitName: string;
      eligibleUserCount: number;
      usedUserCount30d: number;
      usageRate30d: number;
      hitCount30d: number;
      allowedHitCount30d: number;
      blockedHitCount30d: number;
    }>;
  };
  rules: {
    levels: LevelRule[];
    growthRules: GrowthRule[];
    pointRules: PointRule[];
    benefitDefinitions: BenefitDefinition[];
    levelBenefitMaps: LevelBenefitMap[];
    config: MemberConfig;
    pointsConfig: PointsConfig;
  };
};

type CampaignExecutionDetail = {
  batch: {
    batchId: string;
    campaignId: string;
    campaignName: string;
    grantType: MemberCampaignGrantType;
    targetSummary: string;
    plannedUserCount: number;
    successUserCount: number;
    failedUserCount: number;
    operatorId: string | null;
    startedAt: string;
    finishedAt: string | null;
    createdAt: string;
  };
  campaign: MemberCampaignRecord | null;
  results: Array<{
    resultId: string;
    userId: string;
    nickname: string;
    maskedPhone: string | null;
    status: "success" | "failed" | "skipped";
    detail: string;
    createdAt: string;
  }>;
};

function formatMemberStatus(status: MemberStatus) {
  switch (status) {
    case "active":
      return "正常";
    case "grace":
      return "观察期";
    case "frozen":
      return "冻结";
    case "merged":
      return "已合并";
    default:
      return status;
  }
}

function formatBenefitValue(value: string | number | boolean, unit: string | null) {
  if (typeof value === "boolean") {
    return value ? "已启用" : "未启用";
  }
  return unit ? `${value}${unit}` : String(value);
}

function formatExecutionStatus(status: "success" | "failed" | "skipped") {
  switch (status) {
    case "success":
      return "成功";
    case "failed":
      return "失败";
    case "skipped":
      return "跳过";
    default:
      return status;
  }
}

function formatUsageSource(sourceBizType: string | null) {
  switch (sourceBizType) {
    case "product_archive":
      return "商品档案";
    case "video_material":
      return "视频素材";
    case "video_task":
      return "视频任务";
    case "voice_clone":
      return "声音复刻";
    case "voice_clone_import":
      return "导入音色";
    default:
      return sourceBizType ?? "未知来源";
  }
}

function formatGrantStatus(status: "active" | "expired" | "revoked") {
  switch (status) {
    case "active":
      return "生效中";
    case "expired":
      return "已失效";
    case "revoked":
      return "已撤回";
    default:
      return status;
  }
}

export function AdminMembershipClient() {
  const [keyword, setKeyword] = useState("");
  const [levelCode, setLevelCode] = useState<LevelCode | "">("");
  const [memberStatus, setMemberStatus] = useState<MemberStatus | "">("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [users, setUsers] = useState<MemberUserListItem[]>([]);
  const [userPagination, setUserPagination] = useState<MemberUserPagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [userPage, setUserPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [detail, setDetail] = useState<MemberUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [levelForm, setLevelForm] = useState({ levelCode: "auto", effectiveDays: "", reason: "" });
  const [growthForm, setGrowthForm] = useState({ changeValue: "", reason: "" });
  const [pointsForm, setPointsForm] = useState({ changeValue: "", reason: "" });
  const [benefitForm, setBenefitForm] = useState({ benefitKey: "", benefitValue: "", effectiveDays: "", reason: "" });
  const [systemConfigForm, setSystemConfigForm] = useState<MemberConfig | null>(null);
  const [pointsConfigForm, setPointsConfigForm] = useState<PointsConfig | null>(null);
  const [editableLevels, setEditableLevels] = useState<LevelRule[]>([]);
  const [editableGrowthRules, setEditableGrowthRules] = useState<GrowthRule[]>([]);
  const [editablePointRules, setEditablePointRules] = useState<PointRule[]>([]);
  const [editableBenefitMaps, setEditableBenefitMaps] = useState<LevelBenefitMap[]>([]);
  const [campaigns, setCampaigns] = useState<MemberCampaignRecord[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [executionDetail, setExecutionDetail] = useState<CampaignExecutionDetail | null>(null);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [executionStatusFilter, setExecutionStatusFilter] = useState<"" | "success" | "failed" | "skipped">("");
  const [executionKeyword, setExecutionKeyword] = useState("");
  const [executionPage, setExecutionPage] = useState(1);
  const [exportForm, setExportForm] = useState({
    logType: "growth" as MemberExportLogType,
    userId: "",
    startDate: "",
    endDate: "",
    batchId: "",
    status: "",
  });
  const [campaignForm, setCampaignForm] = useState({
    campaignId: "",
    name: "",
    enabled: true,
    targetType: "all_metric_users" as MemberCampaignTargetType,
    targetLevelCodes: [] as LevelCode[],
    targetUserIdsText: "",
    grantType: "growth" as MemberCampaignGrantType,
    growthValue: "",
    pointsValue: "",
    benefitKey: "",
    benefitValue: "",
    levelCode: "" as LevelCode | "",
    effectiveDays: "",
    remark: "",
  });

  const loadDashboard = useCallback(async () => {
    const response = await fetch("/api/admin/member/dashboard", { cache: "no-store" });
    const data = (await response.json()) as DashboardPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "会员看板加载失败");
    }
    setDashboard(data);
  }, []);

  const loadCampaigns = useCallback(async () => {
    const response = await fetch("/api/admin/member/campaigns", { cache: "no-store" });
    const data = (await response.json()) as { campaigns?: MemberCampaignRecord[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "活动列表加载失败");
    }
    setCampaigns(data.campaigns ?? []);
  }, []);

  const loadExecutionDetail = useCallback(async (batchId: string) => {
    if (!batchId) {
      setExecutionDetail(null);
      return;
    }

    setExecutionLoading(true);
    try {
      const response = await fetch(`/api/admin/member/campaign-executions?batchId=${encodeURIComponent(batchId)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as { detail?: CampaignExecutionDetail; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "执行批次详情加载失败");
      }
      setExecutionDetail(data.detail ?? null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "执行批次详情加载失败");
    } finally {
      setExecutionLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (levelCode) params.set("levelCode", levelCode);
      if (memberStatus) params.set("memberStatus", memberStatus);
      params.set("page", String(userPage));
      params.set("pageSize", String(userPagination.pageSize));

      const response = await fetch(`/api/admin/member/users?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as {
        users?: MemberUserListItem[];
        pagination?: MemberUserPagination;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "会员用户列表加载失败");
      }
      const nextUsers = data.users ?? [];
      const nextPagination = data.pagination ?? {
        page: userPage,
        pageSize: userPagination.pageSize,
        total: nextUsers.length,
        totalPages: 1,
      };
      setUsers(nextUsers);
      setUserPagination(nextPagination);
      if (nextPagination.page !== userPage) {
        setUserPage(nextPagination.page);
      }
      setSelectedUserId((current) => {
        if (current && nextUsers.some((item) => item.userId === current)) {
          return current;
        }
        return nextUsers[0]?.userId ?? "";
      });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "会员用户列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, levelCode, memberStatus, userPage, userPagination.pageSize]);

  const loadDetail = useCallback(async (userId: string) => {
    if (!userId) {
      setDetail(null);
      return;
    }

    setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/member/users/${userId}`, { cache: "no-store" });
      const data = (await response.json()) as { detail?: MemberUserDetail; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "会员详情加载失败");
      }
      setDetail(data.detail ?? null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "会员详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadCampaigns().catch((currentError) => {
      setError(currentError instanceof Error ? currentError.message : "活动列表加载失败");
    });
  }, [loadCampaigns]);

  useEffect(() => {
    const firstBatchId = dashboard?.dashboard.recentExecutions[0]?.batchId ?? "";
    setSelectedBatchId((current) => current || firstBatchId);
  }, [dashboard]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }
    setSystemConfigForm(dashboard.rules.config);
    setPointsConfigForm(dashboard.rules.pointsConfig);
    setEditableLevels(dashboard.rules.levels);
    setEditableGrowthRules(dashboard.rules.growthRules);
    setEditablePointRules(dashboard.rules.pointRules);
    setEditableBenefitMaps(dashboard.rules.levelBenefitMaps);
  }, [dashboard]);

  useEffect(() => {
    void loadDetail(selectedUserId);
  }, [loadDetail, selectedUserId]);

  useEffect(() => {
    if (!selectedBatchId) {
      setExecutionDetail(null);
      return;
    }
    void loadExecutionDetail(selectedBatchId);
  }, [loadExecutionDetail, selectedBatchId]);

  useEffect(() => {
    setExecutionPage(1);
  }, [executionDetail, executionKeyword, executionStatusFilter]);

  const selectedSummary = useMemo(
    () => users.find((item) => item.userId === selectedUserId) ?? detail?.summary ?? null,
    [detail, users, selectedUserId],
  );
  const benefitDefinitionMap = useMemo(
    () => new Map((dashboard?.rules.benefitDefinitions ?? []).map((item) => [item.benefitKey, item])),
    [dashboard],
  );
  const filteredExecutionResults = useMemo(() => {
    const list = executionDetail?.results ?? [];
    return list.filter((item) => {
      const matchesStatus = executionStatusFilter ? item.status === executionStatusFilter : true;
      if (!matchesStatus) {
        return false;
      }
      const keywordValue = executionKeyword.trim().toLowerCase();
      if (!keywordValue) {
        return true;
      }
      return [item.userId, item.nickname, item.maskedPhone ?? "", item.detail]
        .join(" ")
        .toLowerCase()
        .includes(keywordValue);
    });
  }, [executionDetail, executionKeyword, executionStatusFilter]);
  const executionPageSize = 10;
  const executionPageCount = Math.max(1, Math.ceil(filteredExecutionResults.length / executionPageSize));
  const pagedExecutionResults = useMemo(() => {
    const currentPage = Math.min(executionPage, executionPageCount);
    const startIndex = (currentPage - 1) * executionPageSize;
    return filteredExecutionResults.slice(startIndex, startIndex + executionPageSize);
  }, [executionPage, executionPageCount, filteredExecutionResults]);

  async function submitAction(payload: Record<string, unknown>, successText: string) {
    setPendingAction(String(payload.action ?? "action"));
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/member/users/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: MemberUserDetail;
      };
      if (!response.ok) {
        throw new Error(data.error || "会员操作失败");
      }

      setSuccess(successText);
      await Promise.all([loadUsers(), loadDashboard()]);
      await loadDetail(String(payload.userId ?? ""));
      setLevelForm({ levelCode: "auto", effectiveDays: "", reason: "" });
      setGrowthForm({ changeValue: "", reason: "" });
      setPointsForm({ changeValue: "", reason: "" });
      setBenefitForm({ benefitKey: "", benefitValue: "", effectiveDays: "", reason: "" });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "会员操作失败");
    } finally {
      setPendingAction("");
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (userPage !== 1) {
      setUserPage(1);
      return;
    }
    void loadUsers();
  }

  async function submitRuleAction(payload: Record<string, unknown>, successText: string) {
    setPendingAction(String(payload.action ?? "rule_action"));
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/member/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; dashboard?: DashboardPayload["dashboard"]; rules?: DashboardPayload["rules"] };
      if (!response.ok) {
        throw new Error(data.error || "规则保存失败");
      }

      if (data.dashboard && data.rules) {
        setDashboard({
          dashboard: data.dashboard,
          rules: data.rules,
        });
      } else {
        await loadDashboard();
      }
      await loadUsers();
      if (selectedUserId) {
        await loadDetail(selectedUserId);
      }
      setSuccess(successText);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "规则保存失败");
    } finally {
      setPendingAction("");
    }
  }

  function applyCampaignToForm(campaign: MemberCampaignRecord) {
    setCampaignForm({
      campaignId: campaign.campaignId,
      name: campaign.name,
      enabled: campaign.enabled,
      targetType: campaign.targetType,
      targetLevelCodes: campaign.targetLevelCodes,
      targetUserIdsText: campaign.targetUserIds.join("\n"),
      grantType: campaign.grantType,
      growthValue: campaign.growthValue != null ? String(campaign.growthValue) : "",
      pointsValue: campaign.pointsValue != null ? String(campaign.pointsValue) : "",
      benefitKey: campaign.benefitKey ?? "",
      benefitValue: campaign.benefitValue ?? "",
      levelCode: campaign.levelCode ?? "",
      effectiveDays: campaign.effectiveDays != null ? String(campaign.effectiveDays) : "",
      remark: campaign.remark,
    });
  }

  function resetCampaignForm() {
    setCampaignForm({
      campaignId: "",
      name: "",
      enabled: true,
      targetType: "all_metric_users",
      targetLevelCodes: [],
      targetUserIdsText: "",
      grantType: "growth",
      growthValue: "",
      pointsValue: "",
      benefitKey: "",
      benefitValue: "",
      levelCode: "",
      effectiveDays: "",
      remark: "",
    });
  }

  async function submitCampaignAction(payload: Record<string, unknown>, successText: string) {
    setPendingAction(String(payload.action ?? "campaign_action"));
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/member/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        campaigns?: MemberCampaignRecord[];
        dashboard?: DashboardPayload["dashboard"];
        campaign?: MemberCampaignRecord;
        result?: { campaign: MemberCampaignRecord; affectedUserCount: number };
      };
      if (!response.ok) {
        throw new Error(data.error || "活动操作失败");
      }

      if (data.campaigns) {
        setCampaigns(data.campaigns);
      }
      if (data.dashboard) {
        setDashboard((current) => (current ? { dashboard: data.dashboard!, rules: current.rules } : current));
      }
      if (data.campaign) {
        applyCampaignToForm(data.campaign);
      }
      if (data.result?.campaign) {
        applyCampaignToForm(data.result.campaign);
      }
      await loadUsers();
      if (selectedUserId) {
        await loadDetail(selectedUserId);
      }
      setSuccess(successText);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "活动操作失败");
    } finally {
      setPendingAction("");
    }
  }

  async function saveCampaign(executeAfterSave = false) {
    const payload = {
      campaignId: campaignForm.campaignId || null,
      name: campaignForm.name.trim(),
      enabled: campaignForm.enabled,
      targetType: campaignForm.targetType,
      targetLevelCodes: campaignForm.targetLevelCodes,
      targetUserIds: campaignForm.targetUserIdsText
        .split(/[\n,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
      grantType: campaignForm.grantType,
      growthValue: campaignForm.growthValue ? Number(campaignForm.growthValue) : null,
      pointsValue: campaignForm.pointsValue ? Number(campaignForm.pointsValue) : null,
      benefitKey: campaignForm.benefitKey || null,
      benefitValue: campaignForm.benefitValue || null,
      levelCode: campaignForm.levelCode || null,
      effectiveDays: campaignForm.effectiveDays ? Number(campaignForm.effectiveDays) : null,
      remark: campaignForm.remark.trim(),
    };

    setPendingAction("save_campaign");
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/member/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_campaign", campaign: payload }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        campaign?: MemberCampaignRecord;
        campaigns?: MemberCampaignRecord[];
        dashboard?: DashboardPayload["dashboard"];
      };
      if (!response.ok || !data.campaign) {
        throw new Error(data.error || "活动保存失败");
      }
      if (data.campaigns) {
        setCampaigns(data.campaigns);
      }
      if (data.dashboard) {
        setDashboard((current) => (current ? { dashboard: data.dashboard!, rules: current.rules } : current));
      }
      applyCampaignToForm(data.campaign);

      if (executeAfterSave) {
        await submitCampaignAction(
          { action: "execute_campaign", campaignId: data.campaign.campaignId },
          "活动已执行。",
        );
        return;
      }
      setSuccess("活动已保存。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "活动保存失败");
    } finally {
      setPendingAction("");
    }
  }

  async function retryFailedBatch(batchId: string) {
    setPendingAction("retry_failed_batch");
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/member/campaign-executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_failed", batchId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: CampaignExecutionDetail | null;
        campaigns?: MemberCampaignRecord[];
        dashboard?: DashboardPayload["dashboard"];
        result?: { batchId: string };
      };
      if (!response.ok) {
        throw new Error(data.error || "批次重试失败");
      }

      if (data.campaigns) {
        setCampaigns(data.campaigns);
      }
      if (data.dashboard) {
        setDashboard((current) => (current ? { dashboard: data.dashboard!, rules: current.rules } : current));
      }
      if (data.detail) {
        setExecutionDetail(data.detail);
      }
      if (data.result?.batchId) {
        setSelectedBatchId(data.result.batchId);
      }
      await loadUsers();
      if (selectedUserId) {
        await loadDetail(selectedUserId);
      }
      setSuccess("失败用户已重试。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "批次重试失败");
    } finally {
      setPendingAction("");
    }
  }

  async function rollbackBatch(batchId: string) {
    setPendingAction("rollback_batch");
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/member/campaign-executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rollback_batch", batchId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: CampaignExecutionDetail | null;
        campaigns?: MemberCampaignRecord[];
        dashboard?: DashboardPayload["dashboard"];
        result?: { batchId: string };
      };
      if (!response.ok) {
        throw new Error(data.error || "批次回滚失败");
      }

      if (data.campaigns) {
        setCampaigns(data.campaigns);
      }
      if (data.dashboard) {
        setDashboard((current) => (current ? { dashboard: data.dashboard!, rules: current.rules } : current));
      }
      if (data.detail) {
        setExecutionDetail(data.detail);
      }
      if (data.result?.batchId) {
        setSelectedBatchId(data.result.batchId);
      }
      await loadUsers();
      if (selectedUserId) {
        await loadDetail(selectedUserId);
      }
      setSuccess("批次已回滚。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "批次回滚失败");
    } finally {
      setPendingAction("");
    }
  }

  function exportExecutionResultsCsv() {
    if (!executionDetail || filteredExecutionResults.length === 0) {
      setError("当前没有可导出的执行结果。");
      return;
    }
    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = filteredExecutionResults.map((item) =>
      [
        executionDetail.batch.batchId,
        executionDetail.batch.campaignName,
        item.userId,
        item.nickname,
        item.maskedPhone ?? "",
        formatExecutionStatus(item.status),
        item.detail,
        item.createdAt,
      ]
        .map((cell) => escapeCell(String(cell)))
        .join(","),
    );
    const csv = [
      "\uFEFF批次ID,活动名称,用户ID,昵称,手机号,执行状态,结果说明,执行时间",
      ...rows,
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `member-campaign-${executionDetail.batch.batchId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSuccess("执行结果已导出。");
  }

  function exportMemberLogs() {
    const params = new URLSearchParams();
    params.set("logType", exportForm.logType);
    if (exportForm.userId.trim()) {
      params.set("userId", exportForm.userId.trim());
    }
    if (exportForm.startDate) {
      params.set("startDate", exportForm.startDate);
    }
    if (exportForm.endDate) {
      params.set("endDate", exportForm.endDate);
    }
    if (exportForm.batchId.trim()) {
      params.set("batchId", exportForm.batchId.trim());
    }
    if (exportForm.status.trim()) {
      params.set("status", exportForm.status.trim());
    }
    const anchor = document.createElement("a");
    anchor.href = `/api/admin/member/export?${params.toString()}`;
    anchor.click();
    setSuccess("会员日志导出已开始。");
  }

  return (
    <div className="admin-page member-admin-page">
      <header className="admin-page-header">
        <p className="eyebrow">Membership Console</p>
        <div className="admin-page-header-row">
          <div>
            <h1>会员管理</h1>
            <p className="admin-page-desc">等级、成长值、权益统一管理，直接联动现有账号体系。</p>
          </div>
        </div>
      </header>

      {error ? <div className="auth-banner error">{error}</div> : null}
      {success ? <div className="auth-banner success">{success}</div> : null}

      <section className="admin-summary-grid member-admin-summary-grid">
        <article className="admin-summary-card info">
          <span>会员用户</span>
          <strong>{dashboard?.dashboard.overview.metricUsers ?? "--"}</strong>
          <p>渗透率 {dashboard ? `${(dashboard.dashboard.overview.memberPenetrationRate * 100).toFixed(1)}%` : "--"}</p>
        </article>
        <article className="admin-summary-card success">
          <span>高等级</span>
          <strong>{dashboard?.dashboard.overview.highLevelUsers ?? "--"}</strong>
          <p>30 天活跃率 {dashboard ? `${(dashboard.dashboard.overview.highLevelActiveRate30d * 100).toFixed(1)}%` : "--"}</p>
        </article>
        <article className="admin-summary-card warning">
          <span>观察期</span>
          <strong>{dashboard?.dashboard.overview.graceUsers ?? "--"}</strong>
          <p>需重点运营干预</p>
        </article>
        <article className="admin-summary-card info">
          <span>可用积分</span>
          <strong>{dashboard?.dashboard.overview.totalAvailablePoints ?? "--"}</strong>
          <p>当前会员总积分池</p>
        </article>
        <article className="admin-summary-card danger">
          <span>冻结中</span>
          <strong>{dashboard?.dashboard.overview.frozenUsers ?? "--"}</strong>
          <p>账号封禁已同步冻结权益</p>
        </article>
        <article className="admin-summary-card success">
          <span>7日升级</span>
          <strong>{dashboard?.dashboard.overview.upgradeUsers7d ?? "--"}</strong>
          <p>降级 {dashboard?.dashboard.overview.downgradeUsers7d ?? "--"}</p>
        </article>
        <article className="admin-summary-card info">
          <span>7日发权益</span>
          <strong>{dashboard?.dashboard.overview.benefitGrantCount7d ?? "--"}</strong>
          <p>覆盖 {dashboard?.dashboard.overview.benefitGrantUsers7d ?? "--"} 人</p>
        </article>
        <article className="admin-summary-card warning">
          <span>30天活跃</span>
          <strong>{dashboard?.dashboard.overview.growthUsers30d ?? "--"}</strong>
          <p>积分活跃 {dashboard?.dashboard.overview.pointUsers30d ?? "--"}</p>
        </article>
        <article className="admin-summary-card info">
          <span>7日活动执行</span>
          <strong>{dashboard?.dashboard.overview.campaignExecutions7d ?? "--"}</strong>
          <p>最近活动已计入看板</p>
        </article>
        <article className="admin-summary-card warning">
          <span>30天权益命中</span>
          <strong>{dashboard?.dashboard.overview.totalBenefitHits30d ?? "--"}</strong>
          <p>覆盖 {dashboard?.dashboard.overview.benefitUsedUsers30d ?? "--"} 人</p>
        </article>
        <article className="admin-summary-card danger">
          <span>30天拦截</span>
          <strong>{dashboard?.dashboard.overview.blockedBenefitHits30d ?? "--"}</strong>
          <p>额度不足或超限次数</p>
        </article>
      </section>

      <section className="panel admin-tool-card">
        <form className="admin-toolbar-grid compact" onSubmit={handleSearchSubmit}>
          <label className="setting-field wide">
            <span>搜索</span>
            <input
              className="setting-input"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setUserPage(1);
              }}
              placeholder="昵称 / 手机号 / userId"
            />
          </label>
          <label className="setting-field wide">
            <span>等级</span>
            <select
              className="setting-select"
              value={levelCode}
              onChange={(event) => {
                setLevelCode(event.target.value as LevelCode | "");
                setUserPage(1);
              }}
            >
              <option value="">全部</option>
              {dashboard?.rules.levels.map((item) => (
                <option key={item.levelCode} value={item.levelCode}>
                  {item.levelCode} {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field wide">
            <span>会员状态</span>
            <select
              className="setting-select"
              value={memberStatus}
              onChange={(event) => {
                setMemberStatus(event.target.value as MemberStatus | "");
                setUserPage(1);
              }}
            >
              <option value="">全部</option>
              <option value="active">正常</option>
              <option value="grace">观察期</option>
              <option value="frozen">冻结</option>
            </select>
          </label>
          <div className="admin-toolbar-actions">
            <button type="submit" className="auth-submit-button" disabled={loading}>
              {loading ? "加载中..." : "查询"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel admin-tool-card">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Export</p>
            <h3>日志导出</h3>
          </div>
        </div>
        <div className="admin-toolbar-grid compact">
          <label className="setting-field wide">
            <span>日志类型</span>
            <select
              className="setting-select"
              value={exportForm.logType}
              onChange={(event) =>
                setExportForm((current) => ({ ...current, logType: event.target.value as MemberExportLogType }))
              }
            >
              <option value="growth">成长流水</option>
              <option value="points">积分流水</option>
              <option value="benefit_grants">权益发放</option>
              <option value="benefit_usage">权益命中</option>
              <option value="campaign_results">活动结果</option>
            </select>
          </label>
          <label className="setting-field wide">
            <span>用户 ID</span>
            <input
              className="setting-input"
              value={exportForm.userId}
              onChange={(event) => setExportForm((current) => ({ ...current, userId: event.target.value }))}
              placeholder="可选，按用户筛选"
            />
          </label>
          <label className="setting-field wide">
            <span>开始日期</span>
            <input
              className="setting-input"
              type="date"
              value={exportForm.startDate}
              onChange={(event) => setExportForm((current) => ({ ...current, startDate: event.target.value }))}
            />
          </label>
          <label className="setting-field wide">
            <span>结束日期</span>
            <input
              className="setting-input"
              type="date"
              value={exportForm.endDate}
              onChange={(event) => setExportForm((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>
          <label className="setting-field wide">
            <span>批次 ID</span>
            <input
              className="setting-input"
              value={exportForm.batchId}
              onChange={(event) => setExportForm((current) => ({ ...current, batchId: event.target.value }))}
              placeholder="活动结果导出时可选"
            />
          </label>
          <label className="setting-field wide">
            <span>状态</span>
            <input
              className="setting-input"
              value={exportForm.status}
              onChange={(event) => setExportForm((current) => ({ ...current, status: event.target.value }))}
              placeholder="如 active / blocked / failed"
            />
          </label>
          <div className="admin-toolbar-actions">
            <button type="button" className="toolbar-button" onClick={exportMemberLogs}>
              导出当前日志
            </button>
          </div>
        </div>
      </section>

      <section className="member-admin-layout">
        <article className="panel member-admin-list">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Members</p>
              <h3>会员用户</h3>
            </div>
            <span className="table-meta">{userPagination.total} 人</span>
          </div>

          <div className="member-admin-user-list">
            {users.map((item) => (
              <button
                key={item.userId}
                type="button"
                className={`member-admin-user-row ${selectedUserId === item.userId ? "active" : ""}`}
                onClick={() => setSelectedUserId(item.userId)}
              >
                <div className="member-admin-user-head">
                  <strong>{item.nickname}</strong>
                  <span>
                    {item.currentLevelCode} · {formatMemberStatus(item.memberStatus)}
                  </span>
                </div>
                <div className="member-admin-user-meta">
                  <span>{item.maskedPhone ?? item.userId}</span>
                  <b>
                    成长 {item.effectiveGrowthValue} · 积分 {item.availablePoints}
                  </b>
                </div>
              </button>
            ))}
            {!loading && users.length === 0 ? <div className="member-empty-inline">暂无匹配用户</div> : null}
          </div>

          <div className="admin-record-footer">
            <span className="admin-pagination-info">
              第 {userPagination.page} / {userPagination.totalPages} 页 · 共 {userPagination.total} 人
            </span>
            <div className="admin-pagination">
              <button
                type="button"
                className="toolbar-button"
                disabled={loading || userPagination.page <= 1}
                onClick={() => setUserPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="toolbar-button"
                disabled={loading || userPagination.page >= userPagination.totalPages}
                onClick={() => setUserPage((current) => Math.min(userPagination.totalPages, current + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </article>

        <article className="panel member-admin-detail">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Detail</p>
              <h3>{selectedSummary ? `${selectedSummary.nickname} 的会员详情` : "请选择会员用户"}</h3>
            </div>
          </div>

          {detailLoading ? <div className="member-empty-inline">详情加载中...</div> : null}

          {detail ? (
            <div className="member-admin-detail-stack">
              <section className="member-admin-mini-grid">
                <div className="member-admin-mini-card">
                  <span>当前等级</span>
                  <strong>{detail.summary.currentLevelCode}</strong>
                  <p>{detail.summary.currentLevelName}</p>
                </div>
                <div className="member-admin-mini-card">
                  <span>成长值</span>
                  <strong>{detail.profile.effectiveGrowthValue}</strong>
                  <p>累计 {detail.profile.lifetimeGrowthValue}</p>
                </div>
                <div className="member-admin-mini-card">
                  <span>可用积分</span>
                  <strong>{detail.pointsAccount?.availablePoints ?? 0}</strong>
                  <p>累计 {detail.pointsAccount?.lifetimePoints ?? 0}</p>
                </div>
                <div className="member-admin-mini-card">
                  <span>下一等级差值</span>
                  <strong>{detail.profile.nextLevelGap}</strong>
                  <p>{detail.profile.graceExpireAt ? `观察期至 ${formatDateTime(detail.profile.graceExpireAt)}` : "当前无观察期"}</p>
                </div>
                <div className="member-admin-mini-card">
                  <span>最近登录</span>
                  <strong>{formatDateTime(detail.summary.lastLoginAt)}</strong>
                  <p>{detail.summary.maskedPhone ?? detail.summary.userId}</p>
                </div>
              </section>

              <section className="member-admin-form-grid">
                <form
                  className="member-admin-form-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAction(
                      {
                        action: "adjust_level",
                        userId: detail.summary.userId,
                        levelCode: levelForm.levelCode,
                        effectiveDays: levelForm.effectiveDays ? Number(levelForm.effectiveDays) : null,
                        reason: levelForm.reason,
                      },
                      "会员等级已更新。",
                    );
                  }}
                >
                  <div className="member-admin-form-head">
                    <strong>手动调级</strong>
                    <span>支持自动回归规则</span>
                  </div>
                  <select
                    className="setting-select"
                    value={levelForm.levelCode}
                    onChange={(event) => setLevelForm((current) => ({ ...current, levelCode: event.target.value }))}
                  >
                    <option value="auto">恢复自动等级</option>
                    {dashboard?.rules.levels.map((item) => (
                      <option key={item.levelCode} value={item.levelCode}>
                        {item.levelCode} {item.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="setting-input"
                    type="number"
                    min="1"
                    value={levelForm.effectiveDays}
                    onChange={(event) => setLevelForm((current) => ({ ...current, effectiveDays: event.target.value }))}
                    placeholder="临时有效天数，可留空"
                  />
                  <input
                    className="setting-input"
                    value={levelForm.reason}
                    onChange={(event) => setLevelForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="调整原因"
                  />
                  <button type="submit" className="auth-submit-button" disabled={pendingAction === "adjust_level"}>
                    {pendingAction === "adjust_level" ? "处理中..." : "提交调级"}
                  </button>
                </form>

                <form
                  className="member-admin-form-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAction(
                      {
                        action: "adjust_growth",
                        userId: detail.summary.userId,
                        changeValue: Number(growthForm.changeValue),
                        reason: growthForm.reason,
                      },
                      "成长值已调整。",
                    );
                  }}
                >
                  <div className="member-admin-form-head">
                    <strong>成长值调整</strong>
                    <span>正数补偿，负数扣减</span>
                  </div>
                  <input
                    className="setting-input"
                    type="number"
                    value={growthForm.changeValue}
                    onChange={(event) => setGrowthForm((current) => ({ ...current, changeValue: event.target.value }))}
                    placeholder="例如 50 / -20"
                  />
                  <input
                    className="setting-input"
                    value={growthForm.reason}
                    onChange={(event) => setGrowthForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="调整原因"
                  />
                  <button type="submit" className="auth-submit-button" disabled={pendingAction === "adjust_growth"}>
                    {pendingAction === "adjust_growth" ? "处理中..." : "提交成长值"}
                  </button>
                </form>

                <form
                  className="member-admin-form-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAction(
                      {
                        action: "adjust_points",
                        userId: detail.summary.userId,
                        changeValue: Number(pointsForm.changeValue),
                        reason: pointsForm.reason,
                      },
                      "积分已调整。",
                    );
                  }}
                >
                  <div className="member-admin-form-head">
                    <strong>积分调整</strong>
                    <span>正数补发，负数扣减</span>
                  </div>
                  <input
                    className="setting-input"
                    type="number"
                    value={pointsForm.changeValue}
                    onChange={(event) => setPointsForm((current) => ({ ...current, changeValue: event.target.value }))}
                    placeholder="例如 30 / -10"
                  />
                  <input
                    className="setting-input"
                    value={pointsForm.reason}
                    onChange={(event) => setPointsForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="调整原因"
                  />
                  <button type="submit" className="auth-submit-button" disabled={pendingAction === "adjust_points"}>
                    {pendingAction === "adjust_points" ? "处理中..." : "提交积分"}
                  </button>
                </form>

                <form
                  className="member-admin-form-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAction(
                      {
                        action: "grant_benefit",
                        userId: detail.summary.userId,
                        benefitKey: benefitForm.benefitKey,
                        benefitValue: benefitForm.benefitValue,
                        effectiveDays: benefitForm.effectiveDays ? Number(benefitForm.effectiveDays) : null,
                        reason: benefitForm.reason,
                      },
                      "会员权益已发放。",
                    );
                  }}
                >
                  <div className="member-admin-form-head">
                    <strong>发放权益</strong>
                    <span>活动赠送 / 补偿发放</span>
                  </div>
                  <select
                    className="setting-select"
                    value={benefitForm.benefitKey}
                    onChange={(event) => setBenefitForm((current) => ({ ...current, benefitKey: event.target.value }))}
                  >
                    <option value="">选择权益</option>
                    {dashboard?.rules.benefitDefinitions.map((item) => (
                      <option key={item.benefitKey} value={item.benefitKey}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="setting-input"
                    value={benefitForm.benefitValue}
                    onChange={(event) => setBenefitForm((current) => ({ ...current, benefitValue: event.target.value }))}
                    placeholder="权益值，例如 unlimited / 1.2 / 高优先"
                  />
                  <input
                    className="setting-input"
                    type="number"
                    min="1"
                    value={benefitForm.effectiveDays}
                    onChange={(event) => setBenefitForm((current) => ({ ...current, effectiveDays: event.target.value }))}
                    placeholder="有效天数，可留空"
                  />
                  <input
                    className="setting-input"
                    value={benefitForm.reason}
                    onChange={(event) => setBenefitForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="发放原因"
                  />
                  <button type="submit" className="auth-submit-button" disabled={pendingAction === "grant_benefit"}>
                    {pendingAction === "grant_benefit" ? "处理中..." : "发放权益"}
                  </button>
                </form>
              </section>

              <section className="member-card-grid admin">
                <div className="member-surface muted">
                  <div className="member-section-head">
                    <strong>当前权益</strong>
                    <span>{detail.effectiveBenefits.length} 项</span>
                  </div>
                  <div className="member-chip-grid">
                    {detail.effectiveBenefits.map((item) => (
                      <div key={item.benefitKey} className="member-admin-chip">
                        <strong>{item.name}</strong>
                        <span>{formatBenefitValue(item.value, item.unit)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="member-surface muted">
                  <div className="member-section-head">
                    <strong>最近成长流水</strong>
                    <span>{detail.growthRecords.length} 条</span>
                  </div>
                  <div className="member-record-list compact">
                    {detail.growthRecords.map((item) => (
                      <div key={item.growthId} className="member-record-item">
                        <div>
                          <strong>{item.remark || item.eventType}</strong>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                        <b className={item.effectiveValue >= 0 ? "positive" : "negative"}>
                          {item.effectiveValue >= 0 ? "+" : ""}
                          {item.effectiveValue}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="member-card-grid admin">
                <div className="member-surface muted">
                  <div className="member-section-head">
                    <strong>最近积分流水</strong>
                    <span>{detail.pointRecords.length} 条</span>
                  </div>
                  <div className="member-record-list compact">
                    {detail.pointRecords.map((item) => (
                      <div key={item.pointId} className="member-record-item">
                        <div>
                          <strong>{item.remark || item.eventType}</strong>
                          <span>
                            {formatDateTime(item.createdAt)}
                            {item.expireAt ? ` · ${formatDateTime(item.expireAt)} 到期` : ""}
                          </span>
                        </div>
                        <b className={item.changeValue >= 0 ? "positive" : "negative"}>
                          {item.changeValue >= 0 ? "+" : ""}
                          {item.changeValue}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="member-surface muted">
                  <div className="member-section-head">
                    <strong>等级变更</strong>
                    <span>{detail.levelChanges.length} 条</span>
                  </div>
                  <div className="member-record-list compact">
                    {detail.levelChanges.map((item) => (
                      <div key={item.changeId} className="member-record-item">
                        <div>
                          <strong>
                            {item.fromLevelCode ?? "初始化"} → {item.toLevelCode}
                          </strong>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                        <b>{item.reasonDetail}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="member-card-grid admin">
                <div className="member-surface muted">
                  <div className="member-section-head">
                    <strong>权益发放</strong>
                    <span>{detail.grantedBenefits.length} 条</span>
                  </div>
                  <div className="member-record-list compact">
                    {detail.grantedBenefits.map((item) => (
                      <div key={item.grantId} className="member-record-item">
                        <div>
                          <strong>{item.benefitName}</strong>
                          <span>
                            {formatDateTime(item.createdAt)} · {formatGrantStatus(item.status)}
                            {item.expireAt ? ` · ${formatDateTime(item.expireAt)} 失效` : ""}
                          </span>
                        </div>
                        <div className="member-rule-button-row">
                          <b>{item.benefitValue}</b>
                          {item.status === "active" ? (
                            <button
                              type="button"
                              className="toolbar-button"
                              onClick={() =>
                                void submitAction(
                                  {
                                    action: "revoke_benefit",
                                    userId: detail.summary.userId,
                                    grantId: item.grantId,
                                    reason: `撤回权益 ${item.benefitName}`,
                                  },
                                  "权益已撤回。",
                                )
                              }
                            >
                              撤回
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="member-surface muted">
                  <div className="member-section-head">
                    <strong>权益命中</strong>
                    <span>{detail.benefitUsageRecords.length} 条</span>
                  </div>
                  <div className="member-record-list compact">
                    {detail.benefitUsageRecords.map((item) => (
                      <div key={item.usageId} className="member-record-item">
                        <div>
                          <strong>
                            {item.benefitName} · {formatUsageSource(item.sourceBizType)}
                          </strong>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                        <b className={item.resultStatus === "blocked" ? "negative" : "positive"}>
                          {item.currentCount} → {item.nextCount}
                          {item.limitValue ? ` / ${item.limitValue}` : ""}
                          {item.resultStatus === "blocked" ? " 已拦截" : " 已放行"}
                        </b>
                      </div>
                    ))}
                    {detail.benefitUsageRecords.length === 0 ? <div className="member-empty-inline">最近暂无权益命中记录</div> : null}
                  </div>
                </div>

                <div className="member-surface muted">
                  <div className="member-section-head">
                    <strong>操作日志</strong>
                    <span>{detail.operationLogs.length} 条</span>
                  </div>
                  <div className="member-record-list compact">
                    {detail.operationLogs.map((item) => (
                      <div key={item.operateId} className="member-record-item">
                        <div>
                          <strong>{item.actionType}</strong>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                        <b>{item.detail}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          ) : !detailLoading ? (
            <div className="member-empty-inline">请选择左侧会员用户查看详情</div>
          ) : null}
        </article>
      </section>

      <section className="member-rule-admin-grid">
        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Config</p>
              <h3>系统配置</h3>
            </div>
          </div>
          {systemConfigForm && pointsConfigForm ? (
            <div className="member-rule-admin-stack">
              <div className="member-rule-toggle-grid">
                <label className="setting-field">
                  <span>会员中心</span>
                  <select
                    className="setting-select"
                    value={systemConfigForm.memberCenterEnabled ? "1" : "0"}
                    onChange={(event) =>
                      setSystemConfigForm((current) =>
                        current ? { ...current, memberCenterEnabled: event.target.value === "1" } : current,
                      )
                    }
                  >
                    <option value="1">开启</option>
                    <option value="0">关闭</option>
                  </select>
                </label>
                <label className="setting-field">
                  <span>成长值</span>
                  <select
                    className="setting-select"
                    value={systemConfigForm.memberGrowthEnabled ? "1" : "0"}
                    onChange={(event) =>
                      setSystemConfigForm((current) =>
                        current ? { ...current, memberGrowthEnabled: event.target.value === "1" } : current,
                      )
                    }
                  >
                    <option value="1">开启</option>
                    <option value="0">关闭</option>
                  </select>
                </label>
                <label className="setting-field">
                  <span>权益控制</span>
                  <select
                    className="setting-select"
                    value={systemConfigForm.memberBenefitEnforcementEnabled ? "1" : "0"}
                    onChange={(event) =>
                      setSystemConfigForm((current) =>
                        current ? { ...current, memberBenefitEnforcementEnabled: event.target.value === "1" } : current,
                      )
                    }
                  >
                    <option value="1">开启</option>
                    <option value="0">关闭</option>
                  </select>
                </label>
                <label className="setting-field">
                  <span>后台入口</span>
                  <select
                    className="setting-select"
                    value={systemConfigForm.memberAdminEnabled ? "1" : "0"}
                    onChange={(event) =>
                      setSystemConfigForm((current) =>
                        current ? { ...current, memberAdminEnabled: event.target.value === "1" } : current,
                      )
                    }
                  >
                    <option value="1">开启</option>
                    <option value="0">关闭</option>
                  </select>
                </label>
                <label className="setting-field">
                  <span>成长有效期</span>
                  <input
                    className="setting-input"
                    type="number"
                    min="1"
                    value={systemConfigForm.growthExpireDays}
                    onChange={(event) =>
                      setSystemConfigForm((current) =>
                        current ? { ...current, growthExpireDays: Number(event.target.value || 0) } : current,
                      )
                    }
                  />
                </label>
                <label className="setting-field">
                  <span>观察期天数</span>
                  <input
                    className="setting-input"
                    type="number"
                    min="1"
                    value={systemConfigForm.gracePeriodDays}
                    onChange={(event) =>
                      setSystemConfigForm((current) =>
                        current ? { ...current, gracePeriodDays: Number(event.target.value || 0) } : current,
                      )
                    }
                  />
                </label>
                <label className="setting-field">
                  <span>积分启用</span>
                  <select
                    className="setting-select"
                    value={pointsConfigForm.pointsEnabled ? "1" : "0"}
                    onChange={(event) =>
                      setPointsConfigForm((current) =>
                        current ? { ...current, pointsEnabled: event.target.value === "1" } : current,
                      )
                    }
                  >
                    <option value="1">开启</option>
                    <option value="0">关闭</option>
                  </select>
                </label>
                <label className="setting-field">
                  <span>积分有效期</span>
                  <input
                    className="setting-input"
                    type="number"
                    min="0"
                    value={pointsConfigForm.defaultExpireDays ?? ""}
                    onChange={(event) =>
                      setPointsConfigForm((current) =>
                        current
                          ? {
                              ...current,
                              defaultExpireDays: event.target.value ? Number(event.target.value) : null,
                            }
                          : current,
                      )
                    }
                    placeholder="留空表示不过期"
                  />
                </label>
              </div>
              <div className="member-rule-actions">
                <button
                  type="button"
                  className="auth-submit-button"
                  disabled={pendingAction === "update_config"}
                  onClick={() => {
                    if (!systemConfigForm || !pointsConfigForm) {
                      return;
                    }
                    void submitRuleAction(
                      {
                        action: "update_config",
                        memberConfig: systemConfigForm,
                        pointsConfig: pointsConfigForm,
                      },
                      "系统配置已保存。",
                    );
                  }}
                >
                  {pendingAction === "update_config" ? "保存中..." : "保存配置"}
                </button>
              </div>
            </div>
          ) : null}
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Levels</p>
              <h3>等级门槛</h3>
            </div>
          </div>
          <div className="member-rule-editor-table">
            {editableLevels.map((item) => (
              <div key={item.levelCode} className="member-rule-editor-row">
                <strong>
                  {item.levelCode}
                </strong>
                <input
                  className="setting-input"
                  value={item.name}
                  onChange={(event) =>
                    setEditableLevels((current) =>
                      current.map((level) =>
                        level.levelCode === item.levelCode ? { ...level, name: event.target.value } : level,
                      ),
                    )
                  }
                />
                <input
                  className="setting-input"
                  type="number"
                  value={item.upgradeThreshold}
                  onChange={(event) =>
                    setEditableLevels((current) =>
                      current.map((level) =>
                        level.levelCode === item.levelCode
                          ? { ...level, upgradeThreshold: Number(event.target.value || 0) }
                          : level,
                      ),
                    )
                  }
                />
                <input
                  className="setting-input"
                  type="number"
                  value={item.retainThreshold}
                  onChange={(event) =>
                    setEditableLevels((current) =>
                      current.map((level) =>
                        level.levelCode === item.levelCode
                          ? { ...level, retainThreshold: Number(event.target.value || 0) }
                          : level,
                      ),
                    )
                  }
                />
                <input
                  className="setting-input"
                  value={item.badgeLabel}
                  onChange={(event) =>
                    setEditableLevels((current) =>
                      current.map((level) =>
                        level.levelCode === item.levelCode ? { ...level, badgeLabel: event.target.value } : level,
                      ),
                    )
                  }
                />
                <select
                  className="setting-select"
                  value={item.enabled ? "1" : "0"}
                  onChange={(event) =>
                    setEditableLevels((current) =>
                      current.map((level) =>
                        level.levelCode === item.levelCode ? { ...level, enabled: event.target.value === "1" } : level,
                      ),
                    )
                  }
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </div>
            ))}
          </div>
          <div className="member-rule-actions">
            <button
              type="button"
              className="auth-submit-button"
              disabled={pendingAction === "update_levels"}
              onClick={() => void submitRuleAction({ action: "update_levels", levels: editableLevels }, "等级规则已保存。")}
            >
              {pendingAction === "update_levels" ? "保存中..." : "保存等级"}
            </button>
          </div>
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Growth</p>
              <h3>成长规则</h3>
            </div>
          </div>
          <div className="member-rule-editor-table">
            {editableGrowthRules.map((item) => (
              <div key={item.ruleCode} className="member-rule-editor-row compact">
                <strong>{item.name}</strong>
                <input
                  className="setting-input"
                  type="number"
                  value={item.growthValue}
                  onChange={(event) =>
                    setEditableGrowthRules((current) =>
                      current.map((rule) =>
                        rule.ruleCode === item.ruleCode ? { ...rule, growthValue: Number(event.target.value || 0) } : rule,
                      ),
                    )
                  }
                />
                <input
                  className="setting-input"
                  type="number"
                  min="0"
                  value={item.dailyLimit ?? ""}
                  onChange={(event) =>
                    setEditableGrowthRules((current) =>
                      current.map((rule) =>
                        rule.ruleCode === item.ruleCode
                          ? { ...rule, dailyLimit: event.target.value ? Number(event.target.value) : null }
                          : rule,
                      ),
                    )
                  }
                  placeholder="日上限"
                />
                <select
                  className="setting-select"
                  value={item.enabled ? "1" : "0"}
                  onChange={(event) =>
                    setEditableGrowthRules((current) =>
                      current.map((rule) =>
                        rule.ruleCode === item.ruleCode ? { ...rule, enabled: event.target.value === "1" } : rule,
                      ),
                    )
                  }
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </div>
            ))}
          </div>
          <div className="member-rule-actions">
            <button
              type="button"
              className="auth-submit-button"
              disabled={pendingAction === "update_growth_rules"}
              onClick={() =>
                void submitRuleAction({ action: "update_growth_rules", growthRules: editableGrowthRules }, "成长规则已保存。")
              }
            >
              {pendingAction === "update_growth_rules" ? "保存中..." : "保存成长规则"}
            </button>
          </div>
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Points</p>
              <h3>积分规则</h3>
            </div>
          </div>
          <div className="member-rule-editor-table">
            {editablePointRules.map((item) => (
              <div key={item.ruleCode} className="member-rule-editor-row compact">
                <strong>{item.name}</strong>
                <input
                  className="setting-input"
                  type="number"
                  value={item.pointValue}
                  onChange={(event) =>
                    setEditablePointRules((current) =>
                      current.map((rule) =>
                        rule.ruleCode === item.ruleCode ? { ...rule, pointValue: Number(event.target.value || 0) } : rule,
                      ),
                    )
                  }
                />
                <input
                  className="setting-input"
                  type="number"
                  min="0"
                  value={item.dailyLimit ?? ""}
                  onChange={(event) =>
                    setEditablePointRules((current) =>
                      current.map((rule) =>
                        rule.ruleCode === item.ruleCode
                          ? { ...rule, dailyLimit: event.target.value ? Number(event.target.value) : null }
                          : rule,
                      ),
                    )
                  }
                  placeholder="日上限"
                />
                <select
                  className="setting-select"
                  value={item.enabled ? "1" : "0"}
                  onChange={(event) =>
                    setEditablePointRules((current) =>
                      current.map((rule) =>
                        rule.ruleCode === item.ruleCode ? { ...rule, enabled: event.target.value === "1" } : rule,
                      ),
                    )
                  }
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </div>
            ))}
          </div>
          <div className="member-rule-actions">
            <button
              type="button"
              className="auth-submit-button"
              disabled={pendingAction === "update_point_rules"}
              onClick={() =>
                void submitRuleAction({ action: "update_point_rules", pointRules: editablePointRules }, "积分规则已保存。")
              }
            >
              {pendingAction === "update_point_rules" ? "保存中..." : "保存积分规则"}
            </button>
          </div>
        </article>

        <article className="panel member-rule-admin-card full">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Benefits</p>
              <h3>等级权益映射</h3>
            </div>
          </div>
          <div className="member-rule-editor-table">
            {editableBenefitMaps.map((item) => (
              <div key={item.mapId} className="member-rule-editor-row benefit">
                <strong>{item.levelCode}</strong>
                <span className="member-rule-label">{benefitDefinitionMap.get(item.benefitKey)?.name ?? item.benefitKey}</span>
                <input
                  className="setting-input"
                  value={String(item.benefitValue)}
                  onChange={(event) =>
                    setEditableBenefitMaps((current) =>
                      current.map((map) =>
                        map.mapId === item.mapId ? { ...map, benefitValue: event.target.value } : map,
                      ),
                    )
                  }
                />
                <select
                  className="setting-select"
                  value={item.enabled ? "1" : "0"}
                  onChange={(event) =>
                    setEditableBenefitMaps((current) =>
                      current.map((map) =>
                        map.mapId === item.mapId ? { ...map, enabled: event.target.value === "1" } : map,
                      ),
                    )
                  }
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </div>
            ))}
          </div>
          <div className="member-rule-actions">
            <button
              type="button"
              className="auth-submit-button"
              disabled={pendingAction === "update_benefit_maps"}
              onClick={() =>
                void submitRuleAction(
                  { action: "update_benefit_maps", levelBenefitMaps: editableBenefitMaps },
                  "权益映射已保存。",
                )
              }
            >
              {pendingAction === "update_benefit_maps" ? "保存中..." : "保存权益映射"}
            </button>
          </div>
        </article>
      </section>

      <section className="member-rule-admin-grid">
        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Campaign</p>
              <h3>运营活动</h3>
            </div>
          </div>
          <div className="member-rule-admin-stack">
            <div className="member-rule-toggle-grid">
              <label className="setting-field">
                <span>活动名称</span>
                <input
                  className="setting-input"
                  value={campaignForm.name}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：五一限时升级"
                />
              </label>
              <label className="setting-field">
                <span>活动状态</span>
                <select
                  className="setting-select"
                  value={campaignForm.enabled ? "1" : "0"}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, enabled: event.target.value === "1" }))}
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </label>
              <label className="setting-field">
                <span>目标人群</span>
                <select
                  className="setting-select"
                  value={campaignForm.targetType}
                  onChange={(event) =>
                    setCampaignForm((current) => ({ ...current, targetType: event.target.value as MemberCampaignTargetType }))
                  }
                >
                  <option value="all_metric_users">全部会员</option>
                  <option value="levels">按等级</option>
                  <option value="user_ids">按用户</option>
                </select>
              </label>
              <label className="setting-field">
                <span>发放类型</span>
                <select
                  className="setting-select"
                  value={campaignForm.grantType}
                  onChange={(event) =>
                    setCampaignForm((current) => ({ ...current, grantType: event.target.value as MemberCampaignGrantType }))
                  }
                >
                  <option value="growth">成长值</option>
                  <option value="points">积分</option>
                  <option value="benefit">权益</option>
                  <option value="level">等级</option>
                </select>
              </label>
            </div>

            {campaignForm.targetType === "levels" ? (
              <div className="member-campaign-levels">
                {(dashboard?.rules.levels ?? []).map((level) => {
                  const active = campaignForm.targetLevelCodes.includes(level.levelCode);
                  return (
                    <button
                      key={level.levelCode}
                      type="button"
                      className={`member-pill ${active ? "accent" : ""}`}
                      onClick={() =>
                        setCampaignForm((current) => ({
                          ...current,
                          targetLevelCodes: active
                            ? current.targetLevelCodes.filter((item) => item !== level.levelCode)
                            : [...current.targetLevelCodes, level.levelCode],
                        }))
                      }
                    >
                      {level.levelCode}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {campaignForm.targetType === "user_ids" ? (
              <label className="setting-field">
                <span>目标用户</span>
                <textarea
                  className="setting-textarea"
                  rows={4}
                  value={campaignForm.targetUserIdsText}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, targetUserIdsText: event.target.value }))}
                  placeholder="每行一个 userId，也支持逗号分隔"
                />
              </label>
            ) : null}

            <div className="member-rule-toggle-grid">
              {campaignForm.grantType === "growth" ? (
                <label className="setting-field">
                  <span>成长值</span>
                  <input
                    className="setting-input"
                    type="number"
                    value={campaignForm.growthValue}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, growthValue: event.target.value }))}
                  />
                </label>
              ) : null}
              {campaignForm.grantType === "points" ? (
                <label className="setting-field">
                  <span>积分值</span>
                  <input
                    className="setting-input"
                    type="number"
                    value={campaignForm.pointsValue}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, pointsValue: event.target.value }))}
                  />
                </label>
              ) : null}
              {campaignForm.grantType === "benefit" ? (
                <>
                  <label className="setting-field">
                    <span>权益项</span>
                    <select
                      className="setting-select"
                      value={campaignForm.benefitKey}
                      onChange={(event) => setCampaignForm((current) => ({ ...current, benefitKey: event.target.value }))}
                    >
                      <option value="">选择权益</option>
                      {(dashboard?.rules.benefitDefinitions ?? []).map((item) => (
                        <option key={item.benefitKey} value={item.benefitKey}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setting-field">
                    <span>权益值</span>
                    <input
                      className="setting-input"
                      value={campaignForm.benefitValue}
                      onChange={(event) => setCampaignForm((current) => ({ ...current, benefitValue: event.target.value }))}
                    />
                  </label>
                </>
              ) : null}
              {campaignForm.grantType === "level" ? (
                <label className="setting-field">
                  <span>等级</span>
                  <select
                    className="setting-select"
                    value={campaignForm.levelCode}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, levelCode: event.target.value as LevelCode | "" }))}
                  >
                    <option value="">选择等级</option>
                    {(dashboard?.rules.levels ?? []).map((item) => (
                      <option key={item.levelCode} value={item.levelCode}>
                        {item.levelCode} {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {campaignForm.grantType === "benefit" || campaignForm.grantType === "level" ? (
                <label className="setting-field">
                  <span>有效天数</span>
                  <input
                    className="setting-input"
                    type="number"
                    min="1"
                    value={campaignForm.effectiveDays}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, effectiveDays: event.target.value }))}
                    placeholder="留空表示长期有效"
                  />
                </label>
              ) : null}
            </div>

            <label className="setting-field">
              <span>活动备注</span>
              <input
                className="setting-input"
                value={campaignForm.remark}
                onChange={(event) => setCampaignForm((current) => ({ ...current, remark: event.target.value }))}
                placeholder="对用户展示或后台追溯用"
              />
            </label>
            <div className="member-rule-actions between">
              <button type="button" className="toolbar-button" onClick={resetCampaignForm}>
                新建活动
              </button>
              <div className="member-rule-button-row">
                <button
                  type="button"
                  className="auth-submit-button"
                  disabled={pendingAction === "save_campaign"}
                  onClick={() => void saveCampaign(false)}
                >
                  {pendingAction === "save_campaign" ? "保存中..." : "保存活动"}
                </button>
                <button
                  type="button"
                  className="auth-submit-button"
                  disabled={pendingAction === "save_campaign" || pendingAction === "execute_campaign"}
                  onClick={() => void saveCampaign(true)}
                >
                  {pendingAction === "execute_campaign" ? "执行中..." : "保存并执行"}
                </button>
              </div>
            </div>
          </div>
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Recent</p>
              <h3>最近活动</h3>
            </div>
          </div>
          <div className="member-record-list compact">
            {campaigns.map((item) => (
              <div key={item.campaignId} className="member-record-item">
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.enabled ? "启用" : "停用"} · 执行 {item.executionCount} 次
                    {item.lastExecutedAt ? ` · ${formatDateTime(item.lastExecutedAt)}` : ""}
                  </span>
                </div>
                <div className="member-rule-button-row">
                  <button type="button" className="toolbar-button" onClick={() => applyCampaignToForm(item)}>
                    载入
                  </button>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => void submitCampaignAction({ action: "execute_campaign", campaignId: item.campaignId }, "活动已执行。")}
                  >
                    执行
                  </button>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => void submitCampaignAction({ action: "delete_campaign", campaignId: item.campaignId }, "活动已删除。")}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            {campaigns.length === 0 ? <div className="member-empty-inline">暂无活动模板</div> : null}
          </div>
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Executions</p>
              <h3>最近执行批次</h3>
            </div>
          </div>
          <div className="member-record-list compact">
            {(dashboard?.dashboard.recentExecutions ?? []).map((item) => (
              <div key={item.batchId} className="member-record-item">
                <div>
                  <strong>{item.campaignName}</strong>
                  <span>
                    {item.targetSummary} · 计划 {item.plannedUserCount} 人 · 成功 {item.successUserCount} / 失败 {item.failedUserCount}
                  </span>
                </div>
                <div className="member-rule-button-row">
                  <b>{formatDateTime(item.finishedAt ?? item.createdAt)}</b>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => setSelectedBatchId(item.batchId)}
                  >
                    查看
                  </button>
                </div>
              </div>
            ))}
            {(dashboard?.dashboard.recentExecutions ?? []).length === 0 ? (
              <div className="member-empty-inline">暂无执行批次</div>
            ) : null}
          </div>
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Execution Detail</p>
              <h3>批次详情</h3>
            </div>
            <div className="member-rule-button-row">
              {executionDetail ? (
                <button type="button" className="toolbar-button" onClick={exportExecutionResultsCsv}>
                  导出 CSV
                </button>
              ) : null}
              {executionDetail && executionDetail.batch.campaignName.includes("（回滚）") === false ? (
                <button
                  type="button"
                  className="toolbar-button"
                  disabled={pendingAction === "rollback_batch"}
                  onClick={() => void rollbackBatch(executionDetail.batch.batchId)}
                >
                  {pendingAction === "rollback_batch" ? "回滚中..." : "回滚本批次"}
                </button>
              ) : null}
              {executionDetail?.batch.failedUserCount ? (
                <button
                  type="button"
                  className="auth-submit-button"
                  disabled={pendingAction === "retry_failed_batch"}
                  onClick={() => void retryFailedBatch(executionDetail.batch.batchId)}
                >
                  {pendingAction === "retry_failed_batch" ? "重试中..." : "重试失败用户"}
                </button>
              ) : null}
            </div>
          </div>
          {executionLoading ? <div className="member-empty-inline">批次详情加载中...</div> : null}
          {executionDetail ? (
            <div className="member-admin-detail-stack">
              <section className="member-admin-mini-grid">
                <div className="member-admin-mini-card">
                  <span>活动</span>
                  <strong>{executionDetail.batch.campaignName}</strong>
                  <p>{executionDetail.batch.targetSummary}</p>
                </div>
                <div className="member-admin-mini-card">
                  <span>执行结果</span>
                  <strong>
                    {executionDetail.batch.successUserCount}/{executionDetail.batch.plannedUserCount}
                  </strong>
                  <p>失败 {executionDetail.batch.failedUserCount}</p>
                </div>
                <div className="member-admin-mini-card">
                  <span>执行时间</span>
                  <strong>{formatDateTime(executionDetail.batch.finishedAt ?? executionDetail.batch.createdAt)}</strong>
                  <p>{executionDetail.batch.grantType}</p>
                </div>
              </section>
              <section className="admin-toolbar-grid compact">
                <label className="setting-field wide">
                  <span>结果筛选</span>
                  <select
                    className="setting-select"
                    value={executionStatusFilter}
                    onChange={(event) =>
                      setExecutionStatusFilter(event.target.value as "" | "success" | "failed" | "skipped")
                    }
                  >
                    <option value="">全部</option>
                    <option value="success">成功</option>
                    <option value="failed">失败</option>
                    <option value="skipped">跳过</option>
                  </select>
                </label>
                <label className="setting-field wide">
                  <span>关键词</span>
                  <input
                    className="setting-input"
                    value={executionKeyword}
                    onChange={(event) => setExecutionKeyword(event.target.value)}
                    placeholder="昵称 / 手机号 / userId / 失败原因"
                  />
                </label>
              </section>
              <div className="member-record-list compact">
                {pagedExecutionResults.map((item) => (
                  <div key={item.resultId} className="member-record-item">
                    <div>
                      <strong>
                        {item.nickname} · {item.maskedPhone ?? item.userId}
                      </strong>
                      <span>{formatDateTime(item.createdAt)}</span>
                    </div>
                    <b className={item.status === "failed" ? "negative" : item.status === "success" ? "positive" : ""}>
                      {formatExecutionStatus(item.status)} · {item.detail}
                    </b>
                  </div>
                ))}
                {filteredExecutionResults.length === 0 ? <div className="member-empty-inline">当前筛选条件下暂无结果</div> : null}
              </div>
              {filteredExecutionResults.length > 0 ? (
                <div className="member-rule-actions between">
                  <span className="table-meta">
                    第 {Math.min(executionPage, executionPageCount)} / {executionPageCount} 页 · 共 {filteredExecutionResults.length} 条
                  </span>
                  <div className="member-rule-button-row">
                    <button
                      type="button"
                      className="toolbar-button"
                      disabled={executionPage <= 1}
                      onClick={() => setExecutionPage((current) => Math.max(current - 1, 1))}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      className="toolbar-button"
                      disabled={executionPage >= executionPageCount}
                      onClick={() => setExecutionPage((current) => Math.min(current + 1, executionPageCount))}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : !executionLoading ? (
            <div className="member-empty-inline">选择一个执行批次查看详情</div>
          ) : null}
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Benefits</p>
              <h3>权益使用率</h3>
            </div>
          </div>
          <div className="member-record-list compact">
            {(dashboard?.dashboard.benefitUsage ?? []).map((item) => (
              <div key={item.benefitKey} className="member-record-item">
                <div>
                  <strong>{item.benefitName}</strong>
                  <span>
                    使用率 {(item.usageRate30d * 100).toFixed(1)}% · 覆盖 {item.usedUserCount30d}/{item.eligibleUserCount} 人
                  </span>
                </div>
                <b>
                  {item.allowedHitCount30d} 次命中
                  {item.blockedHitCount30d ? ` · ${item.blockedHitCount30d} 次拦截` : ""}
                </b>
              </div>
            ))}
            {(dashboard?.dashboard.benefitUsage ?? []).length === 0 ? (
              <div className="member-empty-inline">最近 30 天暂无权益命中</div>
            ) : null}
          </div>
        </article>

        <article className="panel member-rule-admin-card">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Results</p>
              <h3>最近执行结果</h3>
            </div>
          </div>
          <div className="member-record-list compact">
            {(dashboard?.dashboard.recentExecutionResults ?? []).map((item) => (
              <div key={item.resultId} className="member-record-item">
                <div>
                  <strong>
                    {item.campaignName} · {item.userId}
                  </strong>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
                <b className={item.status === "failed" ? "negative" : item.status === "success" ? "positive" : ""}>
                  {formatExecutionStatus(item.status)} · {item.detail}
                </b>
              </div>
            ))}
            {(dashboard?.dashboard.recentExecutionResults ?? []).length === 0 ? (
              <div className="member-empty-inline">暂无执行结果明细</div>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}
