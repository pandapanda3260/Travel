import type { ProgressCallback } from "./progress-stream";

export type WeightedProgressUnit = {
  id: string;
  weight: number;
  estimatedMs: number;
  label?: string;
};

type UnitState = WeightedProgressUnit & {
  status: "pending" | "running" | "completed" | "failed";
  startedAtMs: number | null;
  completedAtMs: number | null;
};

type WeightedProgressTrackerOptions = {
  step: string;
  floorPercent?: number;
  capPercent?: number;
  tickMs?: number;
};

function clampPercent(value: number) {
  return Math.min(99, Math.max(0, Math.round(value)));
}

export class WeightedProgressTracker {
  private readonly units = new Map<string, UnitState>();
  private readonly totalWeight: number;
  private readonly step: string;
  private readonly floorPercent: number;
  private readonly capPercent: number;
  private readonly tickMs: number;
  private readonly onProgress: ProgressCallback;
  private readonly createdAtMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPercent = 0;
  private lastMessage = "";

  constructor(onProgress: ProgressCallback, units: WeightedProgressUnit[], options: WeightedProgressTrackerOptions) {
    this.onProgress = onProgress;
    this.step = options.step;
    this.floorPercent = options.floorPercent ?? 1;
    this.capPercent = options.capPercent ?? 99;
    this.tickMs = options.tickMs ?? 450;
    this.createdAtMs = Date.now();
    this.totalWeight = units.reduce((sum, unit) => sum + Math.max(0.001, unit.weight), 0);

    units.forEach((unit) => {
      this.units.set(unit.id, {
        ...unit,
        status: "pending",
        startedAtMs: null,
        completedAtMs: null,
      });
    });
  }

  start(unitId: string, message?: string) {
    const unit = this.units.get(unitId);
    if (!unit || unit.status === "completed") {
      return;
    }

    if (unit.status !== "running") {
      unit.status = "running";
      unit.startedAtMs = Date.now();
    }

    if (message) {
      this.lastMessage = message;
    }

    this.ensureTimer();
    this.emit(message);
  }

  complete(unitId: string, message?: string) {
    const unit = this.units.get(unitId);
    if (!unit || unit.status === "completed") {
      return;
    }

    unit.status = "completed";
    unit.completedAtMs = Date.now();
    if (!unit.startedAtMs) {
      unit.startedAtMs = unit.completedAtMs;
    }

    if (message) {
      this.lastMessage = message;
    }

    this.emit(message, true);
    this.stopTimerIfSettled();
  }

  skip(unitId: string, message?: string) {
    this.complete(unitId, message);
  }

  setMessage(message: string, force = false) {
    this.lastMessage = message;
    this.emit(message, force);
  }

  finish(message = "完成") {
    this.lastMessage = message;
    this.lastPercent = 100;
    this.stopTimer();
    this.onProgress(this.step, 100, message);
  }

  dispose() {
    this.stopTimer();
  }

  private ensureTimer() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.emit(this.lastMessage || "处理中...");
      this.stopTimerIfSettled();
    }, this.tickMs);
  }

  private stopTimer() {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private stopTimerIfSettled() {
    const hasRunning = Array.from(this.units.values()).some((unit) => unit.status === "running");
    if (!hasRunning) {
      this.stopTimer();
    }
  }

  private computePercent(nowMs: number) {
    if (!this.units.size || this.totalWeight <= 0) {
      return this.lastPercent;
    }

    const weightDone = Array.from(this.units.values()).reduce((sum, unit) => {
      if (unit.status === "completed") {
        return sum + unit.weight;
      }

      if (unit.status === "running" && unit.startedAtMs) {
        const elapsed = Math.max(0, nowMs - unit.startedAtMs);
        const estimatedRatio = Math.min(elapsed / Math.max(300, unit.estimatedMs), 0.97);
        return sum + unit.weight * estimatedRatio;
      }

      return sum;
    }, 0);

    const base = this.floorPercent + (weightDone / this.totalWeight) * (this.capPercent - this.floorPercent);
    return clampPercent(base);
  }

  private emit(message?: string, force = false) {
    const nowMs = Date.now();
    const nextPercent = this.computePercent(nowMs);
    const monotonicPercent = force ? Math.max(this.lastPercent, nextPercent) : Math.max(this.lastPercent, nextPercent);
    const nextMessage = message || this.lastMessage || (nowMs - this.createdAtMs < 600 ? "初始化中..." : "处理中...");

    if (!force && monotonicPercent === this.lastPercent && nextMessage === this.lastMessage) {
      return;
    }

    this.lastPercent = monotonicPercent;
    this.lastMessage = nextMessage;
    this.onProgress(this.step, monotonicPercent, nextMessage);
  }
}
