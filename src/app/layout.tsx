import type { Metadata } from 'next';
import { Baloo_2 } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthButton } from '@/components/AuthButton';
import { SyncButton } from '@/components/SyncButton';
import './globals.css';

const baloo = Baloo_2({ subsets: ['latin'], weight: ['400', '600', '700', '800'] });

export const metadata: Metadata = {
  title: 'TaskTrail',
  description: 'TaskTrail: time-bucket task board with smart grouping and Google Drive sync.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={baloo.className}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <Image src="/icon.svg" alt="TaskTrail logo" width={42} height={42} className="brand-logo" priority />
            <div>
              <strong>TaskTrail</strong>
              <small>Time bucket planner</small>
            </div>
          </Link>
          <div className="top-actions">
            <Link href="/settings" className="btn-ghost topbar-link">
              Settings
            </Link>
            <SyncButton />
            <Suspense fallback={null}>
              <AuthButton />
            </Suspense>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
