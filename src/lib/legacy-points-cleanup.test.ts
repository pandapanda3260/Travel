import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-legacy-points-cleanup-"));

Object.assign(process.env, {
  NODE_ENV: "development",
  TRAVEL_DATA_DIR: testDataDir,
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
});

let dbModulePromise: Promise<typeof import("./db")> | null = null;

function loadDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = import("./db");
  }
  return dbModulePromise;
}

function countLegacyRecordCollections(db: typeof import("./db").db) {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS value
        FROM records
        WHERE collection IN ('points-rules', 'user-points-accounts', 'points-config')
      `,
    )
    .get() as { value?: number } | undefined;
  return Number(row?.value ?? 0);
}

function hasLegacyPointTable(db: typeof import("./db").db) {
  const row = db
    .prepare("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'user_point_records'")
    .get() as { value?: number } | undefined;
  return Number(row?.value ?? 0) > 0;
}

test("旧积分表和旧积分文档集合会被可重复清理", async () => {
  const { db, purgeLegacyPointsStorage } = await loadDbModule();

  db.prepare("INSERT OR REPLACE INTO records (collection, key, data) VALUES (?, ?, ?)").run(
    "points-rules",
    "daily_login",
    "{}",
  );
  db.prepare("INSERT OR REPLACE INTO records (collection, key, data) VALUES (?, ?, ?)").run(
    "user-points-accounts",
    "user-legacy",
    "{}",
  );
  db.prepare("INSERT OR REPLACE INTO records (collection, key, data) VALUES (?, ?, ?)").run(
    "points-config",
    "__singleton__",
    "{}",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_point_records (
      point_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      change_value INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_point_records_user_created
      ON user_point_records (user_id);

    INSERT OR REPLACE INTO user_point_records (point_id, user_id, change_value)
    VALUES ('point-legacy', 'user-legacy', 100);
  `);

  assert.equal(countLegacyRecordCollections(db), 3);
  assert.equal(hasLegacyPointTable(db), true);

  purgeLegacyPointsStorage();
  purgeLegacyPointsStorage();

  assert.equal(countLegacyRecordCollections(db), 0);
  assert.equal(hasLegacyPointTable(db), false);
});
