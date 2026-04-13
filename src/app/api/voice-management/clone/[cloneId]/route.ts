import { NextResponse } from "next/server";

import { deleteClonedVoice } from "../../../../../lib/voice-management-store";

type RouteParams = {
  params: Promise<{
    cloneId: string;
  }>;
};

export async function DELETE(_: Request, context: RouteParams) {
  const { cloneId } = await context.params;
  const deleted = deleteClonedVoice(cloneId);

  if (!deleted) {
    return NextResponse.json({ error: "复刻音色不存在" }, { status: 404 });
  }

  return NextResponse.json({ deleted });
}
