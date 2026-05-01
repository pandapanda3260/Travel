"use client";

import dynamic from "next/dynamic";

import { RouteLoadingShell } from "../../_components/route-loading-shell";
import { useDeferredRouteReady } from "../../_components/use-deferred-route-ready";
import type { ProductArchivesPayload } from "./product-info-page-client";

function ProductInfoFallback() {
  return (
    <RouteLoadingShell pageName="Product Info" title="商品档案创建" description="正在加载商品档案，稍后可创建新的商品档案。" />
  );
}

const ProductInfoPageClient = dynamic(() => import("./product-info-page-client"), {
  ssr: false,
  loading: () => <ProductInfoFallback />,
});

export function ProductInfoPageLoader({ initialData }: { initialData: ProductArchivesPayload }) {
  const ready = useDeferredRouteReady("product-info");
  if (!ready) {
    return <ProductInfoFallback />;
  }

  return <ProductInfoPageClient initialData={initialData} deferInitialLoad />;
}
