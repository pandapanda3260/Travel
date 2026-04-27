import { dbGet, dbGetAll, dbUpsert } from "./db";

export type AdminDataExportJobStatus = "ready" | "expired" | "failed";

export type AdminDataExportJobRecord = {
  jobId: string;
  domain: "users" | "tasks" | "assets" | "system";
  fileName: string;
  filePath: string;
  rowCount: number;
  status: AdminDataExportJobStatus;
  createdAt: string;
  createdByAdminId: string;
  createdByName: string;
  expiresAt: string;
  lastDownloadedAt: string | null;
  downloadCount: number;
  filters: {
    domain: string;
    keyword: string;
    timeRange: string;
    status: string;
    loginType: string;
    assetType: string;
    systemType: string;
  };
};

export type AdminDataExportJobSummary = Omit<AdminDataExportJobRecord, "filePath">;

const COLLECTION = "admin-data-export-jobs";

function safeList<T>(collection: string) {
  try {
    return dbGetAll<T>(collection);
  } catch {
    return [] as T[];
  }
}

export function listAdminDataExportJobs() {
  return safeList<AdminDataExportJobRecord>(COLLECTION).sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function sanitizeAdminDataExportJob(job: AdminDataExportJobRecord): AdminDataExportJobSummary {
  const { filePath: _filePath, ...summary } = job;
  return summary;
}

export function listAdminDataExportJobSummaries() {
  return listAdminDataExportJobs().map(sanitizeAdminDataExportJob);
}

export function getAdminDataExportJob(jobId: string) {
  return dbGet<AdminDataExportJobRecord>(COLLECTION, jobId);
}

export function upsertAdminDataExportJob(job: AdminDataExportJobRecord) {
  dbUpsert(COLLECTION, job.jobId, job);
  return job;
}

export function patchAdminDataExportJob(jobId: string, updates: Partial<AdminDataExportJobRecord>) {
  const current = getAdminDataExportJob(jobId);
  if (!current) {
    return null;
  }

  const nextJob: AdminDataExportJobRecord = {
    ...current,
    ...updates,
    filters: {
      ...current.filters,
      ...updates.filters,
    },
  };
  dbUpsert(COLLECTION, jobId, nextJob);
  return nextJob;
}
