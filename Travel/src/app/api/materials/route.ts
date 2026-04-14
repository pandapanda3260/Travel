import { NextRequest, NextResponse } from "next/server";

import { listMaterialLibraryItems } from "../../../lib/material-library-store";

export async function GET(request: NextRequest) {
  const items = listMaterialLibraryItems();
  const type = request.nextUrl.searchParams.get("type");
  const source = request.nextUrl.searchParams.get("source");
  const filteredItems = items.filter((item) => {
    const typeMatched = !type || type === "all" ? true : item.type === type;
    const sourceMatched = !source || source === "all" ? true : item.source === source;
    return typeMatched && sourceMatched;
  });
  const summary = {
    total: items.length,
    byType: {
      image: items.filter((item) => item.type === "image").length,
      video: items.filter((item) => item.type === "video").length,
    },
    bySource: {
      imageGenerationArchive: items.filter((item) => item.source === "image-generation-archive").length,
      videoGenerationJob: items.filter((item) => item.source === "video-generation-job").length,
      videoCompositionOutput: items.filter((item) => item.source === "video-composition-output").length,
    },
  };

  return NextResponse.json({
    summary,
    filters: {
      type: type ?? "all",
      source: source ?? "all",
    },
    items: filteredItems,
  });
}
