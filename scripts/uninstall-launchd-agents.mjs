import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const uid = process.getuid?.();

if (typeof uid !== "number") {
  throw new Error("launchd uninstall only supports macOS user sessions");
}

const homeDir = homedir();
const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
const label = process.env.LAUNCHD_WEB_LABEL ?? "com.travel.dev-web";
const watchdogLabel = process.env.LAUNCHD_WATCHDOG_LABEL ?? "com.travel.dev-web-healthcheck";
const domain = `gui/${uid}`;
const webAgentPath = path.join(launchAgentsDir, `${label}.plist`);
const watchdogAgentPath = path.join(launchAgentsDir, `${watchdogLabel}.plist`);

function runLaunchctl(args) {
  try {
    execFileSync("launchctl", args, { stdio: "pipe" });
  } catch {
    return;
  }
}

runLaunchctl(["bootout", domain, webAgentPath]);
runLaunchctl(["bootout", domain, watchdogAgentPath]);

if (existsSync(webAgentPath)) {
  rmSync(webAgentPath, { force: true });
}

if (existsSync(watchdogAgentPath)) {
  rmSync(watchdogAgentPath, { force: true });
}

console.log(`[launchd] Removed ${label}`);
console.log(`[launchd] Removed ${watchdogLabel}`);
