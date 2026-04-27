import { accessSync, constants, mkdirSync } from "node:fs";

import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { getRuntimeStorageMeta } from "../../../lib/runtime-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HealthCheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

function sanitizePublicHealthDetail(name: string, ok: boolean, detail: string) {
  if (name === "data_dir" || name === "public_storage") {
    return ok ? "读写正常" : "访问异常";
  }
  if (name === "sqlite") {
    return ok ? "SQLite 读写连接正常" : "SQLite 检查失败";
  }
  return detail;
}

function runHealthChecks() {
  const checks: HealthCheckResult[] = [];
  const storageMeta = getRuntimeStorageMeta();

  try {
    db.prepare("SELECT 1 AS ok").get();
    checks.push({
      name: "sqlite",
      ok: true,
      detail: "SQLite 读写连接正常",
    });
  } catch (error) {
    checks.push({
      name: "sqlite",
      ok: false,
      detail: error instanceof Error ? error.message : "SQLite 检查失败",
    });
  }

  try {
    mkdirSync(storageMeta.dataDir, { recursive: true });
    accessSync(storageMeta.dataDir, constants.R_OK | constants.W_OK);
    checks.push({
      name: "data_dir",
      ok: true,
      detail: storageMeta.dataDir,
    });
  } catch (error) {
    checks.push({
      name: "data_dir",
      ok: false,
      detail: error instanceof Error ? error.message : "数据目录不可用",
    });
  }

  try {
    mkdirSync(storageMeta.publicStorageDir, { recursive: true });
    accessSync(storageMeta.publicStorageDir, constants.R_OK | constants.W_OK);
    checks.push({
      name: "public_storage",
      ok: true,
      detail: storageMeta.publicStorageDir,
    });
  } catch (error) {
    checks.push({
      name: "public_storage",
      ok: false,
      detail: error instanceof Error ? error.message : "公共存储目录不可用",
    });
  }

  const ok = checks.every((item) => item.ok);

  return {
    ok,
    service: "travel-web",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    storage: {
      usesExternalStorage: storageMeta.usesExternalStorage,
    },
    checks: checks.map((item) => ({
      ...item,
      detail: sanitizePublicHealthDetail(item.name, item.ok, item.detail),
    })),
  };
}

export async function GET() {
  const payload = runHealthChecks();

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function HEAD() {
  const payload = runHealthChecks();

  return new NextResponse(null, {
    status: payload.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
