import { prisma } from "@/lib/db/prisma";

type SyncState = {
  fullSyncCursor?: string;
};

export async function loadSyncState(): Promise<SyncState> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: "fullSyncCursor" },
    });
    return row?.value ? { fullSyncCursor: row.value } : {};
  } catch {
    return {};
  }
}

export async function saveFullSyncCursor(cursor?: string): Promise<void> {
  if (cursor) {
    await prisma.setting.upsert({
      where: { key: "fullSyncCursor" },
      update: { value: cursor },
      create: { key: "fullSyncCursor", value: cursor },
    });
  } else {
    await prisma.setting.deleteMany({
      where: { key: "fullSyncCursor" },
    });
  }
}
