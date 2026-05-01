"use client";

import dynamic from "next/dynamic";

import { useDeferredRouteReady } from "../../_components/use-deferred-route-ready";

function ParameterSettingsFallback() {
  return (
    <main className="shell">
      <section className="content">
        <section className="panel product-archive-panel">
          <div className="product-archive-empty">参数设置页面加载中...</div>
        </section>
      </section>
    </main>
  );
}

const ParameterSettingsPageClient = dynamic(() => import("./parameter-settings-page-client"), {
  ssr: false,
  loading: () => <ParameterSettingsFallback />,
});

export function ParameterSettingsPageLoader() {
  const ready = useDeferredRouteReady("parameter-settings");
  if (!ready) {
    return <ParameterSettingsFallback />;
  }

  return <ParameterSettingsPageClient />;
}
