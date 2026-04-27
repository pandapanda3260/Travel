import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AuthServiceError, type RequestAuditContext } from "./auth-service";
import { sanitizeIp } from "./auth-security";

export function getAuditContextFromRequest(request: NextRequest): RequestAuditContext {
  return {
    ip: sanitizeIp(
      request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip") ||
        request.headers.get("cf-connecting-ip") ||
        "unknown",
    ),
    userAgent: request.headers.get("user-agent"),
  };
}

export function toAuthErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof AuthServiceError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.data ? { data: error.data } : {}),
      },
      { status: error.status },
    );
  }

  return NextResponse.json({ error: fallbackMessage, code: "INTERNAL_SERVER_ERROR" }, { status: 500 });
}
