import { NextRequest, NextResponse } from "next/server";

import { getUnifiedTimbreCatalog, searchTimbres } from "../../../../lib/doubao-timbre-service";

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("q") ?? "";
  const normalizedKeyword = keyword.trim();
  const matched = normalizedKeyword ? await searchTimbres(normalizedKeyword) : await getUnifiedTimbreCatalog();

  return NextResponse.json({
    keyword: normalizedKeyword,
    items: matched,
    pagination: {
      page: 1,
      pageSize: matched.length,
      totalCount: matched.length,
      totalPages: 1,
    },
  });
}
