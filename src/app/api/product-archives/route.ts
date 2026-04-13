import { NextResponse } from "next/server";

import { createProductArchive, listProductArchives } from "../../../lib/product-archive-store";
import { getProductArchiveVisionProviderMeta } from "../../../lib/product-archive-vision";

export async function GET() {
  return NextResponse.json({
    archives: listProductArchives(),
    runtime: getProductArchiveVisionProviderMeta(),
  });
}

export async function POST() {
  return NextResponse.json({
    archive: createProductArchive(),
  });
}
