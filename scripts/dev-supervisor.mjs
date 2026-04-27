import { spawn } from "node:child_process";

const npmCommand = process.env.NPM_BIN?.trim() || (process.platform === "win32" ? "npm.cmd" : "npm");
const host = process.env.DEV_HOST ?? "127.0.0.1";
const port = process.env.DEV_PORT ?? "3000";
const baseScript = process.env.DEV_BASE_SCRIPT ?? "dev";
const restartDelayMs = Number(process.env.DEV_RESTART_DELAY_MS ?? 1200);
const rapidFailureWindowMs = Number(process.env.DEV_RAPID_FAILURE_WINDOW_MS ?? 5000);
const maxRapidFailures = Number(process.env.DEV_MAX_RAPID_FAILURES ?? 3);

let child = null;
let stopping = false;
let restartCount = 0;
let rapidFailureCount = 0;

function spawnDevServer() {
  const childArgs = ["run", baseScript, "--", "--hostname", host, "--port", port];
  const startedAt = Date.now();

  console.log(
    `[dev-supervisor] Starting ${baseScript} on http://${host}:${port} (restart #${restartCount})`,
  );

  child = spawn(npmCommand, childArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    child = null;

    if (stopping) {
      process.exit(code ?? 0);
    }

    const exitedBySignal = signal === "SIGINT" || signal === "SIGTERM";
    if (exitedBySignal) {
      process.exit(code ?? 0);
    }

    const uptimeMs = Date.now() - startedAt;
    rapidFailureCount = uptimeMs < rapidFailureWindowMs ? rapidFailureCount + 1 : 0;

    if (rapidFailureCount >= maxRapidFailures) {
      console.error(
        `[dev-supervisor] Stopped after ${rapidFailureCount} rapid failures. A dev server may already be running, or startup is failing immediately.`,
      );
      process.exit(code ?? 1);
    }

    restartCount += 1;
    console.log(
      `[dev-supervisor] Child exited with ${signal ? `signal ${signal}` : `code ${code ?? 0}`}. Restarting in ${restartDelayMs}ms...`,
    );
    setTimeout(spawnDevServer, restartDelayMs);
  });
}

function shutdown(signal) {
  stopping = true;

  if (!child) {
    process.exit(0);
  }

  child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

spawnDevServer();
