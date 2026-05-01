import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../../../lib/auth-session";
import { CommercialOrderError, fulfillCommercialOrder } from "../../../../../../../lib/commercial-order-service";

export const dynamic = "force-dynamic";

const fulfillOrderSchema = z.object({
  idempotencyKey: z.string().min(1).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  const { orderId } = await context.params;
  const payload = fulfillOrderSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({ error: "履约参数不完整。", code: "INVALID_FULFILL_PAYLOAD" }, { status: 400 });
  }

  let result;
  try {
    result = fulfillCommercialOrder({
      orderId,
      idempotencyKey: payload.data.idempotencyKey ?? `order:fulfill:${orderId}:${randomUUID()}`,
      operatorId: session.adminId,
    });
  } catch (error) {
    if (error instanceof CommercialOrderError) {
      const status = error.code === "ORDER_NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }

  return NextResponse.json(result);
}
