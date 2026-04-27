import { AsyncLocalStorage } from "node:async_hooks";

export type ModelUsageContext = {
  userId: string;
  routePath?: string | null;
  requestId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
};

const modelUsageContextStorage = new AsyncLocalStorage<ModelUsageContext>();

export function runWithModelUsageContext<T>(context: ModelUsageContext, work: () => T): T {
  return modelUsageContextStorage.run(context, work);
}

export function getModelUsageContext() {
  return modelUsageContextStorage.getStore() ?? null;
}
