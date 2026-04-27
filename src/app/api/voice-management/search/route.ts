import { NextRequest, NextResponse } from "next/server";

import { getUnifiedTimbreCatalog, searchTimbres } from "../../../../lib/doubao-timbre-service";

const PAGE_SIZE = 9;

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("q") ?? "";
  const requestedPage = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const normalizedKeyword = keyword.trim();
  const matched = normalizedKeyword ? await searchTimbres(normalizedKeyword) : await getUnifiedTimbreCatalog();
  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  return NextResponse.json({
    keyword: normalizedKeyword,
    items: matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      totalCount: matched.length,
      totalPages,
    },
  });
}
