#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

const remoteHost = process.env.TRAVEL_DEPLOY_HOST ?? "101.47.18.47";
const remoteUser = process.env.TRAVEL_DEPLOY_USER ?? "root";
const remoteAppDir = process.env.TRAVEL_DEPLOY_APP_DIR ?? "/srv/travel";
const remoteRuntimeDir = process.env.TRAVEL_DEPLOY_RUNTIME_DIR ?? "/srv/travel-runtime";
const serviceName = process.env.TRAVEL_DEPLOY_SERVICE ?? "travel-web.service";
const watchdogTimerName = process.env.TRAVEL_DEPLOY_WATCHDOG_TIMER ?? "travel-web-watchdog.timer";
const healthcheckUrl = process.env.TRAVEL_DEPLOY_HEALTHCHECK_URL ?? "http://127.0.0.1:3000/api/health";
const identityFile = expandHome(
  process.env.TRAVEL_DEPLOY_KEY ?? "/Users/bytedance/Desktop/Travel 相关文件/key/travel.pem",
);

const allowDirty = args.has("--allow-dirty") || process.env.TRAVEL_DEPLOY_ALLOW_DIRTY === "1";
const skipBuild = args.has("--skip-build");
const syncMedia = args.has("--sync-media");
const dryRun = args.has("--dry-run");

const runtimePublicDirs = [
  "generated-audio",
  "generated-compositions",
  "generated-final-videos",
  "generated-images",
  "generated-subtitles",
  "generated-videos",
  "product-archives",
  "video-materials",
  "video-tasks",
];

const archiveExcludes = [
  ":(exclude)data",
  ":(exclude)public/generated-audio",
  ":(exclude)public/generated-compositions",
  ":(exclude)public/generated-final-videos",
  ":(exclude)public/generated-images",
  ":(exclude)public/generated-subtitles",
  ":(exclude)public/generated-videos",
  ":(exclude)public/product-archives",
  ":(exclude)public/video-materials",
  ":(exclude)public/video-tasks",
];

function expandHome(value) {
  if (!value.startsWith("~/")) {
    return value;
  }
  return resolve(os.homedir(), value.slice(2));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function log(message) {
  console.log(`[deploy-production] ${message}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? projectRoot,
    encoding: "utf8",
    env: process.env,
    stdio: options.stdio ?? "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} exited with ${result.status}`);
  }
  return result.stdout ?? "";
}

function output(command, commandArgs) {
  return run(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sshBaseArgs() {
  return ["-i", identityFile, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];
}

function remoteTarget() {
  return `${remoteUser}@${remoteHost}`;
}

function runRemote(script) {
  return run("ssh", [...sshBaseArgs(), remoteTarget(), "bash", "-lc", script]);
}

function ensureGitClean() {
  const status = output("git", ["status", "--porcelain=v1"]);
  if (!status) {
    return;
  }

  if (allowDirty) {
    log("working tree has local changes; deploying HEAD because --allow-dirty was set");
    return;
  }

  console.error("[deploy-production] 工作区有未提交修改，默认不部署，避免把半成品传到生产。");
  console.error("请先提交代码，或确认只部署当前 HEAD 时使用：npm run deploy:prod -- --allow-dirty");
  console.error(status);
  process.exit(2);
}

function printConfig() {
  log(`remote=${remoteTarget()}`);
  log(`identityFile=${identityFile}`);
  log(`remoteAppDir=${remoteAppDir}`);
  log(`remoteRuntimeDir=${remoteRuntimeDir}`);
  log(`serviceName=${serviceName}`);
  log(`healthcheckUrl=${healthcheckUrl}`);
  log(`syncMedia=${syncMedia ? "yes" : "no"}`);
}

function validateConfig() {
  if (!remoteHost || !remoteUser) {
    throw new Error("TRAVEL_DEPLOY_HOST and TRAVEL_DEPLOY_USER are required");
  }
  if (!existsSync(identityFile)) {
    throw new Error(`SSH identity file not found: ${identityFile}`);
  }
}

async function deployCodeArchive() {
  const remoteExtractScript = [
    "set -euo pipefail",
    `rm -rf ${shellQuote(remoteAppDir)}`,
    `mkdir -p ${shellQuote(remoteAppDir)}`,
    `tar -xf - -C ${shellQuote(remoteAppDir)}`,
  ].join("\n");

  const gitArgs = ["archive", "--format=tar", "HEAD", "--", ".", ...archiveExcludes];
  const sshArgs = [...sshBaseArgs(), remoteTarget(), "bash", "-lc", remoteExtractScript];

  log("streaming current git HEAD to the server");

  await new Promise((resolvePromise, reject) => {
    const git = spawn("git", gitArgs, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const ssh = spawn("ssh", sshArgs, {
      cwd: projectRoot,
      stdio: ["pipe", "inherit", "inherit"],
    });

    let gitExit = null;
    let sshExit = null;
    let settled = false;

    function settleIfDone() {
      if (settled || gitExit === null || sshExit === null) {
        return;
      }
      settled = true;
      if (gitExit !== 0) {
        reject(new Error(`git archive exited with ${gitExit}`));
        return;
      }
      if (sshExit !== 0) {
        reject(new Error(`remote extract exited with ${sshExit}`));
        return;
      }
      resolvePromise();
    }

    git.on("error", reject);
    ssh.on("error", reject);
    git.on("close", (code) => {
      gitExit = code ?? 0;
      settleIfDone();
    });
    ssh.on("close", (code) => {
      sshExit = code ?? 0;
      settleIfDone();
    });

    git.stdout.pipe(ssh.stdin);
    ssh.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        reject(error);
      }
    });
  });
}

function syncRuntimeMedia() {
  log("syncing historical runtime media; this can be slow on overseas links");
  for (const dirName of runtimePublicDirs) {
    const localPath = resolve(projectRoot, "public", dirName);
    if (!existsSync(localPath)) {
      continue;
    }

    log(`syncing public/${dirName}`);
    run("rsync", [
      "-a",
      "--progress",
      "-e",
      `ssh ${sshBaseArgs().map(shellQuote).join(" ")}`,
      localPath,
      `${remoteTarget()}:${remoteRuntimeDir}/public/`,
    ]);
  }
}

function installAndRestartRemote() {
  const remoteScript = [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(remoteRuntimeDir)}/data ${shellQuote(remoteRuntimeDir)}/public`,
    `cd ${shellQuote(remoteAppDir)}`,
    skipBuild ? "npm ci" : "npm ci && npm run build",
    "cp ops/systemd/travel-web.service /etc/systemd/system/",
    "cp ops/systemd/travel-web-watchdog.service /etc/systemd/system/",
    "cp ops/systemd/travel-web-watchdog.timer /etc/systemd/system/",
    "systemctl daemon-reload",
    `systemctl enable --now ${shellQuote(serviceName)}`,
    `systemctl enable --now ${shellQuote(watchdogTimerName)}`,
    `chown -R www-data:www-data ${shellQuote(remoteAppDir)} ${shellQuote(remoteRuntimeDir)}`,
    `systemctl restart ${shellQuote(serviceName)}`,
    "sleep 2",
    `curl -fsS ${shellQuote(healthcheckUrl)}`,
  ].join("\n");

  log(skipBuild ? "installing dependencies and restarting remote service" : "installing dependencies, building, and restarting remote service");
  runRemote(remoteScript);
}

async function main() {
  validateConfig();
  printConfig();
  if (dryRun) {
    log("dry run only; no changes were made");
    return;
  }

  ensureGitClean();
  await deployCodeArchive();
  installAndRestartRemote();

  if (syncMedia) {
    syncRuntimeMedia();
  }

  log("deployment finished");
}

main().catch((error) => {
  console.error(`[deploy-production] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
