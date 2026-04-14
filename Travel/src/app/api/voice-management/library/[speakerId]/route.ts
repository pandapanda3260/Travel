import { NextResponse } from "next/server";

import { removeSpeakerFromSearchDisplay } from "../../../../../lib/voice-management-store";

type RouteParams = {
  params: Promise<{
    speakerId: string;
  }>;
};

export async function DELETE(_: Request, context: RouteParams) {
  const { speakerId } = await context.params;
  removeSpeakerFromSearchDisplay(decodeURIComponent(speakerId));
  return NextResponse.json({ ok: true });
}
