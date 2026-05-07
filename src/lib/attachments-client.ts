import type { TodoAttachment } from '@/types/todo';

type UploadResponse = {
  id?: string;
  url?: string;
  name?: string;
  type?: string;
  size?: number;
};

export async function uploadTodoAttachment(file: File): Promise<TodoAttachment> {
  const baseUrl = process.env.NEXT_PUBLIC_RENDER_ATTACHMENTS_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('Set NEXT_PUBLIC_RENDER_ATTACHMENTS_URL to the Render attachment server URL.');
  }

  const form = new FormData();
  form.append('image', file);

  const response = await fetch(`${baseUrl}/api/uploads`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw new Error('Image upload failed.');

  const data = (await response.json()) as UploadResponse;
  if (!data.id || !data.url) throw new Error('Image upload returned invalid data.');

  return {
    id: data.id,
    url: data.url,
    name: data.name || file.name,
    type: data.type || file.type,
    size: typeof data.size === 'number' ? data.size : file.size,
    createdAt: new Date().toISOString(),
  };
}
