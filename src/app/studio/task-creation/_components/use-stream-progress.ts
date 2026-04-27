"use client";

import { useCallback, useRef, useState } from "react";

export type StreamProgressState = {
  step: string;
  percent: number;
  message: string;
};

/**
 * Reads an SSE stream from a fetch response and updates progress state.
 * Returns the final "result" event payload, or throws on error.
 */
export function useStreamProgress() {
  const [progress, setProgress] = useState<StreamProgressState>({ step: "", percent: 0, message: "" });
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setProgress({ step: "", percent: 0, message: "" });
  }, []);

  const readStream = useCallback(
    async <T extends Record<string, unknown>>(
      url: string,
      options: RequestInit,
      config?: {
        onEvent?: (event: Record<string, unknown>) => void;
      },
    ): Promise<T> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setProgress({ step: "connecting", percent: 1, message: "连接中..." });

      const response = await fetch(url, { ...options, signal: controller.signal });

      if (!response.body) {
        const fallback = (await response.json()) as T & { error?: string };
        if (fallback.error) throw new Error(fallback.error as string);
        setProgress({ step: "done", percent: 100, message: "完成" });
        return fallback;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let resultPayload: T | null = null;
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
              config?.onEvent?.(event);

              if (event.step === "result") {
                resultPayload = event as T;
                setProgress({ step: "done", percent: 100, message: "完成" });
              } else if (event.step === "error") {
                throw new Error((event.error as string) ?? "执行失败");
              } else {
                setProgress({
                  step: (event.step as string) ?? "",
                  percent: (event.percent as number) ?? 0,
                  message: (event.message as string) ?? "",
                });
              }
            } catch (parseError) {
              if (parseError instanceof Error && parseError.message !== "执行失败") {
                const msg = parseError.message;
                if (!msg.includes("JSON")) throw parseError;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!resultPayload) {
        throw new Error("流结束但未收到结果");
      }

      return resultPayload;
    },
    [],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { progress, readStream, reset, abort };
}
