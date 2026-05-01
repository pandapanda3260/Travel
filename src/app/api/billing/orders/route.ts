import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import {
  CommercialOrderError,
  createCommercialOrder,
  listCommercialOrdersByUserId,
} from "../../../../lib/commercial-order-service";

export const dynamic = "force-dynamic";

const createOrderSchema = z.object({
  productCode: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  return NextResponse.json({
    orders: listCommercialOrdersByUserId(session.userId),
  });
}

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  const payload = createOrderSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "订单参数不完整。", code: "INVALID_ORDER_PAYLOAD" }, { status: 400 });
  }

  let result;
  try {
    result = createCommercialOrder({
      userId: session.userId,
      productCode: payload.data.productCode,
      idempotencyKey: payload.data.idempotencyKey ?? `order:create:${session.userId}:${randomUUID()}`,
    });
  } catch (error) {
    if (error instanceof CommercialOrderError && error.code === "PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }

  return NextResponse.json(result);
}
