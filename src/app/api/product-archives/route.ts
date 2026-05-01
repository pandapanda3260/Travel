import { NextRequest, NextResponse } from "next/server";

import { recordAdminDataEvent } from "../../../lib/admin-data-analytics";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../lib/auth-session";
import { grantGrowthForEvent } from "../../../lib/member-service";
import { createProductArchive, listAccessibleProductArchives } from "../../../lib/product-archive-store";
import { getProductArchiveVisionProviderMeta } from "../../../lib/product-archive-vision";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  return NextResponse.json({
    archives: listAccessibleProductArchives(session.userId),
    runtime: getProductArchiveVisionProviderMeta(),
  });
}

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const archive = createProductArchive({ ownerUserId: session.userId });
    recordAdminDataEvent({
      eventName: "product_archive.create",
      actorType: "user",
      actorId: session.userId,
      objectType: "product_archive",
      objectId: archive.archiveId,
    });
    grantGrowthForEvent({
      userId: session.userId,
      eventType: "product_archive_create",
      sourceType: "rule",
      sourceBizId: archive.archiveId,
      idempotentKey: `archive_create:${archive.archiveId}`,
      remark: "创建商品档案",
    });

    return NextResponse.json({
      archive,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建商品档案失败" }, { status: 500 });
  }
}
