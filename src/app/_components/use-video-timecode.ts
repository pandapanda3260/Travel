"use client";

import { useCallback, useMemo, useState, type SyntheticEvent } from "react";

function normalizePlaybackSeconds(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function formatVideoTimecode(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(normalizePlaybackSeconds(seconds)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainderSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainderSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainderSeconds).padStart(2, "0")}`;
}

export function useVideoTimecode(sourceKey?: string | null) {
  const normalizedSourceKey = sourceKey ?? null;
  const [timecodeState, setTimecodeState] = useState({
    sourceKey: normalizedSourceKey,
    currentTimeSeconds: 0,
    durationSeconds: 0,
  });

  const syncTimecode = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      setTimecodeState({
        sourceKey: normalizedSourceKey,
        currentTimeSeconds: normalizePlaybackSeconds(video.currentTime),
        durationSeconds: normalizePlaybackSeconds(video.duration),
      });
    },
    [normalizedSourceKey],
  );

  const syncEnded = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      const normalizedDuration = normalizePlaybackSeconds(video.duration);
      setTimecodeState({
        sourceKey: normalizedSourceKey,
        currentTimeSeconds: normalizedDuration || normalizePlaybackSeconds(video.currentTime),
        durationSeconds: normalizedDuration,
      });
    },
    [normalizedSourceKey],
  );

  const resetTimecode = useCallback(() => {
    setTimecodeState({
      sourceKey: normalizedSourceKey,
      currentTimeSeconds: 0,
      durationSeconds: 0,
    });
  }, [normalizedSourceKey]);

  const currentTimeSeconds = timecodeState.sourceKey === normalizedSourceKey ? timecodeState.currentTimeSeconds : 0;
  const durationSeconds = timecodeState.sourceKey === normalizedSourceKey ? timecodeState.durationSeconds : 0;

  const timecodeLabel = useMemo(
    () => `${formatVideoTimecode(currentTimeSeconds)}/${formatVideoTimecode(durationSeconds)}`,
    [currentTimeSeconds, durationSeconds],
  );

  return {
    timecodeLabel,
    currentTimeSeconds,
    durationSeconds,
    videoTimecodeProps: {
      onLoadedMetadata: syncTimecode,
      onDurationChange: syncTimecode,
      onTimeUpdate: syncTimecode,
      onSeeked: syncTimecode,
      onEnded: syncEnded,
      onEmptied: resetTimecode,
    },
  };
}
