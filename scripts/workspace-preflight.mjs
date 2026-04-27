#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const args = new Set(process.argv.slice(2));
const strictMode = args.has("--strict") || process.env.PREFLIGHT_STRICT === "1";
const fixTemp = args.has("--fix-temp");

const warnings = [];
const infos = [];

function pathOf(...parts) {
  return join(cwd, ...parts);
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function countTsFilesUnder(dirPath) {
  if (!existsSync(dirPath)) {
    return 0;
  }
  let total = 0;
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (/\.(ts|tsx)$/i.test(entry)) {
        total += 1;
      }
    }
  }
  return total;
}

const legacyRoot = pathOf("Travel");
if (existsSync(legacyRoot)) {
  const legacySrc = pathOf("Travel", "src");
  const legacyTsCount = countTsFilesUnder(legacySrc);
  if (legacyTsCount > 0) {
    warnings.push(
      `检测到旧版本副本目录 Travel/src（约 ${legacyTsCount} 个 TS/TSX 文件）。若 tsconfig 扫描到它，会导致无关 typecheck 报错。`,
    );
  } else {
    infos.push("检测到 Travel 目录，但未发现明显 TS 源码污染。");
  }

  const primaryFile = pathOf("src", "lib", "system-rules-payload.ts");
  const legacyFile = pathOf("Travel", "src", "lib", "system-rules-payload.ts");
  if (existsSync(primaryFile) && existsSync(legacyFile)) {
    warnings.push("检测到 system-rules-payload.ts 存在新旧两份副本，排查类型错误时请优先确认扫描范围。");
  }
}

const tempTestsDir = pathOf(".tmp-tests");
if (existsSync(tempTestsDir)) {
  if (fixTemp) {
    rmSync(tempTestsDir, { recursive: true, force: true });
    infos.push("已自动清理 .tmp-tests 临时目录。");
  } else {
    warnings.push("检测到 .tmp-tests 临时目录残留，建议清理以减少扫描噪音（可运行：npm run preflight -- --fix-temp）。");
  }
}

const tsconfigPath = pathOf("tsconfig.json");
const tsconfig = safeReadJson(tsconfigPath);
if (!tsconfig) {
  warnings.push("tsconfig.json 无法解析，无法校验 include/exclude 范围。");
} else {
  const exclude = Array.isArray(tsconfig.exclude) ? tsconfig.exclude : [];
  if (!exclude.includes("Travel")) {
    warnings.push("tsconfig.exclude 未包含 Travel，可能把旧副本目录编译进去。");
  }
  if (!exclude.includes(".tmp-tests")) {
    warnings.push("tsconfig.exclude 未包含 .tmp-tests，测试临时文件可能进入类型检查。");
  }
}

if (warnings.length === 0) {
  console.log("[preflight] Workspace 自检通过。");
  if (infos.length) {
    for (const info of infos) {
      console.log(`[preflight] ${info}`);
    }
  }
  process.exit(0);
}

console.log("[preflight] 发现需要关注的工作区项：");
for (const warning of warnings) {
  console.log(`- ${warning}`);
}
for (const info of infos) {
  console.log(`[info] ${info}`);
}

console.log("[preflight] 建议：");
console.log("- 确认 tsconfig.exclude 至少包含 Travel 和 .tmp-tests。");
console.log("- 旧版本目录如不再使用，可迁移/归档到工作区外。");
console.log("- 需要时可执行：npm run preflight -- --fix-temp");

if (strictMode) {
  process.exit(1);
}

process.exit(0);
