import "./product-info.css";

import { getProductArchiveVisionProviderMeta } from "../../../lib/product-archive-vision";
import type { ProductArchivesPayload } from "./product-info-page-client";
import { ProductInfoPageLoader } from "./product-info-page-loader";

function buildEmptyPayload(): ProductArchivesPayload {
  return {
    archives: [],
    runtime: getProductArchiveVisionProviderMeta(),
  };
}

export default function ProductInfoPage() {
  return <ProductInfoPageLoader initialData={buildEmptyPayload()} />;
}
