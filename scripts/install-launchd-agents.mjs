import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const uid = process.getuid?.();

if (typeof uid !== "number") {
  throw new Error("launchd install only supports macOS user sessions");
}

const projectRoot = process.cwd();
const homeDir = homedir();
const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
const logDir = path.join(homeDir, "Library", "Logs", "Travel");
const nodeBin = process.execPath;
const npmBin = execFileSync("which", ["npm"], { encoding: "utf8" }).trim();
const label = process.env.LAUNCHD_WEB_LABEL ?? "com.travel.dev-web";
const watchdogLabel = process.env.LAUNCHD_WATCHDOG_LABEL ?? "com.travel.dev-web-healthcheck";
const domain = `gui/${uid}`;
const target = `${domain}/${label}`;
const host = process.env.DEV_HOST ?? "127.0.0.1";
const port = process.env.DEV_PORT ?? "3000";
const pathEnv = [
  path.dirname(nodeBin),
  path.dirname(npmBin),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

const webAgentPath = path.join(launchAgentsDir, `${label}.plist`);
const watchdogAgentPath = path.join(launchAgentsDir, `${watchdogLabel}.plist`);

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
    .map(
      ([key, value]) =>
        `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(String(value))}</string>`,
    )
    .join("\n");
}

function writePlist(targetPath, contents) {
  writeFileSync(targetPath, contents, "utf8");
}

function runLaunchctl(args) {
  try {
    execFileSync("launchctl", args, { stdio: "pipe" });
  } catch (error) {
    return error;
  }
  return null;
}

mkdirSync(launchAgentsDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

const webPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
${shellArray([nodeBin, path.join(projectRoot, "scripts/dev-supervisor.mjs")])}
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(projectRoot)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
${envDict({
  PATH: pathEnv,
  NPM_BIN: npmBin,
  DEV_HOST: host,
  DEV_PORT: port,
  DEV_BASE_SCRIPT: "dev",
  DEV_RESTART_DELAY_MS: "1200",
})}
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(path.join(logDir, "dev-web.out.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(path.join(logDir, "dev-web.err.log"))}</string>
  </dict>
</plist>
`;

const watchdogPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(watchdogLabel)}</string>
    <key>ProgramArguments</key>
    <array>
${shellArray([nodeBin, path.join(projectRoot, "scripts/server-healthcheck.mjs")])}
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(projectRoot)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>30</integer>
    <key>EnvironmentVariables</key>
    <dict>
${envDict({
  PATH: pathEnv,
  PORT: port,
  HEALTHCHECK_HOST: host,
  HEALTHCHECK_RESTART: "1",
  HEALTHCHECK_RESTART_MODE: "launchctl",
  HEALTHCHECK_LAUNCHCTL_TARGET: target,
})}
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(path.join(logDir, "dev-watchdog.out.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(path.join(logDir, "dev-watchdog.err.log"))}</string>
  </dict>
</plist>
`;

writePlist(webAgentPath, webPlist);
writePlist(watchdogAgentPath, watchdogPlist);

runLaunchctl(["bootout", domain, webAgentPath]);
runLaunchctl(["bootout", domain, watchdogAgentPath]);

execFileSync("launchctl", ["bootstrap", domain, webAgentPath], { stdio: "inherit" });
execFileSync("launchctl", ["bootstrap", domain, watchdogAgentPath], { stdio: "inherit" });
execFileSync("launchctl", ["enable", `${domain}/${label}`], { stdio: "inherit" });
execFileSync("launchctl", ["enable", `${domain}/${watchdogLabel}`], { stdio: "inherit" });
execFileSync("launchctl", ["kickstart", "-k", `${domain}/${label}`], { stdio: "inherit" });
execFileSync("launchctl", ["kickstart", "-k", `${domain}/${watchdogLabel}`], { stdio: "inherit" });

console.log(`[launchd] Installed ${label}`);
console.log(`[launchd] Installed ${watchdogLabel}`);
console.log(`[launchd] Plists:`);
console.log(`- ${webAgentPath}`);
console.log(`- ${watchdogAgentPath}`);
console.log(`[launchd] Logs:`);
console.log(`- ${path.join(logDir, "dev-web.out.log")}`);
console.log(`- ${path.join(logDir, "dev-web.err.log")}`);
console.log(`- ${path.join(logDir, "dev-watchdog.out.log")}`);
console.log(`- ${path.join(logDir, "dev-watchdog.err.log")}`);
