import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { getUnifiedTimbreCatalog } from "../../../../lib/doubao-timbre-service";
import {
  addFavoriteSpeaker,
  listClonedVoices,
  listFavoriteSpeakerIds,
  removeFavoriteSpeaker,
} from "../../../../lib/voice-management-store";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const favoriteIds = listFavoriteSpeakerIds(session.userId);
    const catalog = await getUnifiedTimbreCatalog();
    const catalogMap = new Map(catalog.map((item) => [item.speakerId, item]));

    const clonedVoices = listClonedVoices(session.userId);
    const cloneMap = new Map(
      clonedVoices
        .filter((voice) => voice.status === "SUCCESS" || voice.status === "ACTIVE")
        .map((voice) => [voice.speakerId, voice]),
    );

    const favorites = favoriteIds
      .map((speakerId) => {
        const timbre = catalogMap.get(speakerId);
        if (timbre) {
          return { type: "timbre" as const, data: timbre };
        }
        const clone = cloneMap.get(speakerId);
        if (clone) {
          return { type: "clone" as const, data: clone };
        }
        return null;
      })
      .filter(Boolean);

    return NextResponse.json({ favorites, favoriteIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取收藏列表失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as { speakerId?: string; action?: "add" | "remove" };
    const speakerId = body.speakerId?.trim();
    const action = body.action ?? "add";

    if (!speakerId) {
      return NextResponse.json({ error: "缺少音色 ID" }, { status: 400 });
    }

    if (action === "remove") {
      const favoriteIds = removeFavoriteSpeaker(speakerId, session.userId);
      return NextResponse.json({ ok: true, favoriteIds });
    }

    const favoriteIds = addFavoriteSpeaker(speakerId, session.userId);
    return NextResponse.json({ ok: true, favoriteIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作收藏失败" },
      { status: 500 },
    );
  }
}
