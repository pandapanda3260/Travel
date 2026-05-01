"use client";

import { useEffect, useState } from "react";

export function useDeferredRouteReady(resetKey: string) {
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.setTimeout(() => setReadyKey(resetKey), 0);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [resetKey]);

  return readyKey === resetKey;
}
