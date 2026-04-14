import { NextRequest, NextResponse } from "next/server";

import { getUnifiedTimbreCatalog } from "../../../../lib/doubao-timbre-service";

const PAGE_SIZE = 9;

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("q") ?? "";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const matched = (await getUnifiedTimbreCatalog()).filter((item) => {
    if (!normalizedKeyword) {
      return true;
    }

    const searchText = [
      item.speakerId,
      item.speakerName,
      item.description,
      ...item.tags,
      ...item.categories.flatMap((category) => [category.category, category.nextCategory ?? ""]),
      ...item.emotions.map((emotion) => emotion.emotion),
    ]
      .join(" ")
      .toLowerCase();

    return searchText.includes(normalizedKeyword);
  });
  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));

  return NextResponse.json({
    items: matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      totalCount: matched.length,
      totalPages,
    },
  });
}
