import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { applyRequestAuthGuards } from "./src/lib/request-auth-guards";

export async function middleware(request: NextRequest) {
  const guardedResponse = await applyRequestAuthGuards(request);

  if (guardedResponse) {
    return guardedResponse;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
