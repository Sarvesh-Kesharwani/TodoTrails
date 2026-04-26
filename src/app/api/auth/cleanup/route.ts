import { clearCookieTodoStore } from '@/lib/todo-cookie';

export async function POST() {
  await clearCookieTodoStore();
  return Response.json({ ok: true });
}
