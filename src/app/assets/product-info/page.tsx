import "./product-info.css";

import { requireUserPageSession } from "../../../lib/auth-session";
import { listAccessibleProductArchives } from "../../../lib/product-archive-store";
import { getProductArchiveVisionProviderMeta } from "../../../lib/product-archive-vision";
import ProductInfoPageClient, { type ProductArchivesPayload } from "./product-info-page-client";

function buildEmptyPayload(): ProductArchivesPayload {
  return {
    archives: [],
    runtime: getProductArchiveVisionProviderMeta(),
  };
}

export default async function ProductInfoPage() {
  const session = await requireUserPageSession();
  let initialData = buildEmptyPayload();
  let initialError: string | null = null;

  try {
    initialData = {
      archives: listAccessibleProductArchives(session.userId),
      runtime: getProductArchiveVisionProviderMeta(),
    };
  } catch (error) {
    initialError = error instanceof Error ? error.message : "商品信息页面加载失败";
  }

  return <ProductInfoPageClient initialData={initialData} initialError={initialError} />;
}
