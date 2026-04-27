import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import {
  getMemberAdminDashboard,
  getMemberCampaignExecutionDetailForAdmin,
  isMemberAdminEnabled,
  listMemberCampaignsForAdmin,
  MemberBenefitAccessError,
  rollbackMemberCampaignExecutionBatchForAdmin,
  retryFailedMemberCampaignExecutionBatchForAdmin,
} from "../../../../../lib/member-service";

export const dynamic = "force-dynamic";

type ExecutionAction = "retry_failed" | "rollback_batch";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  const batchId = request.nextUrl.searchParams.get("batchId")?.trim();
  if (!batchId) {
    return NextResponse.json({ error: "缺少批次 ID", code: "BATCH_ID_REQUIRED" }, { status: 400 });
  }

  const detail = getMemberCampaignExecutionDetailForAdmin(batchId);
  if (!detail) {
    return NextResponse.json({ error: "批次不存在", code: "EXECUTION_BATCH_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ detail });
}

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  const body = (await request.json()) as {
    action?: ExecutionAction;
    batchId?: string;
  };

  if (!body.batchId?.trim()) {
    return NextResponse.json({ error: "缺少批次 ID", code: "BATCH_ID_REQUIRED" }, { status: 400 });
  }

  if (!body.action) {
    return NextResponse.json({ error: "不支持的批次动作", code: "INVALID_ACTION" }, { status: 400 });
  }

  try {
    let result = null;
    if (body.action === "retry_failed") {
      result = retryFailedMemberCampaignExecutionBatchForAdmin(body.batchId.trim(), { adminId: session.adminId });
    } else if (body.action === "rollback_batch") {
      result = rollbackMemberCampaignExecutionBatchForAdmin(body.batchId.trim(), { adminId: session.adminId });
    } else {
      return NextResponse.json({ error: "不支持的批次动作", code: "INVALID_ACTION" }, { status: 400 });
    }
    if (!result) {
      return NextResponse.json({ error: "批次不存在或活动已停用", code: "EXECUTION_RETRY_NOT_ALLOWED" }, { status: 404 });
    }

    return NextResponse.json({
      result,
      detail: getMemberCampaignExecutionDetailForAdmin(result.batchId),
      campaigns: listMemberCampaignsForAdmin(),
      dashboard: getMemberAdminDashboard(),
    });
  } catch (error) {
    if (error instanceof MemberBenefitAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "批次操作失败", code: "EXECUTION_ACTION_FAILED" }, { status: 500 });
  }
}
