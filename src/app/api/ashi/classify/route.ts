import { classifyTodos } from '@/lib/ashi-ai';
import { normalizeStore, type AshiCategory, type TodoItem, type TagRulesStore } from '@/types/todo';

export const runtime = 'nodejs';

type ClassifyBody = {
  todos?: TodoItem[];
  categories?: AshiCategory[];
  rulesPrompt?: string;
  tagRules?: TagRulesStore;
  basePrompt?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ClassifyBody;
    const store = normalizeStore({
      todos: Array.isArray(body.todos) ? body.todos : [],
      ashiSettings: { categories: Array.isArray(body.categories) ? body.categories : [] },
    });
    const rulesPrompt = typeof body.rulesPrompt === 'string' ? body.rulesPrompt.trim() : '';
    const tagRules = body.tagRules;
    const basePrompt = typeof body.basePrompt === 'string' ? body.basePrompt.trim() : undefined;
    const assignments = await classifyTodos(store.todos, store.ashiSettings.categories, rulesPrompt, tagRules, basePrompt);
    return Response.json({ assignments });
  } catch {
    return Response.json({ error: 'Invalid classify request.' }, { status: 400 });
  }
}
