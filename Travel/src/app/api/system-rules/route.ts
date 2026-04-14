import { NextResponse } from "next/server";

import { buildSystemRulesPayload } from "../../../lib/system-rules-payload";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = buildSystemRulesPayload();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载系统规则失败" },
      { status: 500 },
    );
  }
}
