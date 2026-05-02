import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const uid = process.getuid?.();

if (typeof uid !== "number") {
  throw new Error("git auto-backup launchd install only supports macOS user sessions");
}

const projectRoot = process.cwd();
const homeDir = homedir();
const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
const logDir = path.join(homeDir, "Library", "Logs", "Travel");
const nodeBin = process.execPath;
const gitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const label = process.env.GIT_AUTO_BACKUP_LABEL ?? "com.travel.git-auto-backup";
const intervalSeconds = process.env.GIT_AUTO_BACKUP_INTERVAL_SECONDS ?? "1800";
const domain = `gui/${uid}`;
const agentPath = path.join(launchAgentsDir, `${label}.plist`);
const pathEnv = [
  path.dirname(nodeBin),
  path.dirname(gitBin),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shellArray(items) {
  return items.map((item) => `    <string>${escapeXml(item)}</string>`).join("\n");
}

function envDict(entries) {
  return Object.entries(entries)
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(String(value))}</string>`)
    .join("\n");
}

function runLaunchctl(args) {
  try {
    execFileSync("launchctl", args, { stdio: "pipe" });
  } catch {
    return;
  }
}

mkdirSync(launchAgentsDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
${shellArray(["/usr/bin/env", "node", path.join(projectRoot, "scripts/git-auto-backup.mjs")])}
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(projectRoot)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>${escapeXml(intervalSeconds)}</integer>
    <key>EnvironmentVariables</key>
    <dict>
${envDict({
  PATH: pathEnv,
  AUTO_BACKUP_REMOTE: "origin",
  AUTO_BACKUP_BASE_BRANCH: "main",
  AUTO_BACKUP_BRANCH: "",
  AUTO_BACKUP_PUSH_MAIN: "1",
  AUTO_BACKUP_MAX_FILE_MB: "95",
})}
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(path.join(logDir, "git-auto-backup.out.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(path.join(logDir, "git-auto-backup.err.log"))}</string>
  </dict>
</plist>
`;

writeFileSync(agentPath, plist, "utf8");

runLaunchctl(["bootout", domain, agentPath]);
execFileSync("launchctl", ["bootstrap", domain, agentPath], { stdio: "inherit" });
execFileSync("launchctl", ["enable", `${domain}/${label}`], { stdio: "inherit" });
execFileSync("launchctl", ["kickstart", "-k", `${domain}/${label}`], { stdio: "inherit" });

console.log(`[git-auto-backup] Installed ${label}`);
console.log(`[git-auto-backup] Interval: ${intervalSeconds}s`);
console.log(`[git-auto-backup] Plist: ${agentPath}`);
console.log(`[git-auto-backup] Logs:`);
console.log(`- ${path.join(logDir, "git-auto-backup.out.log")}`);
console.log(`- ${path.join(logDir, "git-auto-backup.err.log")}`);
if (!existsSync(path.join(projectRoot, ".git"))) {
  console.log(`[git-auto-backup] Warning: ${projectRoot} does not look like a git repo`);
}
