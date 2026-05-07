import { normalizeStore, type TodoItem } from '@/types/todo';

export const runtime = 'nodejs';

type ChatBody = {
  question?: string;
  todos?: TodoItem[];
};

const SYSTEM_PROMPT = `You are Ashi, a friendly todo assistant inside TodoTrails.
Answer only from the supplied tasks. Never invent missing tasks, people, locations, dates, or status.
Sound natural and helpful, not robotic. User may ask in Hindi, Hinglish, or English; reply in the same style as the user when possible.

When the user asks about tasks for a date, day, person, location, situation, or bucket:
- Start with a direct human answer: "Yes, there are 3 pending tasks..." or "I don't see any pending tasks..."
- Mention the matched date/person/location in the first sentence.
- Format the answer in Markdown-style structure.
- If you mention more than one task, put tasks in bullet points. Do not write task lists in one paragraph.
- Each task bullet should start with the task title, then useful details like due time/date, person, location, notes, or bucket when present.
- Separate pending and completed only if completed tasks are supplied. If only pending tasks are supplied, say pending.
- If nothing matches, say you do not see it in the current tasks and suggest what detail is missing.
- Do not use tables or JSON.

Examples:
User: "kal gajnan se kya kaam hai?"
Answer:
Yes, I see 2 pending tasks for Gajnan tomorrow:

- Call Gajnan about the bill
- Pick up documents from him
User: "office location ke tasks?"
Answer:
Yes, there are 3 pending tasks linked to office:

- Submit expense form - due today
- Pick up files - person: Rahul
- Check meeting room setup
User: "15 may ko kya hai?"
Answer:
I see 1 pending task for May 15:

- Pay electricity bill - bucket: week

Keep answers compact: 2-6 short lines unless user asks for more detail.`;

function compactTodo(todo: TodoItem) {
  return {
    title: todo.title,
    notes: todo.notes,
    bucket: todo.bucket,
    deadline: todo.deadline,
    scheduledAt: todo.scheduledAt,
    done: todo.done,
    dimensions: todo.dimensionValues,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatBody;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return Response.json({ error: 'Question required.' }, { status: 400 });

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'DEEPSEEK_API_KEY missing on server.' }, { status: 503 });
    }

    const store = normalizeStore({ todos: Array.isArray(body.todos) ? body.todos : [] });
    const tasks = store.todos.filter((todo) => !todo.done && todo.bucket !== 'completed').slice(0, 160).map(compactTodo);
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `Current time: ${new Date().toISOString()}\nTasks JSON:\n${JSON.stringify(tasks)}\n\nQuestion: ${question}`,
          },
        ],
        max_tokens: 360,
        temperature: 0.25,
        thinking: { type: 'disabled' },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ error: error.slice(0, 500) || 'DeepSeek request failed.' }, { status: 502 });
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return Response.json({ answer: data.choices?.[0]?.message?.content?.trim() || 'No answer returned.' });
  } catch {
    return Response.json({ error: 'Invalid chat request.' }, { status: 400 });
  }
}
