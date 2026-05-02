import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const remote = process.env.AUTO_BACKUP_REMOTE ?? "origin";
const baseBranch = process.env.AUTO_BACKUP_BASE_BRANCH ?? "main";
const backupBranch = process.env.AUTO_BACKUP_BRANCH ?? "";
const pushMain = process.env.AUTO_BACKUP_PUSH_MAIN !== "0";
const maxFileBytes = Number(process.env.AUTO_BACKUP_MAX_FILE_MB ?? "95") * 1024 * 1024;

function log(message) {
  console.log(`[git-auto-backup ${new Date().toISOString()}] ${message}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function tryRun(command, args) {
  try {
    run(command, args);
    return true;
  } catch {
    return false;
  }
}

function output(command, args) {
  return run(command, args).trim();
}

function splitNullList(value) {
  return value.split("\0").filter(Boolean);
}

function ensureSafeState() {
  const currentBranch = output("git", ["branch", "--show-current"]);
  if (currentBranch !== baseBranch) {
    log(`skip: current branch is ${currentBranch || "(detached)"}, expected ${baseBranch}`);
    process.exit(0);
  }

  const gitDir = output("git", ["rev-parse", "--git-dir"]);
  for (const marker of ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "BISECT_LOG"]) {
    if (existsSync(path.join(gitDir, marker))) {
      log(`skip: git operation in progress (${marker})`);
      process.exit(0);
    }
  }
}

function isDangerousPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const base = path.basename(normalized).toLowerCase();

  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    base.endsWith(".env") ||
    base === "id_rsa" ||
    base === "id_ed25519" ||
    base.endsWith(".pem") ||
    base.endsWith(".p12") ||
    base.endsWith(".pfx") ||
    base.endsWith(".mobileprovision") ||
    normalized.includes("/.ssh/")
  );
}

const secretPatterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];

function stagedFiles() {
  return splitNullList(output("git", ["diff", "--cached", "--name-only", "-z"]));
}

function resetIndexAndExit(message) {
  tryRun("git", ["reset", "-q"]);
  log(message);
  process.exit(2);
}

function validateStagedFiles(files) {
  const dangerous = files.filter(isDangerousPath);
  if (dangerous.length > 0) {
    resetIndexAndExit(`blocked: sensitive-looking file path: ${dangerous.join(", ")}`);
  }

  for (const filePath of files) {
    if (!existsSync(filePath)) {
      continue;
    }

    const stats = statSync(filePath);
    if (!stats.isFile()) {
      continue;
    }

    if (stats.size > maxFileBytes) {
      resetIndexAndExit(
        `blocked: file is larger than ${Math.round(maxFileBytes / 1024 / 1024)}MB: ${filePath}`,
      );
    }

    if (stats.size > 2 * 1024 * 1024) {
      continue;
    }

    const contents = readFileSync(filePath, "utf8");
    if (secretPatterns.some((pattern) => pattern.test(contents))) {
      resetIndexAndExit(`blocked: possible secret detected in ${filePath}`);
    }
  }
}

function hasWorkingTreeChanges() {
  return output("git", ["status", "--porcelain=v1"]).length > 0;
}

function commitLocalChangesIfNeeded() {
  if (!hasWorkingTreeChanges()) {
    log("no local file changes to commit");
    return;
  }

  run("git", ["add", "-A", "--", "."]);
  const files = stagedFiles();
  if (files.length === 0) {
    log("no staged changes after add");
    return;
  }

  validateStagedFiles(files);

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  run("git", ["commit", "-m", `chore: auto backup ${stamp}`], { stdio: "inherit" });
}

function pushBranches() {
  tryRun("git", ["fetch", "--quiet", remote, baseBranch]);

  const remoteBase = `${remote}/${baseBranch}`;
  const canPushMain = tryRun("git", ["merge-base", "--is-ancestor", remoteBase, "HEAD"]);

  if (pushMain) {
    if (canPushMain) {
      run("git", ["push", remote, `HEAD:refs/heads/${baseBranch}`], { stdio: "inherit" });
      log(`pushed ${baseBranch} to ${remote}`);
    } else {
      log(`skip pushing ${baseBranch}: remote has commits not in local ${baseBranch}`);
    }
  }

  const trimmedBackupBranch = backupBranch.trim();
  if (trimmedBackupBranch && trimmedBackupBranch !== "0" && trimmedBackupBranch !== "false") {
    run("git", ["push", "--force-with-lease", remote, `HEAD:refs/heads/${trimmedBackupBranch}`], {
      stdio: "inherit",
    });
    log(`updated backup branch ${trimmedBackupBranch}`);
  } else {
    log("backup branch push disabled");
  }
}

ensureSafeState();
commitLocalChangesIfNeeded();
pushBranches();
