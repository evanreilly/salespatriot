let syncRunning = false;

export type SyncProgressUpdate = {
  phase: string;
  current: number;
  total: number;
  message: string;
};

export type SyncProgress = SyncProgressUpdate & {
  active: boolean;
  operation: string;
  startedAt: string | null;
};

let progress: SyncProgress = {
  active: false,
  operation: "",
  phase: "idle",
  current: 0,
  total: 0,
  message: "",
  startedAt: null,
};

export function getSyncProgress(): SyncProgress {
  return { ...progress };
}

export async function runSyncExclusive<T>(
  operationName: string,
  operation: (report: (update: SyncProgressUpdate) => void) => Promise<T>,
): Promise<T | null> {
  if (syncRunning) return null;
  syncRunning = true;
  progress = {
    active: true,
    operation: operationName,
    phase: "starting",
    current: 0,
    total: 1,
    message: "Starting…",
    startedAt: new Date().toISOString(),
  };
  try {
    return await operation((update) => {
      progress = { ...progress, ...update, active: true };
    });
  } finally {
    syncRunning = false;
    progress = { ...progress, active: false };
  }
}
