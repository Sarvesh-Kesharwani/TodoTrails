import { decideRollover } from '@/lib/ashi-ai';
import { normalizeStore, type AshiCategory, type TodoItem } from '@/types/todo';

export const runtime = 'nodejs';

type RolloverBody = {
  todos?: TodoItem[];
  categories?: AshiCategory[];
  prompt?: string;
  todayKey?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RolloverBody;
    const store = normalizeStore({
      todos: Array.isArray(body.todos) ? body.todos : [],
      ashiSettings: { categories: Array.isArray(body.categories) ? body.categories : [] },
    });
    const todayKey = typeof body.todayKey === 'string' && body.todayKey.trim() ? body.todayKey.trim() : new Date().toISOString().slice(0, 10);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const decisions = await decideRollover(store.todos, store.ashiSettings.categories, prompt, todayKey);
    return Response.json({ decisions });
  } catch {
    return Response.json({ error: 'Invalid rollover request.' }, { status: 400 });
  }
}
