import { generateCategoriesFromText } from '@/lib/ashi-ai';

export const runtime = 'nodejs';

type CategoriesBody = {
  text?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CategoriesBody;
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return Response.json({ error: 'Category instructions required.' }, { status: 400 });
    const categories = await generateCategoriesFromText(text);
    return Response.json({ categories });
  } catch {
    return Response.json({ error: 'Invalid category generation request.' }, { status: 400 });
  }
}
