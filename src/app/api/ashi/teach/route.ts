import { interpretTeachInstruction } from '@/lib/ashi-ai';
import { normalizeStore, type AshiCategory, type TodoItem } from '@/types/todo';

export const runtime = 'nodejs';

type TeachBody = {
  todo?: TodoItem;
  categories?: AshiCategory[];
  instruction?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TeachBody;
    const store = normalizeStore({
      todos: body.todo ? [body.todo] : [],
      ashiSettings: { categories: Array.isArray(body.categories) ? body.categories : [] },
    });
    const todo = store.todos[0];
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!todo || !instruction) return Response.json({ error: 'Todo and instruction required.' }, { status: 400 });
    const intent = await interpretTeachInstruction(todo, instruction, store.ashiSettings.categories);
    return Response.json({ intent });
  } catch {
    return Response.json({ error: 'Invalid teach request.' }, { status: 400 });
  }
}
