import { getSession } from '@/lib/session';
import { getDefaultCloudTodoStore, setDefaultCloudTodoStore } from '@/lib/supabase-default-store';
import { getCookieTodoStore, markCookieTodoStoreDirty, setCookieTodoStore } from '@/lib/todo-cookie';
import { normalizeStore } from '@/types/todo';

export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    const store = await getDefaultCloudTodoStore();
    return Response.json({ ...store, source: 'supabase-default' });
  }

  const store = await getCookieTodoStore();
  return Response.json({ ...store, source: 'local-auth' });
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const body = await req.json();
    const store = normalizeStore(body);

    if (!session?.user) {
      const saved = await setDefaultCloudTodoStore(store);
      return Response.json({ ok: true, updatedAt: saved.updatedAt, source: 'supabase-default' });
    }

    await setCookieTodoStore(store);
    await markCookieTodoStoreDirty(store.updatedAt);
    return Response.json({ ok: true, updatedAt: store.updatedAt, source: 'local-auth' });
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
}
