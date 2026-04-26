import { getCookieTodoStore, markCookieTodoStoreDirty, setCookieTodoStore } from '@/lib/todo-cookie';
import { normalizeStore } from '@/types/todo';

export async function GET() {
  const store = await getCookieTodoStore();
  return Response.json(store);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const store = normalizeStore(body);
    store.updatedAt = new Date().toISOString();
    await setCookieTodoStore(store);
    await markCookieTodoStoreDirty(store.updatedAt);
    return Response.json({ ok: true, updatedAt: store.updatedAt });
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
}
