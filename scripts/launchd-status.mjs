import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const uid = process.getuid?.();

if (typeof uid !== "number") {
  throw new Error("launchd status only supports macOS user sessions");
}

const homeDir = homedir();
const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
const label = process.env.LAUNCHD_WEB_LABEL ?? "com.travel.dev-web";
const watchdogLabel = process.env.LAUNCHD_WATCHDOG_LABEL ?? "com.travel.dev-web-healthcheck";
const domain = `gui/${uid}`;

for (const currentLabel of [label, watchdogLabel]) {
  const plistPath = path.join(launchAgentsDir, `${currentLabel}.plist`);
  console.log(`\n[launchd] ${currentLabel}`);
  console.log(`plist: ${plistPath}`);

  try {
    const output = execFileSync("launchctl", ["print", `${domain}/${currentLabel}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(output);
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr || "") : "not loaded";
    console.log(stderr || "not loaded");
  }
}
