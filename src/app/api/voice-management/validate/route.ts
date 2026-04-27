import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { getUnifiedTimbreCatalog, resolveTimbreResourceId } from "../../../../lib/doubao-timbre-service";
import { listClonedVoices } from "../../../../lib/voice-management-store";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as { speakerId?: string };
    const speakerId = body.speakerId?.trim();

    if (!speakerId) {
      return NextResponse.json({ valid: false, error: "缺少音色 ID" }, { status: 400 });
    }

    const resourceId = resolveTimbreResourceId(speakerId);
    if (!resourceId) {
      return NextResponse.json({ valid: false, error: "无法识别的音色类型" }, { status: 400 });
    }

    const catalog = await getUnifiedTimbreCatalog();
    const inCatalog = catalog.some((item) => item.speakerId === speakerId);
    if (inCatalog) {
      return NextResponse.json({ valid: true, speakerId, resourceId });
    }

    const cloned = listClonedVoices(session.userId).find(
      (v) => v.speakerId === speakerId && (v.status === "SUCCESS" || v.status === "ACTIVE"),
    );
    if (cloned) {
      return NextResponse.json({ valid: true, speakerId, resourceId });
    }

    return NextResponse.json({
      valid: false,
      error: "该音色 ID 不在音色库或已复刻列表中，请确认 ID 是否正确",
    });
  } catch (error) {
    return NextResponse.json(
      { valid: false, error: error instanceof Error ? error.message : "音色验证失败" },
      { status: 500 },
    );
  }
}
