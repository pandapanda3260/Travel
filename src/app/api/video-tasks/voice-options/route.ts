import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { listTaskCreationVoiceOptions } from "../../../../lib/task-creation-voice-options";
import { repairClonedVoiceDisplayNames } from "../../../../lib/voice-management-store";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    repairClonedVoiceDisplayNames(session.userId);
    const voiceOptions = await listTaskCreationVoiceOptions(session.userId);
    return NextResponse.json({ voiceOptions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载任务音色选项失败" },
      { status: 500 },
    );
  }
}
