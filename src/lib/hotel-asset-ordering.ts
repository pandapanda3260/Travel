import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";

type HotelAssetOrderable = Pick<
  TaskHotelAssetRecord,
  "createdAt" | "displayName" | "fileName" | "sortOrder" | "sourceType"
>;

function getPictureOrderValue(asset: HotelAssetOrderable) {
  const displayNameMatch = asset.displayName.trim().match(/^图片\s*(\d+)$/u);
  if (displayNameMatch) {
    return Number(displayNameMatch[1]);
  }

  const fileNameMatch = asset.fileName.trim().match(/^(\d+)(?:\.[a-z0-9]+)?$/iu);
  return fileNameMatch ? Number(fileNameMatch[1]) : Number.POSITIVE_INFINITY;
}

function getSourceRank(asset: HotelAssetOrderable) {
  switch (asset.sourceType) {
    case "user_upload":
      return 0;
    case "enhanced":
      return 1;
    default:
      return 2;
  }
}

function getCreatedTime(asset: HotelAssetOrderable) {
  const time = Date.parse(asset.createdAt);
  return Number.isFinite(time) ? time : 0;
}

export function getHotelAssetDisplayOrder<T extends HotelAssetOrderable>(assets: T[]) {
  return [...assets].sort((left, right) => {
    const sourceRankDelta = getSourceRank(left) - getSourceRank(right);
    if (sourceRankDelta !== 0) {
      return sourceRankDelta;
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    const leftPictureOrder = getPictureOrderValue(left);
    const rightPictureOrder = getPictureOrderValue(right);
    if (leftPictureOrder !== rightPictureOrder) {
      return leftPictureOrder - rightPictureOrder;
    }

    return getCreatedTime(left) - getCreatedTime(right);
  });
}
