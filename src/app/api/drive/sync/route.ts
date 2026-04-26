import { getSession } from '@/lib/session';
import {
  getCookieSyncMeta,
  getCookieTodoStore,
  hasDriveSyncHydrated,
  markCookieTodoStoreSynced,
  markDriveSyncHydrated,
  setCookieTodoStore,
} from '@/lib/todo-cookie';
import { readDriveStore, writeDriveStore } from '@/lib/drive';

function storesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) return Response.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const [localStore, driveData, localMeta] = await Promise.all([
      getCookieTodoStore(),
      readDriveStore(session.accessToken),
      getCookieSyncMeta(),
    ]);

    return Response.json({
      initialized: await hasDriveSyncHydrated(),
      synced: Boolean(driveData && storesEqual(localStore, driveData.store) && !localMeta.dirty),
      updatedAt: driveData?.updatedAt ?? null,
    });
  } catch {
    return Response.json({ error: 'Failed to read Drive sync state' }, { status: 502 });
  }
}

export async function POST() {
  const session = await getSession();
  if (!session?.accessToken) return Response.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const [localStore, localMeta, driveData] = await Promise.all([
      getCookieTodoStore(),
      getCookieSyncMeta(),
      readDriveStore(session.accessToken),
    ]);

    if (driveData && !localMeta.dirty) {
      await setCookieTodoStore(driveData.store);
      await markCookieTodoStoreSynced(driveData.updatedAt);
      await markDriveSyncHydrated();

      return Response.json({
        ok: true,
        initialized: true,
        driveWins: true,
        replacedLocal: !storesEqual(localStore, driveData.store),
        updatedAt: driveData.updatedAt,
      });
    }

    const write = await writeDriveStore(session.accessToken, localStore);
    await markCookieTodoStoreSynced(write.updatedAt);
    await markDriveSyncHydrated();

    return Response.json({
      ok: true,
      initialized: true,
      seededFromLocal: true,
      updatedAt: write.updatedAt,
    });
  } catch {
    return Response.json({ error: 'Failed to write Drive sync state' }, { status: 502 });
  }
}

export async function PUT() {
  const session = await getSession();
  if (!session?.accessToken) return Response.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const driveData = await readDriveStore(session.accessToken);
    if (!driveData) {
      await markDriveSyncHydrated();
      return Response.json({ ok: true, initialized: true, empty: true });
    }

    await setCookieTodoStore(driveData.store);
    await markCookieTodoStoreSynced(driveData.updatedAt);
    await markDriveSyncHydrated();

    return Response.json({ ok: true, initialized: true, updatedAt: driveData.updatedAt });
  } catch {
    return Response.json({ error: 'Failed to pull todos from Drive' }, { status: 502 });
  }
}
