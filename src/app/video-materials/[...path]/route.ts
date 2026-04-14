import { NextRequest } from "next/server";

import { serveRuntimeAssetRequest } from "../../../lib/runtime-asset-response";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return serveRuntimeAssetRequest(request, "video-materials", path);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return serveRuntimeAssetRequest(request, "video-materials", path);
}
