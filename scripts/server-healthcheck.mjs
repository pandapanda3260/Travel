import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const port = process.env.PORT ?? "3000";
const host = process.env.HEALTHCHECK_HOST ?? "127.0.0.1";
const healthcheckUrl = process.env.HEALTHCHECK_URL ?? `http://${host}:${port}/api/health`;
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 10000);
const failureThreshold = Math.max(1, Number(process.env.HEALTHCHECK_FAILURE_THRESHOLD ?? 2));
const restartCooldownMs = Math.max(0, Number(process.env.HEALTHCHECK_RESTART_COOLDOWN_MS ?? 90000));
const shouldRestart = process.env.HEALTHCHECK_RESTART === "1";
const serviceName = process.env.HEALTHCHECK_SERVICE_NAME ?? "travel-web.service";
const restartMode = process.env.HEALTHCHECK_RESTART_MODE ?? "systemctl";
const stateFile =
  process.env.HEALTHCHECK_STATE_FILE ??
  path.join(
    tmpdir(),
    `travel-healthcheck-${createHash("sha1").update(`${process.cwd()}|${port}`).digest("hex").slice(0, 12)}.json`,
  );
const launchctlTarget =
  process.env.HEALTHCHECK_LAUNCHCTL_TARGET ??
  (process.platform === "darwin" ? `gui/${process.getuid?.() ?? 0}/com.travel.dev-web` : "");

async function readState() {
  try {
    const raw = await readFile(stateFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      failureCount: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      lastRestartAt: 0,
      lastError: null,
    };
  }
}

async function writeState(state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state), "utf8");
}

async function restartService() {
  if (restartMode === "launchctl") {
    if (!launchctlTarget) {
      throw new Error("missing launchctl target");
    }

    await execFileAsync("launchctl", ["kickstart", "-k", launchctlTarget]);
    console.log(`[healthcheck] Restarted ${launchctlTarget}`);
    return;
  }

  await execFileAsync("systemctl", ["restart", serviceName]);
  console.log(`[healthcheck] Restarted ${serviceName}`);
}

async function run() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const state = await readState();

  try {
    const response = await fetch(healthcheckUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.ok === false) {
      throw new Error(
        payload?.checks?.find?.((item) => item?.ok === false)?.detail ||
          `Health endpoint responded with status ${response.status}`,
      );
    }

    console.log(
      `[healthcheck] OK ${healthcheckUrl} uptime=${payload?.uptimeSeconds ?? "unknown"}s pid=${payload?.pid ?? "unknown"}`,
    );

    state.failureCount = 0;
    state.lastSuccessAt = Date.now();
    state.lastError = null;
    await writeState(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "healthcheck failed";
    console.error(`[healthcheck] FAILED ${healthcheckUrl}: ${message}`);
    const now = Date.now();

    state.failureCount = Number(state.failureCount ?? 0) + 1;
    state.lastFailureAt = now;
    state.lastError = message;
    await writeState(state);

    if (shouldRestart) {
      if (state.failureCount < failureThreshold) {
        console.log(
          `[healthcheck] Restart deferred (${state.failureCount}/${failureThreshold} consecutive failures)`,
        );
        return;
      }

      if (state.lastRestartAt && now - state.lastRestartAt < restartCooldownMs) {
        console.log(
          `[healthcheck] Restart cooldown active (${Math.ceil((restartCooldownMs - (now - state.lastRestartAt)) / 1000)}s remaining)`,
        );
        return;
      }

      try {
        await restartService();
        state.failureCount = 0;
        state.lastRestartAt = now;
        await writeState(state);
        return;
      } catch (restartError) {
        const restartMessage =
          restartError instanceof Error ? restartError.message : "systemctl restart failed";
        console.error(`[healthcheck] Restart failed for ${serviceName}: ${restartMessage}`);
      }
    }

    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

await run();
