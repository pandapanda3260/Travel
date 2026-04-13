import { NextRequest, NextResponse } from "next/server";

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

export async function GET(_: NextRequest, context: RouteContext) {
  const { archiveId } = await context.params;
  const archive = getProductArchive(archiveId);
  if (!archive) {
    return NextResponse.json({ error: "商品档案不存在" }, { status: 404 });
  }

  return NextResponse.json({ archive });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { archiveId } = await context.params;
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

export async function DELETE(_: NextRequest, context: RouteContext) {
  const { archiveId } = await context.params;
  const deleted = deleteProductArchive(archiveId);
  if (!deleted) {
    return NextResponse.json({ error: "商品档案不存在" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, archiveId });
}
