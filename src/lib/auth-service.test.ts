import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-auth-service-"));

Object.assign(process.env, {
  NODE_ENV: "development",
  TRAVEL_DATA_DIR: testDataDir,
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
});

let modulesPromise: Promise<{
  authService: typeof import("./auth-service");
  dbModule: typeof import("./db");
}> | null = null;

function loadModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([import("./auth-service"), import("./db")]).then(
      ([authService, dbModule]) => ({
        authService,
        dbModule,
      }),
    );
  }
  return modulesPromise;
}

function getLegacyPointState(dbModule: typeof import("./db"), userId: string) {
  const account = dbModule.db
    .prepare("SELECT data FROM records WHERE collection = 'user-points-accounts' AND key = ?")
    .get(userId);
  const pointRecordTable = dbModule.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_point_records'")
    .get();
  const recordCount = pointRecordTable
    ? Number(
        (
          dbModule.db
            .prepare("SELECT COUNT(*) AS value FROM user_point_records WHERE user_id = ?")
            .get(userId) as { value?: number } | undefined
        )?.value ?? 0,
      )
    : 0;

  return { account, recordCount };
}

test("用户注册和密码登录不再创建旧积分账户或旧积分流水", async () => {
  const { authService, dbModule } = await loadModules();

  const registered = authService.registerUserWithPassword(
    {
      phone: "15600010001",
      password: "Travel123",
      nickname: "商业积分用户",
    },
    { ip: "127.0.0.1", userAgent: "auth-service-test" },
  );

  assert.deepEqual(getLegacyPointState(dbModule, registered.userId), { account: undefined, recordCount: 0 });

  authService.loginUserWithPassword(
    { phone: "15600010001", password: "Travel123" },
    { ip: "127.0.0.1", userAgent: "auth-service-test" },
  );

  assert.deepEqual(getLegacyPointState(dbModule, registered.userId), { account: undefined, recordCount: 0 });
});
