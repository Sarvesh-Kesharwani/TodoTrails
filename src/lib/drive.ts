import { normalizeStore, type TodoStore } from '@/types/todo';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'mytodo-board.json';
const SPACE = 'appDataFolder';

interface DriveTodoData {
  store: TodoStore;
  updatedAt: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFile(accessToken: string): Promise<string | null> {
  const query = [`name='${escapeDriveQueryValue(FILE_NAME)}'`, `'${escapeDriveQueryValue(SPACE)}' in parents`].join(' and ');
  const params = new URLSearchParams({ spaces: SPACE, q: query, fields: 'files(id)' });
  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

async function readFileJson<T>(accessToken: string, fileId: string): Promise<T | null> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function uploadJsonFile(accessToken: string, body: string, fileId?: string): Promise<void> {
  if (fileId) {
    await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body,
    });
    return;
  }

  const metadata = JSON.stringify({ name: FILE_NAME, parents: [SPACE] });
  const boundary = 'mytodo_boundary';
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    body,
    `--${boundary}--`,
  ].join('\r\n');

  await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
}

export async function readDriveStore(accessToken: string): Promise<DriveTodoData | null> {
  const fileId = await findFile(accessToken);
  if (!fileId) return null;
  const data = await readFileJson<DriveTodoData>(accessToken, fileId);
  if (!data) return null;
  return { store: normalizeStore(data.store), updatedAt: data.updatedAt || new Date(0).toISOString() };
}

export async function writeDriveStore(accessToken: string, store: TodoStore): Promise<{ updatedAt: string }> {
  const fileId = await findFile(accessToken);
  const payload: DriveTodoData = { store: normalizeStore(store), updatedAt: new Date().toISOString() };
  await uploadJsonFile(accessToken, JSON.stringify(payload), fileId ?? undefined);
  return { updatedAt: payload.updatedAt };
}
