"use client";

import { useEffect, useState } from "react";

import type { OverviewServiceReportEntry } from "../../../lib/overview-service-report";
import { OverviewServiceReportPanel } from "./overview-service-report-panel";

type OverviewServiceReportResponse = {
  reports?: OverviewServiceReportEntry[];
  error?: string;
};

export function OverviewServiceReportClientPanel() {
  const [reports, setReports] = useState<OverviewServiceReportEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadReports() {
      try {
        const response = await fetch("/api/overview/service-report", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as OverviewServiceReportResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "概览服务统计加载失败");
        }
        if (!isActive) {
          return;
        }
        setReports(data.reports ?? []);
        setError(null);
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "概览服务统计加载失败");
      }
    }

    void loadReports();

    return () => {
      isActive = false;
    };
  }, []);

  return <OverviewServiceReportPanel reports={reports} error={error} />;
}
