"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DashboardRefreshButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleRefresh() {
    if (pending) {
      return;
    }

    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/admin/dashboard/auth", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("refresh_failed");
      }
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" className="toolbar-button" onClick={handleRefresh} disabled={pending}>
      {pending ? "刷新中..." : failed ? "刷新失败" : "刷新聚合"}
    </button>
  );
}
