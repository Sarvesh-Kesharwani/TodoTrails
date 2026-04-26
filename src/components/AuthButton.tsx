import { signOut } from '@/auth';
import { clearCookieTodoStore } from '@/lib/todo-cookie';
import { getSession } from '@/lib/session';
import { SignInButton } from '@/components/SignInButton';
import { SignOutButton } from '@/components/SignOutButton';

export async function AuthButton() {
  const session = await getSession();
  if (!session?.user) return <SignInButton />;

  const signOutAction = async () => {
    'use server';
    await clearCookieTodoStore();
    await signOut({ redirectTo: '/' });
  };

  return (
    <form className="auth-chip">
      <span className="user-name">{session.user.name ?? session.user.email ?? 'Signed in'}</span>
      <SignOutButton action={signOutAction} />
    </form>
  );
}
