import { existsSync, mkdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { loadOptionalEnvFile } from "./env-file";

function getConfiguredValue(key: string) {
  const storageEnv = loadOptionalEnvFile("travel.env.local");
  return process.env[key]?.trim() || storageEnv[key]?.trim() || "";
}

function getDefaultProjectRoot() {
  return /* turbopackIgnore: true */ process.cwd();
}

export function getRuntimeStorageRoot() {
  return getConfiguredValue("TRAVEL_STORAGE_ROOT") || getDefaultProjectRoot();
}

export function getRuntimeDataDir() {
  return getConfiguredValue("TRAVEL_DATA_DIR") || join(getRuntimeStorageRoot(), "data");
}

export function getRuntimePublicStorageDir() {
  return getConfiguredValue("TRAVEL_PUBLIC_STORAGE_DIR") || join(getRuntimeStorageRoot(), "public");
}

export function getRuntimeStorageMeta() {
  return {
    projectRoot: getDefaultProjectRoot(),
    storageRoot: getRuntimeStorageRoot(),
    dataDir: getRuntimeDataDir(),
    publicStorageDir: getRuntimePublicStorageDir(),
    usesExternalStorage: resolve(getRuntimeStorageRoot()) !== resolve(getDefaultProjectRoot()),
  };
}

export function ensureRuntimeDataDir() {
  const dataDir = getRuntimeDataDir();
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function ensureRuntimePublicStorageDir() {
  const publicDir = getRuntimePublicStorageDir();
  mkdirSync(publicDir, { recursive: true });
  return publicDir;
}

export function joinRuntimeDataPath(...segments: string[]) {
  return join(getRuntimeDataDir(), ...segments);
}

export function joinRuntimePublicStoragePath(...segments: string[]) {
  return join(getRuntimePublicStorageDir(), ...segments);
}

export function resolveRuntimeAssetUrlToPath(publicUrl: string) {
  return joinRuntimePublicStoragePath(publicUrl.replace(/^\//, ""));
}

export function isPathWithinDirectory(rootDir: string, targetPath: string) {
  const normalizedRoot = resolve(rootDir);
  const normalizedTarget = resolve(targetPath);
  const rel = relative(normalizedRoot, normalizedTarget);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

export function runtimeAssetUrlExists(publicUrl: string) {
  if (!publicUrl.startsWith("/")) {
    return false;
  }

  return existsSync(resolveRuntimeAssetUrlToPath(publicUrl));
}
