"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "travel:navigation-perf:v1";
const MAX_RECORDS = 50;

const pageNameEntries = [
  ["/overview", "概览页"],
  ["/studio/task-creation/real-photo-video", "实拍素材成片"],
  ["/studio/task-creation/ai-image-video", "AI 素材成片"],
  ["/studio/video-generation", "快速生成"],
  ["/models/character", "人物模型"],
  ["/assets/product-info", "商品信息"],
  ["/assets/voice-management", "音色管理"],
  ["/assets/video-materials", "视频拆解"],
  ["/settings/parameter-settings", "参数设置"],
  ["/settings/membership", "会员中心"],
  ["/settings/usage", "用量账单"],
  ["/settings/account", "账号管理"],
  ["/admin", "管理后台"],
] as const;

type NavigationPerfLevel = "fast" | "slow" | "very-slow" | "critical";

export type NavigationPerfRecord = {
  fromPath: string;
  toPath: string;
  navigationStartTime: number;
  navigationEndTime: number;
  durationMs: number;
  pageName: string;
  timestamp: string;
  level: NavigationPerfLevel;
  exceeded: {
    ms800: boolean;
    ms1500: boolean;
    ms3000: boolean;
  };
};

type NavigationPerfDebugApi = {
  records: NavigationPerfRecord[];
  latest: (count?: number) => NavigationPerfRecord[];
  clear: () => void;
};

declare global {
  interface Window {
    __NAV_PERF__?: NavigationPerfDebugApi;
  }
}

function resolvePageName(pathname: string) {
  const match = pageNameEntries
    .filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort(([left], [right]) => right.length - left.length)[0];

  return match?.[1] ?? pathname;
}

function resolveLevel(durationMs: number): NavigationPerfLevel {
  if (durationMs >= 3000) return "critical";
  if (durationMs >= 1500) return "very-slow";
  if (durationMs >= 800) return "slow";
  return "fast";
}

function readStoredRecords() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [] as NavigationPerfRecord[];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NavigationPerfRecord[]).slice(-MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

function writeStoredRecords(records: NavigationPerfRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
}

function getCurrentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getSameOriginPath(href: string | URL) {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function NavigationPerfMonitor() {
  const pathname = usePathname() ?? "/";
  const recordsRef = useRef<NavigationPerfRecord[]>([]);
  const pendingRef = useRef<{ fromPath: string; toPath: string; startTime: number } | null>(null);
  const lastCommittedPathRef = useRef<string | null>(null);

  useEffect(() => {
    function beginPendingNavigation(targetPath: string, fromPath = getCurrentPath()) {
      if (targetPath === fromPath) {
        return;
      }

      const currentPending = pendingRef.current;
      if (currentPending?.fromPath === fromPath && currentPending.toPath === targetPath) {
        return;
      }

      pendingRef.current = {
        fromPath,
        toPath: targetPath,
        startTime: performance.now(),
      };
    }

    function exposeDebugApi() {
      window.__NAV_PERF__ = {
        records: recordsRef.current,
        latest: (count = 20) => recordsRef.current.slice(-count),
        clear: () => {
          recordsRef.current = [];
          window.localStorage.removeItem(STORAGE_KEY);
          exposeDebugApi();
        },
      };
    }

    recordsRef.current = readStoredRecords();
    lastCommittedPathRef.current = getCurrentPath();
    exposeDebugApi();

    function handleDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      const targetPath = getSameOriginPath(anchor.href);
      if (!targetPath) {
        return;
      }

      beginPendingNavigation(targetPath);
    }

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    function beginHistoryNavigation(url: string | URL | null | undefined) {
      if (!url) {
        return;
      }

      const targetPath = getSameOriginPath(url);
      if (targetPath) {
        beginPendingNavigation(targetPath);
      }
    }

    window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
      beginHistoryNavigation(url);
      return originalPushState(data, unused, url);
    }) as History["pushState"];

    window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      beginHistoryNavigation(url);
      return originalReplaceState(data, unused, url);
    }) as History["replaceState"];

    function handlePopState() {
      const targetPath = getCurrentPath();
      const fromPath = lastCommittedPathRef.current ?? targetPath;
      beginPendingNavigation(targetPath, fromPath);
    }

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handlePopState);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }

    const currentPath = `${pathname}${window.location.search}${window.location.hash}`;
    const pendingPathname = pending.toPath.split(/[?#]/, 1)[0] || pending.toPath;
    if (pendingPathname !== pathname) {
      return;
    }

    const navigationEndTime = performance.now();
    const durationMs = Math.max(0, Math.round(navigationEndTime - pending.startTime));
    const record: NavigationPerfRecord = {
      fromPath: pending.fromPath,
      toPath: currentPath,
      navigationStartTime: pending.startTime,
      navigationEndTime,
      durationMs,
      pageName: resolvePageName(pathname),
      timestamp: new Date().toISOString(),
      level: resolveLevel(durationMs),
      exceeded: {
        ms800: durationMs >= 800,
        ms1500: durationMs >= 1500,
        ms3000: durationMs >= 3000,
      },
    };

    recordsRef.current = [...recordsRef.current, record].slice(-MAX_RECORDS);
    writeStoredRecords(recordsRef.current);
    if (window.__NAV_PERF__) {
      window.__NAV_PERF__.records = recordsRef.current;
    }

    console.info(
      [
        "[Navigation Perf]",
        `from: ${record.fromPath}`,
        `to: ${record.toPath}`,
        `page: ${record.pageName}`,
        `duration: ${record.durationMs}ms`,
        `level: ${record.level}`,
      ].join("\n"),
    );

    pendingRef.current = null;
    lastCommittedPathRef.current = currentPath;
  }, [pathname]);

  return null;
}
