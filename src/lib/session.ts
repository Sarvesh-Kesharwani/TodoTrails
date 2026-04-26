import 'server-only';
import { auth } from '@/auth';

export async function getSession() {
  try {
    return await auth();
  } catch {
    return null;
  }
}
