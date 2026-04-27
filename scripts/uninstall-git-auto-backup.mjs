import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const uid = process.getuid?.();

if (typeof uid !== "number") {
  throw new Error("git auto-backup launchd uninstall only supports macOS user sessions");
}

const homeDir = homedir();
const label = process.env.GIT_AUTO_BACKUP_LABEL ?? "com.travel.git-auto-backup";
const domain = `gui/${uid}`;
const agentPath = path.join(homeDir, "Library", "LaunchAgents", `${label}.plist`);

try {
  execFileSync("launchctl", ["bootout", domain, agentPath], { stdio: "pipe" });
} catch {
  // Already stopped or not installed.
}

if (existsSync(agentPath)) {
  rmSync(agentPath, { force: true });
}

console.log(`[git-auto-backup] Removed ${label}`);
