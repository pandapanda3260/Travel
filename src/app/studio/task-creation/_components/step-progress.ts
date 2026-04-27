import { useEffect, useRef, useState } from "react";

type UseStepProgressOptions = {
  running: boolean;
  externalProgress?: number | null;
  floor?: number;
  ceiling?: number;
  tickMs?: number;
  step?: number;
  completeHoldMs?: number;
};

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function useStepProgress(options: UseStepProgressOptions) {
  const [progress, setProgress] = useState(0);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    const floor = options.floor ?? 5;
    const ceiling = options.ceiling ?? 92;
    const tickMs = options.tickMs ?? 620;
    const step = options.step ?? 3;
    const completeHoldMs = options.completeHoldMs ?? 800;
    const externalProgress = clampProgress(options.externalProgress ?? 0);

    if (options.running) {
      wasRunningRef.current = true;
      const initFrame = window.requestAnimationFrame(() => {
        setProgress((current) => clampProgress(Math.max(current, floor, externalProgress)));
      });

      const timer = window.setInterval(() => {
        setProgress((current) => clampProgress(Math.min(Math.max(current, externalProgress) + step, ceiling)));
      }, tickMs);

      return () => {
        window.cancelAnimationFrame(initFrame);
        window.clearInterval(timer);
      };
    }

    if (wasRunningRef.current) {
      wasRunningRef.current = false;
      const completeFrame = window.requestAnimationFrame(() => {
        setProgress(100);
      });
      const timer = window.setTimeout(() => {
        setProgress(0);
      }, completeHoldMs);
      return () => {
        window.cancelAnimationFrame(completeFrame);
        window.clearTimeout(timer);
      };
    }

    const resetFrame = window.requestAnimationFrame(() => {
      setProgress(0);
    });
    return () => {
      window.cancelAnimationFrame(resetFrame);
    };
  }, [
    options.ceiling,
    options.completeHoldMs,
    options.externalProgress,
    options.floor,
    options.running,
    options.step,
    options.tickMs,
  ]);

  return clampProgress(Math.max(progress, options.running ? (options.externalProgress ?? 0) : 0));
}
