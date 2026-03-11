import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SyncState = {
  fullSyncCursor?: string;
};

const statePath = join(process.cwd(), ".redmaester-sync-state.json");

export async function loadSyncState(): Promise<SyncState> {
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as SyncState;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export async function saveFullSyncCursor(cursor?: string): Promise<void> {
  const nextState: SyncState = cursor ? { fullSyncCursor: cursor } : {};
  await writeFile(statePath, JSON.stringify(nextState, null, 2), "utf-8");
}
