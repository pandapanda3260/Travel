import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { deleteProductArchive, getProductArchive, patchProductArchive, type ProductArchiveKeyInfo, type ProductArchiveParsedData } from "../../../../lib/product-archive-store";

type RouteContext = {
  params: Promise<{
    archiveId: string;
  }>;
};

type UpdateProductArchiveRequest = {
  title?: string;
  parsedText?: string;
  parsedData?: Partial<ProductArchiveParsedData>;
  keyInfo?: Partial<ProductArchiveKeyInfo>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  const { archiveId } = await context.params;
  const archive = getProductArchive(archiveId);
  if (!archive) {
    return NextResponse.json({ error: "商品档案不存在" }, { status: 404 });
  }
  if (archive.ownerUserId && archive.ownerUserId !== session.userId) {
    return NextResponse.json({ error: "无权访问该商品档案", code: "PRODUCT_ARCHIVE_FORBIDDEN" }, { status: 403 });
  }

  return NextResponse.json({ archive });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { archiveId } = await context.params;
    const existing = getProductArchive(archiveId);
    if (!existing) {
      return NextResponse.json({ error: "商品档案不存在" }, { status: 404 });
    }
    if (existing.ownerUserId && existing.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权修改该商品档案", code: "PRODUCT_ARCHIVE_FORBIDDEN" }, { status: 403 });
    }
    const body = (await request.json()) as UpdateProductArchiveRequest;
    const archive = patchProductArchive(archiveId, {
      ...(body.title !== undefined ? { title: body.title.trim() || "未命名商品档案" } : {}),
      ...(body.parsedText !== undefined ? { parsedText: body.parsedText } : {}),
      ...(body.parsedData ? { parsedData: body.parsedData } : {}),
      ...(body.keyInfo ? { keyInfo: body.keyInfo } : {}),
    });

    if (!archive) {
      return NextResponse.json({ error: "商品档案不存在" }, { status: 404 });
    }

    return NextResponse.json({ archive });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "商品档案更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  const { archiveId } = await context.params;
  const existing = getProductArchive(archiveId);
  if (existing?.ownerUserId && existing.ownerUserId !== session.userId) {
    return NextResponse.json({ error: "无权删除该商品档案", code: "PRODUCT_ARCHIVE_FORBIDDEN" }, { status: 403 });
  }
  const deleted = deleteProductArchive(archiveId);
  if (!deleted) {
    return NextResponse.json({ error: "商品档案不存在" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, archiveId });
}
