import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { applyRequestAuthGuards } from "./src/lib/request-auth-guards";

const CURRENT_PATHNAME_HEADER = "x-travel-pathname";

export async function middleware(request: NextRequest) {
  const guardedResponse = await applyRequestAuthGuards(request);

  if (guardedResponse) {
    return guardedResponse;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CURRENT_PATHNAME_HEADER, request.nextUrl.pathname);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
