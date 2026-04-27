import { NextResponse } from "next/server";

import { listConstraintPromptRuntimeDocs, listConstraintPrompts } from "../../../lib/constraint-prompt-store";
import { buildSystemRulesPayload } from "../../../lib/system-rules-payload";
import { listAllVideoTypePromptConfigs } from "../../../lib/video-type-prompts";

export const dynamic = "force-dynamic";

export async function GET() {
  const systemRules = buildSystemRulesPayload();

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    stages: listConstraintPrompts(),
    runtimeDocs: listConstraintPromptRuntimeDocs(),
    systemRulesTabs: systemRules.tabs,
    videoTypeConfigs: listAllVideoTypePromptConfigs(),
  });
}
