'use client';

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <button
      type="submit"
      onClick={() => sessionStorage.removeItem('mytodo_drive_pulled')}
      formAction={action}
      className="btn-ghost"
    >
      Sign out
    </button>
  );
}
