import { NextRequest, NextResponse } from "next/server";

import { getUnifiedTimbreCatalog } from "../../../../lib/doubao-timbre-service";
import {
  addFavoriteSpeaker,
  listFavoriteSpeakerIds,
  removeFavoriteSpeaker,
  listClonedVoices,
} from "../../../../lib/voice-management-store";

export async function GET() {
  try {
    const favoriteIds = listFavoriteSpeakerIds();
    const catalog = await getUnifiedTimbreCatalog();
    const catalogMap = new Map(catalog.map((item) => [item.speakerId, item]));

    const clonedVoices = listClonedVoices();
    const cloneMap = new Map(
      clonedVoices
        .filter((v) => v.status === "SUCCESS" || v.status === "ACTIVE")
        .map((v) => [v.speakerId, v]),
    );

    const favorites = favoriteIds
      .map((id) => {
        const timbre = catalogMap.get(id);
        if (timbre) return { type: "timbre" as const, data: timbre };
        const clone = cloneMap.get(id);
        if (clone) return { type: "clone" as const, data: clone };
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
  try {
    const body = (await request.json()) as { speakerId?: string; action?: "add" | "remove" };
    const speakerId = body.speakerId?.trim();
    const action = body.action ?? "add";

    if (!speakerId) {
      return NextResponse.json({ error: "缺少音色 ID" }, { status: 400 });
    }

    if (action === "remove") {
      const ids = removeFavoriteSpeaker(speakerId);
      return NextResponse.json({ ok: true, favoriteIds: ids });
    }

    const ids = addFavoriteSpeaker(speakerId);
    return NextResponse.json({ ok: true, favoriteIds: ids });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作收藏失败" },
      { status: 500 },
    );
  }
}
