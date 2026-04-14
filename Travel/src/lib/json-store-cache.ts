import { readFileSync, statSync } from "node:fs";

type CacheEntry = { mtimeMs: number; data: unknown };
const entries = new Map<string, CacheEntry>();

// 每个文件独立的写锁：同一文件的并发操作会被序列化到一条 Promise 链
const fileLocks = new Map<string, Promise<unknown>>();

/**
 * 对指定文件加锁后执行 fn，同文件的并发调用会排队等待。
 * fn 可以是同步或异步函数；适合包裹"读-改-写"整个原子块。
 */
export function withFileLock<T>(filePath: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  const current = prev.then(() => fn()) as Promise<T>;
  // 无论成功失败，都让后续任务能继续入队
  fileLocks.set(filePath, current.catch(() => undefined));
  return current;
}

/**
 * Read and parse a JSON file with mtime-based caching.
 * Returns the cached parsed result if the file has not been modified since the
 * last read, avoiding redundant readFileSync + JSON.parse on hot paths.
 *
 * Callers that transform the raw JSON (e.g. merging defaults) should cache the
 * transformed result separately or use {@link invalidateJsonStoreCache} after
 * their own writeFileSync calls to keep the raw cache in sync.
 */
export function readJsonFileWithCache<T>(filePath: string): T {
  try {
    const { mtimeMs } = statSync(filePath);
    const cached = entries.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data as T;
    }
    const data = JSON.parse(readFileSync(filePath, "utf8")) as T;
    entries.set(filePath, { mtimeMs, data });
    return data;
  } catch {
    entries.delete(filePath);
    throw new Error(`Failed to read or parse JSON file: ${filePath}`);
  }
}

/**
 * Remove the cached entry for a specific file path so the next read
 * will re-parse from disk. Call this after writeFileSync to keep the
 * cache consistent.
 */
export function invalidateJsonStoreCache(filePath: string) {
  entries.delete(filePath);
}
