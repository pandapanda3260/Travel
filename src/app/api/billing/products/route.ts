import { NextResponse } from "next/server";

import { getCommercialProductsPayload } from "../../../../lib/commercial-billing-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    products: getCommercialProductsPayload(),
  });
}
