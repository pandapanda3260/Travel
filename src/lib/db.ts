/**
 * 通用 SQLite 文档存储。
 *
 * 所有数据以 JSON 字符串存放在单张 records 表里（collection + key 联合主键）。
 * 这样可以用最小侵入性替换原有 JSON 文件存储：readStore → dbGetAll，writeStore → dbReplaceAll。
 *
 * 数据迁移：首次访问某 collection 时，若 SQLite 为空但旧 JSON 文件存在，
 * 则自动将 JSON 数据导入 SQLite，确保存量数据不丢失。
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { ensureRuntimeDataDir, joinRuntimeDataPath } from "./runtime-storage";

const dataDir = ensureRuntimeDataDir();

const db = new Database(joinRuntimeDataPath("app.db"));

// WAL 模式：允许并发读，序列化写；NORMAL 同步模式在崩溃时有极小风险但性能更好
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL,
    key        TEXT NOT NULL,
    data       TEXT NOT NULL,
    PRIMARY KEY (collection, key)
  )
`);

// ─── 集合级 CRUD ──────────────────────────────────────────────────────────────

/**
 * 读取某集合下所有记录，返回解析后的对象数组。
 */
export function dbGetAll<T>(collection: string): T[] {
  const rows = db
    .prepare<[string], { data: string }>("SELECT data FROM records WHERE collection = ?")
    .all(collection);
  return rows.map((row) => JSON.parse(row.data) as T);
}

/**
 * 按 key 读取单条记录。
 */
export function dbGet<T>(collection: string, key: string): T | null {
  const row = db
    .prepare<[string, string], { data: string }>(
      "SELECT data FROM records WHERE collection = ? AND key = ?",
    )
    .get(collection, key);
  return row ? (JSON.parse(row.data) as T) : null;
}

/**
 * 新增或更新单条记录。
 */
export function dbUpsert(collection: string, key: string, data: unknown): void {
  db.prepare(
    "INSERT OR REPLACE INTO records (collection, key, data) VALUES (?, ?, ?)",
  ).run(collection, key, JSON.stringify(data));
}

/**
 * 删除单条记录。
 */
export function dbDelete(collection: string, key: string): void {
  db.prepare("DELETE FROM records WHERE collection = ? AND key = ?").run(collection, key);
}

/**
 * 用新数组原子替换整个集合（先删后插，同一事务）。
 */
export function dbReplaceAll(
  collection: string,
  items: ReadonlyArray<{ key: string; data: unknown }>,
): void {
  const deleteAll = db.prepare("DELETE FROM records WHERE collection = ?");
  const insert = db.prepare(
    "INSERT OR REPLACE INTO records (collection, key, data) VALUES (?, ?, ?)",
  );
  db.transaction(() => {
    deleteAll.run(collection);
    for (const item of items) {
      insert.run(collection, item.key, JSON.stringify(item.data));
    }
  })();
}

// ─── 单例存储（整个 store 是单一 JSON 对象，不是数组） ───────────────────────

const SINGLETON_KEY = "__singleton__";

export function dbGetSingleton<T>(collection: string): T | null {
  return dbGet<T>(collection, SINGLETON_KEY);
}

export function dbSetSingleton(collection: string, data: unknown): void {
  dbUpsert(collection, SINGLETON_KEY, data);
}

// ─── JSON 文件 → SQLite 迁移助手 ─────────────────────────────────────────────

/**
 * 数组型 store 迁移：若 collection 为空且旧 JSON 文件存在，则自动导入。
 * 导入完成后将旧文件重命名为 .json.bak 避免重复迁移。
 *
 * @param collection  SQLite 集合名（通常与 JSON 文件名一致）
 * @param jsonPath    旧 JSON 文件绝对路径
 * @param getKey      从记录对象中提取主键的函数
 */
export function migrateJsonArrayIfNeeded(
  collection: string,
  jsonPath: string,
  getKey: (item: unknown) => string,
): void {
  const countRow = db
    .prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM records WHERE collection = ?",
    )
    .get(collection);

  if ((countRow?.cnt ?? 0) > 0) return; // 已有数据，跳过
  if (!existsSync(jsonPath)) return;     // 没有旧文件，跳过

  try {
    const raw = readFileSync(jsonPath, "utf8");
    const items = JSON.parse(raw) as unknown[];
    if (!Array.isArray(items) || items.length === 0) return;

    dbReplaceAll(
      collection,
      items.map((item) => ({ key: getKey(item), data: item })),
    );
    renameSync(jsonPath, `${jsonPath}.bak`); // 迁移完成，保留备份
  } catch {
    // 迁移失败不中断启动，首次空 SQLite 启动也可以正常工作
  }
}

/**
 * 单例型 store 迁移：读取整个 JSON 文件并作为单例写入。
 */
export function migrateJsonSingletonIfNeeded(
  collection: string,
  jsonPath: string,
): void {
  if (dbGetSingleton(collection) !== null) return;
  if (!existsSync(jsonPath)) return;

  try {
    const raw = readFileSync(jsonPath, "utf8");
    const data = JSON.parse(raw) as unknown;
    dbSetSingleton(collection, data);
    renameSync(jsonPath, `${jsonPath}.bak`);
  } catch {
    // 静默失败，允许继续以空状态运行
  }
}

export { db };
